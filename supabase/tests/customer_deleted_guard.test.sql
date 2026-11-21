-- ทดสอบด่านลูกค้าที่ถูกลบ (migration 20261121090100): แทรกออร์เดอร์ใหม่ให้ลูกค้าที่ถูกลบแล้วต้องถูกบล็อก
-- รันโดย supabase/tests/run.sh หลัง card_gate.test.sql (ใช้ test.ok จาก security.test.sql) · ข้อมูลทดสอบใช้รหัสขึ้นต้น cdg_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- ลองคำสั่งของเซิร์ฟเวอร์ (role postgres): คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function test.cdg_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

insert into public.punpang_customers (id, name, data) values
  ('cdg_active', 'ลูกค้าปกติ', '{}'),
  ('cdg_deleted', 'ลูกค้าที่ลบแล้ว', '{"deleted": true}');

-- CDG1: ออร์เดอร์ใหม่ของลูกค้าที่ถูกลบแล้ว → ถูกบล็อก
select test.ok('CDG1: ออร์เดอร์ใหม่ของลูกค้าที่ถูกลบแล้ว ถูกบล็อก',
  test.cdg_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cdg_o1', 'OR-CDG-1', 'cdg_deleted', 'pos_pending', 'pickup', 'pos', '{"items":[{"unitPrice":100,"qty":1}],"payments":[]}') $q$) like 'ERR:P0001:punpang_customer_deleted:%');

-- CDG2: ออร์เดอร์ใหม่ของลูกค้าปกติ → บันทึกได้
select test.ok('CDG2: ออร์เดอร์ใหม่ของลูกค้าปกติ บันทึกได้',
  test.cdg_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cdg_o2', 'OR-CDG-2', 'cdg_active', 'pos_pending', 'pickup', 'pos', '{"items":[{"unitPrice":100,"qty":1}],"payments":[]}') $q$) = 'OK');

-- CDG3: ออร์เดอร์ที่ไม่ผูกลูกค้า (ลูกค้าทั่วไป) → บันทึกได้
select test.ok('CDG3: ออร์เดอร์ที่ไม่ผูกลูกค้า บันทึกได้',
  test.cdg_try($q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
    ('cdg_o3', 'OR-CDG-3', null, 'pos_pending', 'pickup', 'pos', '{"items":[{"unitPrice":100,"qty":1}],"payments":[]}') $q$) = 'OK');

rollback;
