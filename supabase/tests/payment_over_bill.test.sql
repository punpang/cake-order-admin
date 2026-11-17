-- ทดสอบด่านยอดชำระที่ยืนยันแล้วเกินยอดบิล (migration 20261117170000)
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น pob_ / OR-POB- ทำในธุรกรรมที่ย้อนกลับ

begin;

-- ลองคำสั่ง: คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>' (ผิดพลาดแล้วย้อนเฉพาะคำสั่งนั้น)
create function test.pob_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- POB1: สร้างออร์เดอร์ที่ยอดยืนยันเท่ายอดบิลได้ · ยอดยืนยันเกินยอดบิลสร้างไม่ได้
select test.ok('POB1: สร้างออร์เดอร์ที่ยอดยืนยันเท่ายอดบิลได้',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_ok', 'OR-POB-1', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}]}') $q$) = 'OK');
select test.ok('POB1: สร้างออร์เดอร์ที่ยอดยืนยันเกินยอดบิลไม่ได้',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_over', 'OR-POB-2', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1001}]}') $q$) like 'ERR:P0001:punpang_over_bill:%');

-- POB2: เกินยอดบิลไม่ถึง 1 สตางค์ยังผ่าน (ค่าคลาดเคลื่อนเศษสตางค์) · เกิน 2 สตางค์ถูกบล็อก
select test.ok('POB2: เกินยอดบิลไม่ถึง 1 สตางค์ยังผ่าน',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_tol', 'OR-POB-3', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000.01}]}') $q$) = 'OK');
select test.ok('POB2: เกินยอดบิล 2 สตางค์ถูกบล็อก',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_tol2', 'OR-POB-4', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000.02}]}') $q$) like 'ERR:P0001:punpang_over_bill:%');

-- POB3: แก้ออร์เดอร์ให้ยอดยืนยันเกินยอดบิลถูกบล็อก · จนเท่ายอดบิลผ่าน
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('pob_base', 'OR-POB-5', 'c1', 'awaiting_payment', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[]}');
select test.ok('POB3: เพิ่มยอดยืนยันเกินยอดบิลตอนแก้ไขถูกบล็อก',
  test.pob_try($q$ update public.punpang_orders set data = '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":900},{"id":"p2","status":"confirmed","amount":200}]}' where id = 'pob_base' $q$) like 'ERR:P0001:punpang_over_bill:%');
select test.ok('POB3: เพิ่มยอดยืนยันจนเท่ายอดบิลผ่าน',
  test.pob_try($q$ update public.punpang_orders set data = '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":900},{"id":"p2","status":"confirmed","amount":100}]}' where id = 'pob_base' $q$) = 'OK');

-- POB4: ลดยอดยืนยัน หรือลดยอดบิลโดยยอดยืนยันคงเดิม ไม่ถูกบล็อก · หลังยอดบิลลด การเพิ่มยอดยืนยันเกินยอดบิลใหม่ยังถูกบล็อก
select test.ok('POB4: ลดยอดยืนยันไม่ถูกบล็อก',
  test.pob_try($q$ update public.punpang_orders set data = '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":500}]}' where id = 'pob_base' $q$) = 'OK');
select test.ok('POB4: ลดยอดบิลโดยยอดยืนยันคงเดิมไม่ถูกบล็อก',
  test.pob_try($q$ update public.punpang_orders set data = '{"items":[{"id":"x1","unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":500}]}' where id = 'pob_base' $q$) = 'OK');
select test.ok('POB4: หลังยอดบิลลด การเพิ่มยอดยืนยันเกินยอดบิลใหม่ถูกบล็อก',
  test.pob_try($q$ update public.punpang_orders set data = '{"items":[{"id":"x1","unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":500},{"id":"p2","status":"confirmed","amount":100}]}' where id = 'pob_base' $q$) like 'ERR:P0001:punpang_over_bill:%');

-- POB5: รายการรอตรวจและรายการที่ยกเลิกแล้วไม่นับเป็นยอดยืนยัน
select test.ok('POB5: รายการรอตรวจ (ยังไม่ยืนยัน) ไม่นับเป็นยอดยืนยัน',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_rep', 'OR-POB-6', 'c1', 'awaiting_payment', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"reported","amount":5000}]}') $q$) = 'OK');
select test.ok('POB5: รายการที่ยกเลิกแล้วไม่นับเป็นยอดยืนยัน',
  test.pob_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_can', 'OR-POB-7', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1},{"id":"x2","unitPrice":0,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000},{"id":"p2","status":"cancelled","amount":500}]}') $q$) = 'OK');

-- POB6: แก้ข้อมูลที่ไม่เกี่ยวกับยอดชำระ ไม่ถูกบล็อก
select test.ok('POB6: แก้ข้อมูลที่ไม่เกี่ยวกับยอดชำระไม่ถูกบล็อก',
  test.pob_try($q$ update public.punpang_orders set data = data || '{"note":"ทดสอบ"}' where id = 'pob_ok' $q$) = 'OK');

-- POB7: ฟังก์ชันภายในไม่เปิดให้ผู้ใช้ทั่วไปและ anon เรียก · ด่านติดกับตารางออร์เดอร์แล้ว
select test.ok('POB7: ผู้ใช้ทั่วไปและ anon เรียกฟังก์ชันคำนวณยอดไม่ได้',
  not has_function_privilege('authenticated', 'public.punpang__bill_total(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.punpang__bill_total(jsonb)', 'execute')
  and not has_function_privilege('authenticated', 'public.punpang__paid_confirmed(jsonb)', 'execute')
  and not has_function_privilege('anon', 'public.punpang__paid_confirmed(jsonb)', 'execute'));
select test.ok('POB7: ด่านติดกับตารางออร์เดอร์แล้ว',
  exists (select 1 from pg_trigger where tgname = 'punpang_orders_payment_over_bill' and tgrelid = 'public.punpang_orders'::regclass and not tgisinternal));

-- POB8: โหมดทดสอบข้ามด่านนี้ (ข้อมูลจำลองสร้างตามสถานะสุดท้ายได้) · ตารางจริง (public) ยังถูกบังคับ
select test.ok('POB8: โหมดทดสอบสร้างออร์เดอร์ที่ยอดยืนยันเกินยอดบิลได้ (ตามข้อมูลจำลอง)',
  test.pob_try($q$ insert into punpang_test.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('pob_test', 'OR-POB-8', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"x1","unitPrice":1000,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1001}]}') $q$) = 'OK');

rollback;

select 'ผ่านทั้งหมด' as payment_over_bill_tests;
