-- สั่งล่วงหน้า (preorder) เฟส 1: ตารางแคมเปญ ออร์เดอร์ และช่องโควตา + RLS (สเปก docs/superpowers/specs/2026-11-24-preorder-design.md หัวข้อ 8)
-- ค่าที่ SQL บังคับ: มัดจำ 1–100 · เวลาจ่ายมัดจำ > 0 (ไม่มีค่าตั้งต้น ร้านต้องกรอกทุกแคมเปญ) · ช่วงวันไม่ผิดลำดับ
-- สิทธิ์: ผู้ที่มี managePreorder หรือ manage อ่าน/เขียนแคมเปญได้ · ออร์เดอร์และช่องโควตาอ่านได้อย่างเดียวจากแอป
--   การเขียนออร์เดอร์/โควตาทำผ่าน RPC ฝั่งเซิร์ฟเวอร์เท่านั้น (เฟสถัดไป)
-- โหมดทดสอบ: ตารางทั้งสามเป็น iso (มีสำเนาข้อมูลทดสอบ) · รันซ้ำได้

create table if not exists public.punpang_preorder_campaigns (
  id text primary key,
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  order_from date not null,
  order_to date not null,
  pickup_from date not null,
  pickup_to date not null,
  deposit_percent integer not null default 50 check (deposit_percent between 1 and 100),
  pay_due_min integer not null check (pay_due_min > 0),
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint punpang_preorder_campaigns_order_chk check (order_from <= order_to),
  constraint punpang_preorder_campaigns_pickup_chk check (pickup_from <= pickup_to)
);
create index if not exists punpang_preorder_campaigns_updated_idx on public.punpang_preorder_campaigns (updated_at, id);

create table if not exists public.punpang_preorder_slots (
  campaign_id text not null references public.punpang_preorder_campaigns (id),
  pickup_date date not null,
  item_id text not null default '', -- '' = ยอดรวมต่อวัน
  reserved integer not null default 0 check (reserved >= 0),
  updated_at timestamptz not null default now(),
  primary key (campaign_id, pickup_date, item_id)
);

create table if not exists public.punpang_preorder_orders (
  id text primary key,
  campaign_id text not null references public.punpang_preorder_campaigns (id),
  code text not null unique,
  status text not null,
  pickup_date date not null,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists punpang_preorder_orders_campaign_idx on public.punpang_preorder_orders (campaign_id, pickup_date);
create index if not exists punpang_preorder_orders_updated_idx on public.punpang_preorder_orders (updated_at, id);

-- เวลาแก้ไข: ใช้ตัวเดิม punpang_touch_updated (ตั้ง updated_at ทุกครั้งที่แก้)
drop trigger if exists punpang_preorder_campaigns_touch on public.punpang_preorder_campaigns;
create trigger punpang_preorder_campaigns_touch before update on public.punpang_preorder_campaigns
  for each row execute function public.punpang_touch_updated();
drop trigger if exists punpang_preorder_slots_touch on public.punpang_preorder_slots;
create trigger punpang_preorder_slots_touch before update on public.punpang_preorder_slots
  for each row execute function public.punpang_touch_updated();
drop trigger if exists punpang_preorder_orders_touch on public.punpang_preorder_orders;
create trigger punpang_preorder_orders_touch before update on public.punpang_preorder_orders
  for each row execute function public.punpang_touch_updated();

-- RLS: ปิดทุกสิทธิ์จาก public/anon/authenticated ก่อน แล้วให้เฉพาะที่ใช้จริง
alter table public.punpang_preorder_campaigns enable row level security;
alter table public.punpang_preorder_slots enable row level security;
alter table public.punpang_preorder_orders enable row level security;
revoke all on public.punpang_preorder_campaigns, public.punpang_preorder_slots, public.punpang_preorder_orders
  from public, anon, authenticated;
grant select, insert, update on public.punpang_preorder_campaigns to authenticated;
grant select on public.punpang_preorder_slots to authenticated;
grant select on public.punpang_preorder_orders to authenticated;

drop policy if exists preorder_campaigns_read on public.punpang_preorder_campaigns;
create policy preorder_campaigns_read on public.punpang_preorder_campaigns for select to authenticated
  using ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));
drop policy if exists preorder_campaigns_insert on public.punpang_preorder_campaigns;
create policy preorder_campaigns_insert on public.punpang_preorder_campaigns for insert to authenticated
  with check ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));
drop policy if exists preorder_campaigns_update on public.punpang_preorder_campaigns;
create policy preorder_campaigns_update on public.punpang_preorder_campaigns for update to authenticated
  using ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')))
  with check ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));

drop policy if exists preorder_slots_read on public.punpang_preorder_slots;
create policy preorder_slots_read on public.punpang_preorder_slots for select to authenticated
  using ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));
drop policy if exists preorder_orders_read on public.punpang_preorder_orders;
create policy preorder_orders_read on public.punpang_preorder_orders for select to authenticated
  using ((select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage')));

-- โหมดทดสอบ: จัดประเภทตารางใหม่เป็น iso (แพตช์รายการใน punpang_test_sync ครั้งเดียว รันซ้ำได้)
do $$
declare d text; n text; pat text := '''punpang_member_events''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_preorder_campaigns''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'ไม่พบรายการ iso ที่คาดไว้ใน punpang_test_sync (ตรวจ migration โหมดทดสอบ)';
  end if;
  n := replace(d, pat, '''punpang_member_events'', ''punpang_preorder_campaigns'', ''punpang_preorder_slots'', ''punpang_preorder_orders''];');
  execute n;
end $$;

-- ล้างข้อมูลทดสอบ: นิยามล่าสุดจาก 20261121140000 + ตารางใหม่ (สำเนาในโหมดทดสอบเท่านั้น ไม่แตะข้อมูลจริง)
create or replace function public.punpang_reset_test_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'เฉพาะแอดมินล้างข้อมูลทดสอบได้' using errcode = '42501';
  end if;
  truncate table punpang_test.punpang_records, punpang_test.punpang_customers,
    punpang_test.punpang_orders, punpang_test.punpang_chats, punpang_test.punpang_chat_presence,
    punpang_test.punpang_chat_topics, punpang_test.punpang_order_topics,
    punpang_test.punpang_order_audits, punpang_test.punpang_order_changes,
    punpang_test.punpang_order_issued, punpang_test.punpang_order_reviews,
    punpang_test.punpang_quotes, punpang_test.punpang_shifts, punpang_test.punpang_payments,
    punpang_test.punpang_counters, punpang_test.punpang_acct_entries,
    punpang_test.punpang_acct_invoices, punpang_test.punpang_acct_counters,
    punpang_test.punpang_acct_state, punpang_test.punpang_acct_frozen,
    punpang_test.punpang_sms_log, punpang_test.punpang_tg_log, punpang_test.punpang_cake_clicks,
    punpang_test.punpang_sync_review,
    punpang_test.punpang_preorder_slots, punpang_test.punpang_preorder_orders, punpang_test.punpang_preorder_campaigns
    restart identity;
  insert into punpang_test.punpang_acct_state (id) values (1) on conflict (id) do nothing; -- แถวตั้งต้นของสถานะปิดงวด
  perform punpang_test.punpang_test_seed(); -- ชุดตัวอย่าง ~90 วัน (migration 20261116140000)
end $$;

revoke all on function public.punpang_reset_test_data() from public, anon;
grant execute on function public.punpang_reset_test_data() to authenticated, service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มีตารางและนิยามใหม่
select punpang_test.punpang_test_sync();
