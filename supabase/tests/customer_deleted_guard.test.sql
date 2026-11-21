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

-- I-2: UPDATE ที่เปลี่ยน customer_id ไปหาลูกค้าที่ถูกลบแล้วต้องถูกบล็อก (เดิมด่านตรวจเฉพาะการแทรก)

-- CDG4: ย้ายออร์เดอร์ที่มีอยู่ (ไม่มีลูกค้า) ไปหาลูกค้าที่ถูกลบแล้ว → ถูกบล็อก
select test.ok('CDG4: ย้ายออร์เดอร์ที่มีอยู่ไปหาลูกค้าที่ถูกลบแล้ว ถูกบล็อก',
  test.cdg_try($q$ update public.punpang_orders set customer_id = 'cdg_deleted' where id = 'cdg_o3' $q$) like 'ERR:P0001:punpang_customer_deleted:%');

-- CDG5: ย้ายออร์เดอร์ที่มีอยู่ไปหาลูกค้าปกติ → ทำได้
select test.ok('CDG5: ย้ายออร์เดอร์ที่มีอยู่ไปหาลูกค้าปกติ ทำได้',
  test.cdg_try($q$ update public.punpang_orders set customer_id = 'cdg_active' where id = 'cdg_o3' $q$) = 'OK');

-- CDG6: ลูกค้าถูกลบหลังมีออร์เดอร์แล้ว → แก้ข้อมูลอื่นของออร์เดอร์เดิมได้ และส่ง customer_id เดิมซ้ำได้ (แอปส่งค่านี้ทุกครั้งที่บันทึก)
update public.punpang_customers set data = '{"deleted": true}' where id = 'cdg_active';
select test.ok('CDG6: ออร์เดอร์เดิมของลูกค้าที่ถูกลบแล้ว แก้ข้อมูลอื่นได้',
  test.cdg_try($q$ update public.punpang_orders set data = jsonb_set(data, '{note}', '"ทดสอบ"') where id = 'cdg_o2' $q$) = 'OK');
select test.ok('CDG6: ส่ง customer_id เดิมของลูกค้าที่ถูกลบแล้วซ้ำ ไม่ถูกบล็อก',
  test.cdg_try($q$ update public.punpang_orders set customer_id = 'cdg_active' where id = 'cdg_o2' $q$) = 'OK');

-- CDG7: ย้ายออร์เดอร์จากลูกค้าที่ถูกลบแล้วไปหาลูกค้าปกติ → ทำได้ (แก้ไขให้หลุดจากลูกค้าที่ถูกลบได้)
insert into public.punpang_customers (id, name, data) values ('cdg_active2', 'ลูกค้าปกติ 2', '{}');
select test.ok('CDG7: ย้ายออร์เดอร์จากลูกค้าที่ถูกลบแล้วไปหาลูกค้าปกติ ทำได้',
  test.cdg_try($q$ update public.punpang_orders set customer_id = 'cdg_active2' where id = 'cdg_o2' $q$) = 'OK');

rollback;
