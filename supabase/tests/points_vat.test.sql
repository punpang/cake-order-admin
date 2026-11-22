-- ทดสอบขั้น 2: เพดานฐานแต้มของ punpang_award_order เป็นยอดก่อน VAT (migration 20261122100000)
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้พนักงาน driver 22222222 ที่มีสิทธิ์ให้คะแนน)
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น pvat_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

insert into public.punpang_customers (id, name, phone, data) values
  ('pvat_c1', 'ลูกค้าทดสอบ VAT', '0899000001', '{"ledger":[],"spins":0}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('pvat_in107', 'OR-PVAT-1', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"pv1","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('pvat_in106', 'OR-PVAT-2', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":106,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"pv2","status":"confirmed","amount":106}],"adjustment":{"amount":0}}'),
  ('pvat_multi', 'OR-PVAT-3', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1},{"unitPrice":214,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"pv3","status":"confirmed","amount":321}],"adjustment":{"amount":0}}'),
  ('pvat_out', 'OR-PVAT-4', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"exclusive"},"payments":[{"id":"pv4","status":"confirmed","amount":114.49}],"adjustment":{"amount":0}}'),
  ('pvat_novat', 'OR-PVAT-5', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"payments":[{"id":"pv5","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('pvat_rate0', 'OR-PVAT-6', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":0,"mode":"inclusive"},"payments":[{"id":"pv6","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('pvat_nomode_a', 'OR-PVAT-7', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7},"payments":[{"id":"pv7","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('pvat_nomode_b', 'OR-PVAT-8', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7},"payments":[{"id":"pv8","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('pvat_out_over', 'OR-PVAT-9', 'pvat_c1', 'delivered', 'pickup', 'web',
   '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"exclusive"},"payments":[{"id":"pv9","status":"confirmed","amount":114.49}],"adjustment":{"amount":0}}');

-- PV1–PV2: VAT ใน 107 บาท · ฐานที่รวม VAT (107) ถูกปฏิเสธ · ฐานก่อน VAT (100) ผ่าน
select test.ok('PV1: VAT ใน 107 บาท ส่งฐาน 107 (รวม VAT) ถูกปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_in107', 1, 0, 0, 107) $q$)->>'error') = 'invalid');
select test.ok('PV2: VAT ใน 107 บาท ส่งฐาน 100 (ก่อน VAT) ผ่าน ได้ 1 คะแนน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_in107', 1, 0, 0, 100) $q$)->>'ok')::boolean);

-- PV3–PV4: VAT ใน 106 บาท · ฐาน 99.09 เกินเพดาน (99.0654 + เผื่อ 0.01) · ฐาน 99.07 ผ่าน (ปัดเศษ) ได้ 0 คะแนน
select test.ok('PV3: VAT ใน 106 บาท ส่งฐาน 99.09 ถูกปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_in106', 0, 0, 0, 99.09) $q$)->>'error') = 'invalid');
select test.ok('PV4: VAT ใน 106 บาท ส่งฐาน 99.07 (ปัดเศษ) ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_in106', 0, 0, 0, 99.07) $q$)->>'ok')::boolean);

-- PV5–PV6: หลายรายการ VAT ใน (107 + 214 = 321) · ก่อน VAT = 300 · ฐาน 300.02 เกิน · ฐาน 300.01 (เผื่อ 0.01) ผ่าน ได้ 3 คะแนน
select test.ok('PV5: หลายรายการ VAT ใน ส่งฐาน 300.02 ถูกปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_multi', 3, 0, 0, 300.02) $q$)->>'error') = 'invalid');
select test.ok('PV6: หลายรายการ VAT ใน ส่งฐาน 300.01 ผ่าน ได้ 3 คะแนน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_multi', 3, 0, 0, 300.01) $q$)->>'ok')::boolean);

-- PV7: VAT นอก 7% · ยอดสินค้า 107 ไม่เปลี่ยน ฐาน 107 ผ่าน · PV8: เกิน 1 สตางค์ยังถูกปฏิเสธ (เพดานเดิมยังอยู่)
select test.ok('PV7: VAT นอก ส่งฐาน 107 ผ่าน (เหมือนเดิม)',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_out', 1, 0, 0, 107) $q$)->>'ok')::boolean);
select test.ok('PV8: VAT นอก ส่งฐาน 107.02 (เกินยอดสินค้า) ถูกปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_out_over', 1, 0, 0, 107.02) $q$)->>'error') = 'invalid');

-- PV9: ไม่มี VAT ส่งฐาน 107 ผ่าน · PV10: อัตรา 0 ส่งฐาน 107 ผ่าน
select test.ok('PV9: ไม่มี VAT ส่งฐาน 107 ผ่าน (เหมือนเดิม)',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_novat', 1, 0, 0, 107) $q$)->>'ok')::boolean);
select test.ok('PV10: VAT อัตรา 0 ส่งฐาน 107 ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_rate0', 1, 0, 0, 107) $q$)->>'ok')::boolean);

-- PV11–PV12: ไม่มีค่า mode ถือเป็นแบบใน · ฐาน 107 ถูกปฏิเสธ · ฐาน 100 ผ่าน
select test.ok('PV11: ไม่มีค่า mode ถือเป็นแบบใน ส่งฐาน 107 ถูกปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_nomode_a', 1, 0, 0, 107) $q$)->>'error') = 'invalid');
select test.ok('PV12: ไม่มีค่า mode ถือเป็นแบบใน ส่งฐาน 100 ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('pvat_nomode_b', 1, 0, 0, 100) $q$)->>'ok')::boolean);

rollback;
