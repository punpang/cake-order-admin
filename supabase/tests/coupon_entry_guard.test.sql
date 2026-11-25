-- ทดสอบการกันการตรวจคูปองของลูกค้าคนอื่น (migration 20261127300000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- ฟิกซ์เจอร์: คูปองแบบคงที่ 50 บาทที่จองกับออร์เดอร์ go_o1 ของลูกค้า go_c1 (ค่าที่ควรผ่านจริงเมื่อไม่มีการกัน)
-- G0: ฟิกซ์เจอร์ต้องผ่านจริงจากผู้เรียกฝั่งเซิร์ฟเวอร์ (ไม่มี uid) มิฉะนั้นเทสต์ไม่มีความหมาย
-- G1: ผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงาน ต้องได้ false
-- G2: พนักงานที่ใช้งานอยู่ ได้ true

begin;

insert into auth.users (id, email) values
  ('ce000000-0000-4000-8000-000000000001', 'ce_customer@example.test'),
  ('ce000000-0000-4000-8000-000000000002', 'ce_staff@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('ce000000-0000-4000-8000-000000000002', 'พนักงานทดสอบคูปอง', 'sales', '{pos,createOrder}')
on conflict do nothing;

insert into public.punpang_customers (id, name, phone, note, data, created_at, updated_at) values
  ('go_c1', 'ทดสอบ go', '0899990022', '', '{"ledger":[],"spins":0}'::jsonb, now(), now());

insert into public.punpang_records (collection, id, data) values
  ('coupons', 'go_fixed', '{"type":"discount","status":"used","orderId":"go_o1","customerId":"go_c1","name":"ลด 50","amount":50,"minSpend":0}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('go_o1', 'OR-GO-1', 'go_c1', 'draft', 'pickup', 'web', '{"items":[{"id":"go1","retailId":"other","unitPrice":600,"qty":1,"name":"อื่น"}],"payments":[],"adjustment":{"amount":0}}');

do $$
declare
  d jsonb := '{"items":[{"retailId":"other","unitPrice":600,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb;
  e jsonb := '{"couponId":"go_fixed","amount":"50"}'::jsonb;
  r boolean;
begin
  -- G0: ฟิกซ์เจอร์ผ่านจริง
  r := public.punpang__coupon_entry_ok('go_o1', 'web', 'go_c1', d, e);
  if r is distinct from true then
    raise exception 'G0 ฟิกซ์เจอร์ผิด: ผู้เรียกฝั่งเซิร์ฟเวอร์ได้ % (คาด true)', r;
  end if;

  -- G1: ผู้ใช้ล็อกอินที่ไม่ใช่พนักงาน
  perform set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000001', true);
  execute 'set local role authenticated';
  r := public.punpang__coupon_entry_ok('go_o1', 'web', 'go_c1', d, e);
  execute 'reset role';
  if r is distinct from false then
    raise exception 'G1 ล้มเหลว: ผู้ใช้ที่ไม่ใช่พนักงานได้ % (คาด false)', r;
  end if;

  -- G2: พนักงานที่ใช้งานอยู่
  perform set_config('request.jwt.claim.sub', 'ce000000-0000-4000-8000-000000000002', true);
  execute 'set local role authenticated';
  r := public.punpang__coupon_entry_ok('go_o1', 'web', 'go_c1', d, e);
  execute 'reset role';
  if r is distinct from true then
    raise exception 'G2 ล้มเหลว: พนักงานได้ % (คาด true)', r;
  end if;
end $$;

select 'coupon_entry_guard ผ่านทั้งหมด' as coupon_entry_guard_tests;

rollback;
