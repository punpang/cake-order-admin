-- รอบแก้ 2026-11-15 (ตรวจออร์เดอร์หลังบันทึก · ไม่บล็อกการขาย) · รันหลัง 20261115070000 (ไม่ขึ้นกับ 20261115080000) · รันซ้ำได้ปลอดภัย
-- เดิมบิลหน้าร้านและออร์เดอร์ตรงบันทึกจากเครื่องพร้อมราคา/ส่วนลด ระบบไม่มีที่ตรวจ
-- ตอนนี้เซิร์ฟเวอร์ตรวจออร์เดอร์ที่อัปเดตภายใน 2 วันทุก 10 นาที (Edge Function order-audit) แล้วเก็บผลในตารางนี้
-- ไม่บล็อก: บันทึกและขายได้ตามเดิม · ผลเป็นการเตือนให้ดู ไม่ได้แก้ออร์เดอร์
-- ผลเขียนได้เฉพาะเซิร์ฟเวอร์ · ผู้เห็นออร์เดอร์ทั้งหมดอ่านได้ · คีย์เรียกใช้ร่วมกับ scheduled (Vault scheduled_key)

create table if not exists public.punpang_order_audits (
  order_id text primary key references public.punpang_orders (id) on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  flags jsonb not null default '[]'::jsonb
);

alter table public.punpang_order_audits enable row level security;
revoke all on public.punpang_order_audits from public, anon, authenticated;
grant select on public.punpang_order_audits to authenticated;

drop policy if exists order_audits_read on public.punpang_order_audits;
create policy order_audits_read on public.punpang_order_audits for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

-- คิวออร์เดอร์ที่ยังไม่เคยตรวจ: บิลหน้าร้านทุกใบ + ออร์เดอร์ตรงที่ไม่ใช่ร่างและไม่ได้มาจากใบเสนอ · อัปเดตภายใน 2 วันเท่านั้น (เลี่ยงการเตือนจากราคาเก่า)
-- เรียกได้เฉพาะเซิร์ฟเวอร์ด้วยสิทธิ์ service_role
create or replace function public.punpang_orders_unaudited(p_limit int)
returns table (id text, channel text, status text, fulfillment text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.channel, o.status, o.fulfillment, o.data
    from public.punpang_orders o
   where o.updated_at > now() - interval '2 days'
     and not exists (select 1 from public.punpang_order_audits a where a.order_id = o.id)
     and (
       o.channel = 'pos'
       or (coalesce(o.channel, '') <> 'pos' and coalesce(o.status, '') <> 'draft' and coalesce(o.data->>'quoteId', '') = '')
     )
   order by o.updated_at, o.id
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;
revoke all on function public.punpang_orders_unaudited(int) from public, anon, authenticated;
grant execute on function public.punpang_orders_unaudited(int) to service_role;

-- ตั้งเวลาทุก 10 นาที (ถ้าเคยตั้งชื่อเดิมไว้จะถูกแทนที่) · คีย์เดียวกับ scheduled ที่เก็บใน Vault
do $$ begin perform cron.unschedule('punpang-pos-audit'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('punpang-order-audit'); exception when others then null; end $$;
select cron.schedule(
  'punpang-order-audit',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/order-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1), '')
    ),
    body := '{}'::jsonb
  );
  $$
);
