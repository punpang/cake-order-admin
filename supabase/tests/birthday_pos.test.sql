-- ทดสอบส่วนลดเดือนเกิดหน้าร้าน (migration 20261123150000) · ทำในธุรกรรมที่ย้อนกลับ · รันโดย run.sh หลัง member_benefits.test.sql
-- ครอบคลุม: ยอดที่เซิร์ฟเวอร์คิด (เฉพาะหมวดเค้กที่ร้านเลือก · เพดาน) · รับเฉพาะ POS · ห้ามซ้อนคูปอง · ต้องตรงกับยอดที่เซิร์ฟเวอร์คิด

begin;

-- ตั้งค่า: โหมดใช้จริง + หมวดเค้ก (ร้านเลือก) ; สินค้า 2 รายการ
insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels',
  jsonb_build_object('v', jsonb_build_object('mode', 'live', 'bonusFrom', '2026-01-01T00:00:00Z', 'cakeCategories', jsonb_build_array('bdp-เค้กเต็มใบ'))))
on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_items (id, kind, name, price, active, data) values
  ('bdp_cake', 'retail', 'เค้กทดสอบ', 500, true, '{"category":"bdp-เค้กเต็มใบ"}'),
  ('bdp_other', 'retail', 'ขนมทดสอบ', 70, true, '{"category":"bdp-ขนมอบ"}');

