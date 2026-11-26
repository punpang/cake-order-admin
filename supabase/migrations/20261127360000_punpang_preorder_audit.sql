-- สั่งล่วงหน้า เฟส 4 ข้อ 2: ผลการตรวจค่าส่งและแต้มของออร์เดอร์ที่ส่งมอบ/ยกเลิกแล้ว (ดู src/lib/preorderAudit.js)
-- ไม่แก้ออร์เดอร์ · ไม่บล็อกการทำงาน · ยังไม่ตั้ง pg_cron (รอแก้ปัญหา cron ของสั่งล่วงหน้าบน production)
-- ผลเขียนได้เฉพาะเซิร์ฟเวอร์ · ผู้มีสิทธิ์จัดการสั่งล่วงหน้าอ่านได้
-- รูปแบบ flags เหมือน punpang_order_audits: [{ code, severity, detail }]

create table if not exists public.punpang_preorder_audits (
  order_id text primary key references public.punpang_preorder_orders (id) on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  flags jsonb not null default '[]'::jsonb
);

alter table public.punpang_preorder_audits enable row level security;
revoke all on public.punpang_preorder_audits from public, anon, authenticated;
grant select on public.punpang_preorder_audits to authenticated;

drop policy if exists preorder_audits_read on public.punpang_preorder_audits;
create policy preorder_audits_read on public.punpang_preorder_audits for select to authenticated
  using ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));

-- คิวออร์เดอร์ที่ต้องตรง: ส่งมอบหรือยกเลิกแล้ว, มี loyalty (ให้แต้มแล้ว) และยังไม่ถูกตรวจหลังแก้ไขล่าสุด
-- เรียกได้เฉพาะเซิร์ฟเวอร์ด้วยสิทธิ์ service_role
create or replace function public.punpang_preorder_orders_unaudited(p_limit int)
returns table (id text, campaign_id text, status text, data jsonb, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.campaign_id, o.status, o.data, o.created_at
    from public.punpang_preorder_orders o
   where o.status in ('delivered', 'cancelled')
     and o.data->'loyalty' is not null
     and o.data->'loyalty' <> 'null'::jsonb
     and not exists (
       select 1 from public.punpang_preorder_audits a
        where a.order_id = o.id and a.checked_at >= o.updated_at
     )
   order by o.updated_at, o.id
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

revoke all on function public.punpang_preorder_orders_unaudited(int) from public, anon, authenticated;
grant execute on function public.punpang_preorder_orders_unaudited(int) to service_role;
