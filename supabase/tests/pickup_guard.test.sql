-- ทดสอบเวลานัดรับของออร์เดอร์ (migration 20261120170000): เปลี่ยนได้เฉพาะผู้มี editPickup หรือ manage
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok และ test.as_staff จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น pk_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- ลองคำสั่ง: คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>' (ผิดพลาดแล้วย้อนเฉพาะคำสั่งนั้น)
create function test.pk_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- พนักงานที่มีเฉพาะสิทธิ์แก้เวลานัด (ผู้ทดสอบ)
insert into auth.users (id, email) values ('ab0c0de0-0000-4000-8000-00000000f1c1', 'pickup-only@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('ab0c0de0-0000-4000-8000-00000000f1c1', 'PickupOnly', 'sales', '{editPickup}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, pickup_at, data) values
  ('pk_1', 'OR-PK-1', 'c1', 'preparing', 'pickup', 'web', '2026-11-21 10:00:00+07',
   '{"pickupAt":"2026-11-21T10:00","items":[{"unitPrice":300,"qty":1,"workPhotos":[]}],"payments":[],"adjustment":{"amount":0}}');

-- PK1: ช่าง (มี workPhoto แต่ไม่มี editPickup) แก้ pickup_at ไม่ได้ · แก้ data.pickupAt ก็ไม่ได้
select test.ok('PK1: ช่างเปลี่ยน pickup_at ไม่ได้',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ update public.punpang_orders set pickup_at = '2026-11-22 10:00:00+07' where id = 'pk_1' $q$) like 'ERR:42501:%');
select test.ok('PK1: ช่างเปลี่ยน data.pickupAt ไม่ได้',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ update public.punpang_orders set data = jsonb_set(data, '{pickupAt}', '"2026-11-22T10:00"') where id = 'pk_1' $q$) like 'ERR:42501:%');
select test.ok('PK1: ค่าเวลานัดไม่เปลี่ยนก็ไม่ถูกบล็อก (ช่างบันทึกรูปงานได้ตามเดิม)',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ update public.punpang_orders set data = jsonb_set(data, '{items,0,workPhotos}', '[]'::jsonb) where id = 'pk_1' $q$) = 'OK');

-- PK2: ผู้มี editPickup และผู้จัดการ (manage) เปลี่ยนเวลานัดได้
select test.ok('PK2: ผู้มี editPickup เปลี่ยน pickup_at ได้',
  test.as_staff('ab0c0de0-0000-4000-8000-00000000f1c1', $q$ update public.punpang_orders set pickup_at = '2026-11-22 10:00:00+07' where id = 'pk_1' $q$) = 'OK');
select test.ok('PK2: ผู้จัดการ (manage) เปลี่ยน pickup_at ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$ update public.punpang_orders set pickup_at = '2026-11-23 10:00:00+07' where id = 'pk_1' $q$) = 'OK');

-- PK3: การเขียนฝั่งเซิร์ฟเวอร์ (ไม่มี JWT / role postgres) ไม่ถูกกติกานี้บล็อก
select test.ok('PK3: เซิร์ฟเวอร์ (role postgres) เปลี่ยนเวลานัดได้',
  test.pk_try($q$ update public.punpang_orders set pickup_at = '2026-11-24 10:00:00+07' where id = 'pk_1' $q$) = 'OK');

rollback;
