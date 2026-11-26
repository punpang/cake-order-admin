-- ทดสอบการให้แต้มตอนส่งมอบของสั่งล่วงหน้า (migration 20261127350000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมแล้ว rollback
-- A1 ส่งมอบแล้ว ได้แต้มตามฐานสุทธิ (500 → 5 แต้ม, 1 สิทธิ์หมุน) และบันทึกลงสมุดแต้ม
-- A2 เรียกซ้ำ → already ไม่ให้แต้มซ้ำ
-- A3 ยังไม่ส่งมอบ → ปฏิเสธ
-- A4 สินค้า noPoints ไม่คิดแต้ม (300 → 3 แต้ม)
-- A5 VAT ในตัว: 1070 รวม VAT 7% → ฐาน 1000 → 10 แต้ม
-- A6 ส่วนลดทั้งออร์เดอร์หักตามสัดส่วน: 500 หักส่วนลด 100 → ฐาน 400 → 4 แต้ม
-- A7 ออร์เดอร์ไม่มีลูกค้า → ข้าม ไม่เกิดข้อผิดพลาด
-- A8 บทบาทแอปเรียกไม่ได้ (ฟังก์ชันเป็น service_role เท่านั้น)

begin;

insert into public.punpang_customers (id, name, data) values
  ('ad1', 'ลูกค้าส่งมอบ', '{"ledger": []}'::jsonb);

insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('ad_camp', 'closed', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120, '{"name":"ส่งมอบ","dayCap":null,"items":[]}');

insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, customer_id, data) values
  ('ad_o1', 'ad_camp', 'PRE-AD-0001', 'delivered', '2099-12-24', 'ad1',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}]}'::jsonb),
  ('ad_o2', 'ad_camp', 'PRE-AD-0002', 'delivered', '2099-12-24', 'ad1',
    '{"items":[{"retailId":"A","unitPrice":300,"qty":1},{"retailId":"B","unitPrice":1000,"qty":1,"noPoints":true}]}'::jsonb),
  ('ad_o3', 'ad_camp', 'PRE-AD-0003', 'delivered', '2099-12-24', 'ad1',
    '{"items":[{"retailId":"A","unitPrice":1070,"qty":1}],"vat":{"rate":7,"mode":"inclusive"}}'::jsonb),
  ('ad_o4', 'ad_camp', 'PRE-AD-0004', 'delivered', '2099-12-24', 'ad1',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}],"adjustment":{"amount":-100}}'::jsonb),
  ('ad_o5', 'ad_camp', 'PRE-AD-0005', 'awaiting_payment', '2099-12-24', 'ad1',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}]}'::jsonb),
  ('ad_o6', 'ad_camp', 'PRE-AD-0006', 'delivered', '2099-12-24', null,
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}]}'::jsonb);

-- A1 (เรียกฟังก์ชันหนึ่งครั้งต่อหนึ่งคำสั่ง เพื่อให้การอ่านผลเห็นข้อมูลที่เขียนแล้ว)
select test.ok('A1a ส่งมอบแล้ว ได้ 5 แต้ม และ 1 สิทธิ์หมุน',
  (select (public.punpang_preorder_award_delivery('ad_o1') ->> 'points')::int) = 5);

select test.ok('A1b ลงสมุดแต้มของลูกค้าและบันทึกสิทธิ์หมุนในออร์เดอร์',
  (select count(*) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'ad1')) x where x->>'orderId' = 'ad_o1' and (x->>'delta')::int = 5) = 1
  and (select (data->'loyalty'->>'spins')::int from public.punpang_preorder_orders where id = 'ad_o1') = 1);

-- A2
select test.ok('A2 เรียกซ้ำไม่ให้แต้มซ้ำ (ยังมีรายการเดียว)',
  (select public.punpang_preorder_award_delivery('ad_o1') ->> 'already') = 'true'
  and (select count(*) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'ad1')) x where x->>'orderId' = 'ad_o1') = 1);

-- A3
select test.ok('A3 ออร์เดอร์ที่ยังไม่ส่งมอบถูกปฏิเสธ',
  (select public.punpang_preorder_award_delivery('ad_o5') ->> 'error') = 'not_delivered');

-- A4
select test.ok('A4 สินค้า noPoints ไม่คิดแต้ม (300 → 3 แต้ม)',
  (select (public.punpang_preorder_award_delivery('ad_o2') ->> 'points')::int) = 3);

-- A5
select test.ok('A5 VAT ในตัวหักออกก่อนคิดแต้ม (1070 รวม VAT 7% → 10 แต้ม)',
  (select (public.punpang_preorder_award_delivery('ad_o3') ->> 'points')::int) = 10);

-- A6
select test.ok('A6 ส่วนลดทั้งออร์เดอร์หักตามสัดส่วนก่อนคิดแต้ม (500 - 100 = 400 → 4 แต้ม)',
  (select (public.punpang_preorder_award_delivery('ad_o4') ->> 'points')::int) = 4);

-- A7
select test.ok('A7 ออร์เดอร์ที่ไม่มีลูกค้าถูกข้าม ไม่ error',
  (select public.punpang_preorder_award_delivery('ad_o6') ->> 'skipped') = 'no_customer');

-- A8
select test.ok('A8 บทบาทแอปเรียกให้แต้มไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000e1', $$select public.punpang_preorder_award_delivery('ad_o4')$$), 10) = 'ERR:42501:');

rollback;
