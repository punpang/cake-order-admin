-- ทดสอบยอดคงค้าง (balance) ที่ฐานข้อมูลคำนวณเอง (migration 20261120180000) ให้ตรงกับสูตร orderTotals ในแอป (ยอดบิล − ยอดที่ยืนยันแล้ว)
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น bs_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- BS1: ออร์เดอร์ที่ยังไม่มีการชำระ ยอดคงค้างเท่ายอดบิล
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_1', 'OR-BS-1', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[]}');
select test.ok('BS1: ยังไม่มีการชำระ → ยอดคงค้างเท่ายอดบิล',
  (select balance from public.punpang_orders where id = 'bs_1') = 1000);

-- BS2: แอปส่งค่า balance ผิดมา ฐานข้อมูลคำนวณใหม่ (ยอดบิล 1000 − ยืนยัน 300 = 700)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, balance, data) values
  ('bs_2', 'OR-BS-2', 'c1', 'awaiting_payment', 'pickup', 'web', 999,
   '{"items":[{"unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":300}]}');
select test.ok('BS2: ค่าที่แอปส่งมาผิดถูกแทนด้วยค่าที่คำนวณจากข้อมูล',
  (select balance from public.punpang_orders where id = 'bs_2') = 700);

-- BS3: ยืนยันชำระเพิ่มจนครบ → ยอดคงค้างเป็น 0 (การอัปเดตข้อมูลเพียงอย่างเดียวก็คำนวณใหม่)
update public.punpang_orders
   set data = jsonb_set(data, '{payments}', '[{"id":"p1","status":"confirmed","amount":300},{"id":"p2","status":"confirmed","amount":700}]')
 where id = 'bs_2';
select test.ok('BS3: ยืนยันจนครบยอดบิล → ยอดคงค้างเป็น 0',
  (select balance from public.punpang_orders where id = 'bs_2') = 0);

-- BS4: รายการที่แจ้งแต่ยังไม่ยืนยันไม่นับเป็นยอดที่ชำระแล้ว
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_3', 'OR-BS-3', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"reported","amount":500}]}');
select test.ok('BS4: ยอดที่แจ้งแต่ยังไม่ยืนยันไม่หักออกจากยอดคงค้าง',
  (select balance from public.punpang_orders where id = 'bs_3') = 1000);

-- BS5: VAT แบบแยกนอก (บวกเพิ่มท้ายยอด) และแบบรวมใน (ไม่บวกเพิ่ม)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_4', 'OR-BS-4', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"vat":{"rate":7,"mode":"exclusive"}}'),
  ('bs_5', 'OR-BS-5', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"vat":{"rate":7,"mode":"inclusive"}}');
select test.ok('BS5: VAT แยกนอกบวกเพิ่มท้ายยอด (1000 → 1070)',
  (select balance from public.punpang_orders where id = 'bs_4') = 1070);
select test.ok('BS5: VAT รวมในไม่บวกเพิ่ม (1000 → 1000)',
  (select balance from public.punpang_orders where id = 'bs_5') = 1000);

-- BS6: ค่าส่ง (จัดส่ง) บวกเข้า · ส่งฟรีตามดีลไม่บวก
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_6', 'OR-BS-6', 'c1', 'awaiting_payment', 'delivery', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"shippingFee":50}'),
  ('bs_7', 'OR-BS-7', 'c1', 'awaiting_payment', 'delivery', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"shippingFee":50,"shipPromo":{"free":true}}');
select test.ok('BS6: ค่าส่งบวกเข้ายอดบิล (1000 + 50)',
  (select balance from public.punpang_orders where id = 'bs_6') = 1050);
select test.ok('BS6: ส่งฟรีตามดีลไม่บวกค่าส่ง',
  (select balance from public.punpang_orders where id = 'bs_7') = 1000);

-- BS7: ส่วนลดรวมเกินยอดสินค้า → ยอดบิลไม่ติดลบ (0) · ปรับราคาติดลบลดยอดคงค้าง
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_8', 'OR-BS-8', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"pointsUsed":{"amount":1500,"points":1500}}'),
  ('bs_9', 'OR-BS-9', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[],"adjustment":{"amount":-100}}');
select test.ok('BS7: ส่วนลดเกินยอดสินค้า → ยอดคงค้างเป็น 0 ไม่ติดลบ',
  (select balance from public.punpang_orders where id = 'bs_8') = 0);
select test.ok('BS7: ปรับราคาติดลบลดยอดคงค้าง (1000 → 900)',
  (select balance from public.punpang_orders where id = 'bs_9') = 900);

-- BS8: ปัดเศษสตางค์ตรงกับแอป (33.33 × 3 = 99.99)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('bs_10', 'OR-BS-10', 'c1', 'awaiting_payment', 'pickup', 'web', '{"items":[{"unitPrice":33.33,"qty":3}],"payments":[]}');
select test.ok('BS8: ราคา × จำนวนปัดเป็นสตางค์ตรงกับแอป (99.99)',
  (select balance from public.punpang_orders where id = 'bs_10') = 99.99);

-- BS9: ทริกเกอร์ติดตั้งอยู่และชื่อขึ้นต้น zz_ (รันหลังทริกเกอร์ BEFORE อื่น)
select test.ok('BS9: ทริกเกอร์ยอดคงค้างติดตั้งบน punpang_orders แล้ว',
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = 'punpang_orders'
      and t.tgname = 'zz_punpang_orders_balance' and not t.tgisinternal) = 1);

rollback;