-- พนักงานขาย (ไม่มีสิทธิ์ปรับราคา) สำหรับทดสอบการขายหน้าร้าน
insert into auth.users (id, email) values ('bd000000-0000-4000-8000-000000000001', 'bdpos@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('bd000000-0000-4000-8000-000000000001', 'ทดสอบ POS', 'sales', '{createOrder,pos,viewAllOrders}');

-- ลูกค้า LV4 · เดือนเกิดปัจจุบัน · กรอกมาแล้ว 31 วัน · ยอดเดือนก่อนถึง LV4
insert into public.punpang_customers (id, name, phone, note, data, created_at, updated_at) values
  ('bdp_c1', 'ทดสอบ bdp', '0899990001', '', '{"ledger":[],"spins":0}'::jsonb, now(), now());
select public.punpang_cust_set_birth('bdp_c1', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true);
update public.punpang_customers set data = jsonb_set(data, '{birth,setAt}', to_jsonb(((now() - interval '31 days') at time zone 'utc')::text)) where id = 'bdp_c1';
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values ('bdp_c1', 'bdp_ev1', 'spend', now() - interval '40 days', ((now() at time zone 'Asia/Bangkok')::date - 40), 5000, 140, 1);

-- ยอดที่ควรได้: เค้ก 500×2 = 1000 → 10% = 100 → เพดาน 50 · ขนม (ไม่ใช่หมวดเค้ก) ไม่นับ
select test.ok('BD1 เซิร์ฟเวอร์คิดส่วนลดเดือนเกิด LV4 = 50 (เฉพาะหมวดเค้ก เพดาน 50)',
  public.punpang__birth_discount_expected('bdp_c1', '[{"retailId":"bdp_cake","unitPrice":500,"qty":2},{"retailId":"bdp_other","unitPrice":70,"qty":1}]'::jsonb) = 50);
select test.ok('BD2 ไม่มีหมวดเค้กในรายการ = 0',
  public.punpang__birth_discount_expected('bdp_c1', '[{"retailId":"bdp_other","unitPrice":70,"qty":1}]'::jsonb) = 0);
select test.ok('BD3 ลูกค้าไม่มีสิทธิ์ (ไม่ได้ซื้อถึงระดับ/ไม่เดือนเกิด) = 0',
  public.punpang__birth_discount_expected('bdp_none', '[{"retailId":"bdp_cake","unitPrice":500,"qty":2}]'::jsonb) = 0);

-- การขายหน้าร้านด้วยสิทธิ์พนักงาน
select test.ok('BD4 หน้าร้าน ส่วนลดตรงกับเซิร์ฟเวอร์ → บันทึกได้',
  test.as_staff('bd000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
    values ('bdp_o1', 'BDP-001', 'bdp_c1', 'payment_confirmed', 'pickup', 'pos',
      '{"items":[{"retailId":"bdp_cake","unitPrice":500,"qty":2}],"couponsUsed":[],"adjustment":{"amount":0},"birthdayDiscount":{"amount":50}}'::jsonb)$$) = 'OK');
select test.ok('BD5 ส่วนลดไม่ตรงกับเซิร์ฟเวอร์ (60 แทน 50) → ถูกปฏิเสธ',
  test.as_staff('bd000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
    values ('bdp_o2', 'BDP-002', 'bdp_c1', 'payment_confirmed', 'pickup', 'pos',
      '{"items":[{"retailId":"bdp_cake","unitPrice":500,"qty":2}],"couponsUsed":[],"adjustment":{"amount":0},"birthdayDiscount":{"amount":60}}'::jsonb)$$) like 'ERR:42501%');
select test.ok('BD6 ไม่ซ้อนคูปอง: มีคูปองในบิลพร้อมส่วนลดเดือนเกิด → ถูกปฏิเสธ',
  test.as_staff('bd000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
    values ('bdp_o3', 'BDP-003', 'bdp_c1', 'payment_confirmed', 'pickup', 'pos',
      '{"items":[{"retailId":"bdp_cake","unitPrice":500,"qty":2}],"couponsUsed":[{"amount":10}],"adjustment":{"amount":0},"birthdayDiscount":{"amount":50}}'::jsonb)$$) like 'ERR:42501%');
select test.ok('BD7 ช่องทางเว็บ ไม่รับส่วนลดเดือนเกิด',
  test.as_staff('bd000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
    values ('bdp_o4', 'BDP-004', 'bdp_c1', 'payment_confirmed', 'pickup', 'web',
      '{"items":[{"retailId":"bdp_cake","unitPrice":500,"qty":2}],"couponsUsed":[],"adjustment":{"amount":0},"birthdayDiscount":{"amount":50}}'::jsonb)$$) like 'ERR:42501%');

-- รอบ 2: สิทธิสำหรับ order-create / quote-create
select test.ok('BD8 สิทธิเดือนเกิดสำหรับใบเสนอ: LV4 ใช้ได้ rate 10 เพดาน 50 และมีหมวดเค้กของร้าน',
  (public.punpang_member_birth_for_quote('bdp_c1') ->> 'rate')::int = 10
  and (public.punpang_member_birth_for_quote('bdp_c1') ->> 'cap')::int = 50
  and public.punpang_member_birth_for_quote('bdp_c1') -> 'cakeCategories' = '["bdp-เค้กเต็มใบ"]'::jsonb);
select test.ok('BD9 ลูกค้าไม่มีสิทธิ์/ไม่มีลูกค้า: rate 0', (public.punpang_member_birth_for_quote('bdp_none') ->> 'rate')::int = 0
  and (public.punpang_member_birth_for_quote(null) ->> 'rate')::int = 0);

-- รอบ 3: เลือกสินค้าเอง (นอกหมวด) นับเป็นเค้ก
insert into public.punpang_items (id, kind, name, price, active, data) values
  ('bdp_pick', 'retail', 'สินค้าเลือกเอง', 200, true, '{"category":"bdp-ขนมอบ"}');
update public.punpang_kv set data = jsonb_set(data, '{v,cakeItemIds}', '["bdp_pick"]'::jsonb)
 where collection = 'config' and id = 'memberLevels';
select test.ok('BD10 สินค้าที่เลือกเองนับเป็นเค้กแม้หมวดไม่ตรง: 200 × 10% = 20',
  public.punpang__birth_discount_expected('bdp_c1', '[{"retailId":"bdp_pick","unitPrice":200,"qty":1}]'::jsonb) = 20);
select test.ok('BD11 สินค้าอื่นนอกหมวดและนอกรายการ ไม่นับ',
  public.punpang__birth_discount_expected('bdp_c1', '[{"retailId":"bdp_other","unitPrice":70,"qty":1}]'::jsonb) = 0);

-- รอบ 4: บัตรบอกว่ามีส่วนลดเค้กเดือนเกิด (เมื่อร้านเลือกเค้กแล้ว)
select test.ok('BD12 บัตรลูกค้าบอกว่าร้านเลือกเค้กแล้ว (cakeSet) และมีสิทธิเดือนเกิด',
  (public.punpang_member_card('bdp_c1') -> 'birth' ->> 'cakeSet')::boolean = true
  and (public.punpang_member_card('bdp_c1') -> 'birth' ->> 'rate')::int = 10);

rollback;
select 'ผ่านทั้งหมด' as birthday_pos_tests;
