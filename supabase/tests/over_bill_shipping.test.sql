-- ทดสอบด่านยอดชำระเกินบิลกับค่าส่ง (migration 20261120190000): การจัดส่งอยู่ที่คอลัมน์ fulfillment จึงต้องนับค่าส่งเมื่อจัดส่ง
-- รันโดย supabase/tests/run.sh · ข้อมูลทดสอบใช้รหัสขึ้นต้น obs_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- ลองคำสั่ง: คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function test.obs_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- OBS1: จัดส่งที่มีค่าส่ง 50 → ยืนยันยอดรวมค่าส่ง (1050) ได้ (เดิมถูกบล็อกเพราะยอดบิลไม่นับค่าส่ง)
select test.ok('OBS1: จัดส่งที่มีค่าส่ง ยืนยันยอดรวมค่าส่งได้',
  test.obs_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('obs_1', 'OR-OBS-1', 'c1', 'payment_confirmed', 'delivery', 'web',
     '{"items":[{"unitPrice":1000,"qty":1}],"shippingFee":50,"payments":[{"id":"p1","status":"confirmed","amount":1050}]}') $q$) = 'OK');

-- OBS2: จัดส่ง ยืนยันเกินยอดรวมค่าส่งเกิน 1 สตางค์ขึ้นไปยังถูกบล็อก
select test.ok('OBS2: จัดส่ง ยืนยันเกินยอดรวมค่าส่งถูกบล็อก',
  test.obs_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('obs_2', 'OR-OBS-2', 'c1', 'payment_confirmed', 'delivery', 'web',
     '{"items":[{"unitPrice":1000,"qty":1}],"shippingFee":50,"payments":[{"id":"p1","status":"confirmed","amount":1050.02}]}') $q$) like 'ERR:P0001:punpang_over_bill:%');

-- OBS3: รับที่ร้าน (pickup) ค่าส่งในข้อมูลไม่นับเป็นยอดบิล → ยืนยัน 1050 ถูกบล็อก
select test.ok('OBS3: รับที่ร้าน ค่าส่งที่มีในข้อมูลไม่นับเป็นยอดบิล',
  test.obs_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('obs_3', 'OR-OBS-3', 'c1', 'payment_confirmed', 'pickup', 'web',
     '{"items":[{"unitPrice":1000,"qty":1}],"shippingFee":50,"payments":[{"id":"p1","status":"confirmed","amount":1050}]}') $q$) like 'ERR:P0001:punpang_over_bill:%');

-- OBS4: จัดส่งแบบส่งฟรีตามดีล ค่าส่งไม่นับ → ยืนยัน 1000 ได้ · เกิน 1000 ถูกบล็อก
select test.ok('OBS4: จัดส่งแบบส่งฟรีตามดีล ยืนยันเท่ายอดสินค้าได้',
  test.obs_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('obs_4', 'OR-OBS-4', 'c1', 'payment_confirmed', 'delivery', 'web',
     '{"items":[{"unitPrice":1000,"qty":1}],"shippingFee":50,"shipPromo":{"free":true,"name":"ส่งฟรี"},"payments":[{"id":"p1","status":"confirmed","amount":1000}]}') $q$) = 'OK');
select test.ok('OBS4: จัดส่งส่งฟรีตามดีล ยืนยันเกินยอดสินค้าถูกบล็อก',
  test.obs_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('obs_5', 'OR-OBS-5', 'c1', 'payment_confirmed', 'delivery', 'web',
     '{"items":[{"unitPrice":1000,"qty":1}],"shippingFee":50,"shipPromo":{"free":true,"name":"ส่งฟรี"},"payments":[{"id":"p1","status":"confirmed","amount":1050}]}') $q$) like 'ERR:P0001:punpang_over_bill:%');

rollback;
