-- ทดสอบด่านบัตรของ POS ฝั่งฐานข้อมูล (migration 20261120210000): รายการชำระบัตรที่เป็นยอดรับใหม่ต้องมีธง cardConfirmed = true
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok และ test.as_staff จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น cgt_ · ทำในธุรกรรมที่ย้อนกลับ
-- ผู้ใช้: 5555… = แอดมิน (มีสิทธิ์ครบ จึงไม่มีอะไรมาบังด่านบัตร)

begin;

-- ลองคำสั่งของเซิร์ฟเวอร์ (role postgres): คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function test.cgt_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- บิลหน้าร้านที่รับเงินสดครบแล้ว (ใช้ทดสอบการแก้ไขบิลเดิม)
-- บิลหน้าร้านที่ยังค้างชำระ (ใช้ทดสอบการเพิ่มรายการชำระในบิลเดิม)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('cgt_base', 'OR-CGT-1', 'c1', 'payment_confirmed', 'pickup', 'pos',
   '{"items":[{"unitPrice":100,"qty":1,"name":"คัพเค้ก"}],"payments":[{"id":"cgt_pc","status":"confirmed","amount":100,"posMethod":"cash"}]}'),
  ('cgt_open', 'OR-CGT-2', 'c1', 'pos_pending', 'pickup', 'pos',
   '{"items":[{"unitPrice":100,"qty":1,"name":"คัพเค้ก"}],"payments":[]}');

-- CGT1: บิลหน้าร้านใหม่ที่รับบัตรเป็นยอดรับ โดยไม่มีธงยืนยันบัตร → ถูกบล็อก
select test.ok('CGT1: บิลใหม่ที่รับบัตร (ยืนยันแล้ว) ไม่มีธงยืนยันบัตร ถูกบล็อก',
  test.cgt_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cgt_1', 'OR-CGT-3', 'c1', 'payment_confirmed', 'pickup', 'pos',
     '{"items":[{"unitPrice":100,"qty":1}],"payments":[{"id":"cgt_p1","status":"confirmed","amount":100,"posMethod":"card"}]}') $q$) like 'ERR:P0001:punpang_card_unconfirmed:%');

-- CGT2: บิลใหม่ที่รับบัตรและมีธงยืนยันบัตร → บันทึกได้
select test.ok('CGT2: บิลใหม่ที่รับบัตรพร้อมธงยืนยันบัตร บันทึกได้',
  test.cgt_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cgt_2', 'OR-CGT-4', 'c1', 'payment_confirmed', 'pickup', 'pos',
     '{"items":[{"unitPrice":100,"qty":1}],"payments":[{"id":"cgt_p2","status":"confirmed","amount":100,"posMethod":"card","cardConfirmed":true}]}') $q$) = 'OK');

-- CGT3: เงินสดไม่ต้องมีธงบัตร · บัตรที่ยังไม่ได้ยืนยัน (รอ) ไม่นับเป็นยอดรับ จึงบันทึกได้
select test.ok('CGT3: บิลใหม่ที่รับเงินสดบันทึกได้โดยไม่ต้องมีธงบัตร',
  test.cgt_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cgt_3', 'OR-CGT-5', 'c1', 'payment_confirmed', 'pickup', 'pos',
     '{"items":[{"unitPrice":100,"qty":1}],"payments":[{"id":"cgt_p3","status":"confirmed","amount":100,"posMethod":"cash"}]}') $q$) = 'OK');
select test.ok('CGT3: บัตรที่ยังรอ (ไม่ใช่ยอดรับ) บันทึกได้โดยไม่มีธงบัตร',
  test.cgt_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cgt_4', 'OR-CGT-6', 'c1', 'pos_pending', 'pickup', 'pos',
     '{"items":[{"unitPrice":100,"qty":1}],"payments":[{"id":"cgt_p4","status":"reported","amount":40,"posMethod":"card"}]}') $q$) = 'OK');

-- CGT4: แอดมินแก้ข้อมูลอื่นของบิลเดิมได้ (รายการชำระเดิมไม่เปลี่ยน จึงไม่ถูกด่านบัตรบล็อก)
select test.ok('CGT4: แอดมินแก้ข้อมูลอื่นของบิลที่รับเงินสดแล้วได้',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{note}', '"ทดสอบ"') where id = 'cgt_base' $q$) = 'OK');

-- CGT5: เพิ่มรายการบัตรใหม่ที่ยืนยันแล้วในบิลค้าง โดยไม่มีธงยืนยันบัตร → ถูกบล็อก
select test.ok('CGT5: เพิ่มรายการบัตรที่ยืนยันแล้วโดยไม่มีธงยืนยันบัตร ถูกบล็อก',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"cgt_p5","status":"confirmed","amount":100,"posMethod":"card"}]'::jsonb) where id = 'cgt_open' $q$) like 'ERR:P0001:punpang_card_unconfirmed:%');

-- CGT6: เพิ่มรายการบัตรใหม่พร้อมธงยืนยันบัตร → บันทึกได้
select test.ok('CGT6: เพิ่มรายการบัตรใหม่พร้อมธงยืนยันบัตร บันทึกได้',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"cgt_p6","status":"confirmed","amount":100,"posMethod":"card","cardConfirmed":true}]'::jsonb) where id = 'cgt_open' $q$) = 'OK');

-- CGT7: รายการบัตรที่ยังรอ (reported) เปลี่ยนเป็นยืนยันโดยไม่มีธงยืนยันบัตร → ถูกบล็อก (เดิมรหัสเดิมได้รับการยกเว้น จึงผ่าน)
select test.ok('CGT7: บัตรที่รออยู่ เปลี่ยนเป็นยืนยันโดยไม่มีธงยืนยันบัตร ถูกบล็อก',
  test.cgt_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"cgt_p4","status":"confirmed","amount":40,"posMethod":"card"}]'::jsonb) where id = 'cgt_4' $q$) like 'ERR:P0001:punpang_card_unconfirmed:%');

-- CGT8: รายการบัตรที่ยืนยันอยู่แล้วแก้ไขได้ (ข้อมูลเดิมไม่มีธง จึงไม่ถูกบล็อก)
select test.ok('CGT8: รายการบัตรที่ยืนยันอยู่แล้วแก้ไขได้โดยไม่ถูกบล็อก',
  test.cgt_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"cgt_p2","status":"confirmed","amount":100,"posMethod":"card"}]'::jsonb) where id = 'cgt_2' $q$) = 'OK');

rollback;
