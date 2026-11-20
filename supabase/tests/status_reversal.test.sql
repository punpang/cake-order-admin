-- ทดสอบการย้อนสถานะต้องมีสิทธิ์ revertStatus (รันหลัง security.test.sql · ทั้งไฟล์อยู่ในธุรกรรมที่ย้อนกลับเมื่อจบ ไม่ทิ้งข้อมูลไว้)
begin;

create schema sr;

create function sr.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- รันคำสั่งในฐานะพนักงาน (authenticated + sub = uid) · คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function sr.as_staff(uid uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return 'OK';
end $$;

insert into auth.users (id, email) values
  ('aa000000-0000-0000-0000-000000000001', 'sr-dlv@t'),
  ('aa000000-0000-0000-0000-000000000002', 'sr-cancel@t'),
  ('aa000000-0000-0000-0000-000000000003', 'sr-revert@t'),
  ('aa000000-0000-0000-0000-000000000004', 'sr-baker@t');

insert into public.punpang_staff (user_id, name, role, perms) values
  ('aa000000-0000-0000-0000-000000000001', 'SR DeliverPickup', 'sales', '{deliverPickup,viewAllOrders}'),
  ('aa000000-0000-0000-0000-000000000002', 'SR CancelOnly', 'sales', '{cancel,viewAllOrders}'),
  ('aa000000-0000-0000-0000-000000000003', 'SR Revert', 'admin', '{revertStatus,cancel,deliverPickup,viewAllOrders}'),
  ('aa000000-0000-0000-0000-000000000004', 'SR Baker', 'baker', '{startPreparing,markPrepared,viewPrepOrders}');

insert into public.punpang_customers (id, name, phone, data) values
  ('c_sr', 'SR customer', '0899990001', '{"ledger":[],"spins":0}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('sr_cxl',  'SR-CXL',  'c_sr', 'cancelled',       'pickup', 'web', '{"items":[]}'),
  ('sr_dlv',  'SR-DLV',  'c_sr', 'delivered',       'pickup', 'web', '{"items":[]}'),
  ('sr_dlv2', 'SR-DLV2', 'c_sr', 'delivered',       'pickup', 'web', '{"items":[]}'),
  ('sr_dlv3', 'SR-DLV3', 'c_sr', 'delivered',       'pickup', 'web', '{"items":[]}'),
  ('sr_awt',  'SR-AWT',  'c_sr', 'awaiting_payment', 'pickup', 'web', '{"items":[]}'),
  ('sr_cfm',  'SR-CFM',  'c_sr', 'order_confirmed', 'pickup', 'web', '{"items":[]}'),
  ('sr_pm',   'SR-PM',   'c_sr', 'order_confirmed', 'pickup', 'web', '{"items":[]}');

-- 1) ออร์เดอร์ที่ยกเลิกแล้ว: ผู้มีแค่ deliverPickup กลับเป็นส่งมอบไม่ได้ (เดิมทำได้)
select sr.ok('cancelled→delivered ด้วย deliverPickup อย่างเดียวถูกปฏิเสธ',
  sr.as_staff('aa000000-0000-0000-0000-000000000001', $q$update public.punpang_orders set status = 'delivered' where id = 'sr_cxl'$q$) = 'ERR:42501:no permission to change status (revertStatus)');
select sr.ok('สถานะ sr_cxl ยังเป็น cancelled', (select status from public.punpang_orders where id = 'sr_cxl') = 'cancelled');

-- 2) ออร์เดอร์ที่ส่งมอบแล้ว: ผู้มีแค่ cancel ยกเลิกไม่ได้ (เดิมทำได้)
select sr.ok('delivered→cancelled ด้วย cancel อย่างเดียวถูกปฏิเสธ',
  sr.as_staff('aa000000-0000-0000-0000-000000000002', $q$update public.punpang_orders set status = 'cancelled' where id = 'sr_dlv'$q$) = 'ERR:42501:no permission to change status (revertStatus)');
select sr.ok('สถานะ sr_dlv ยังเป็น delivered', (select status from public.punpang_orders where id = 'sr_dlv') = 'delivered');

-- 3) ผู้มี revertStatus ย้อนได้ทั้งสองทาง
select sr.ok('delivered→cancelled ด้วย revertStatus ผ่าน',
  sr.as_staff('aa000000-0000-0000-0000-000000000003', $q$update public.punpang_orders set status = 'cancelled' where id = 'sr_dlv'$q$) = 'OK');
select sr.ok('cancelled→delivered ด้วย revertStatus ผ่าน',
  sr.as_staff('aa000000-0000-0000-0000-000000000003', $q$update public.punpang_orders set status = 'delivered' where id = 'sr_cxl'$q$) = 'OK');

-- 4) การเปลี่ยนสถานะปกติที่ไม่ใช่การย้อนยังทำได้ตามสิทธิ์เดิม
select sr.ok('awaiting_payment→cancelled ด้วย cancel ผ่าน (ไม่ใช่การย้อน)',
  sr.as_staff('aa000000-0000-0000-0000-000000000002', $q$update public.punpang_orders set status = 'cancelled' where id = 'sr_awt'$q$) = 'OK');
select sr.ok('order_confirmed→preparing ด้วย startPreparing ผ่าน',
  sr.as_staff('aa000000-0000-0000-0000-000000000004', $q$update public.punpang_orders set status = 'preparing' where id = 'sr_cfm'$q$) = 'OK');

-- 5) RPC punpang_set_status ต้องไม่ใช้ช่องทางนี้ย้อนสถานะแทนได้: ผู้ช่วยครัว (markPrepared) เปลี่ยน delivered→prepared ไม่ได้
select sr.ok('punpang_set_status ย้อน delivered→prepared ด้วย markPrepared ถูกปฏิเสธ',
  sr.as_staff('aa000000-0000-0000-0000-000000000004', $q$select public.punpang_set_status('sr_dlv2', 'prepared')$q$) = 'ERR:42501:no permission (revertStatus)');
select sr.ok('สถานะ sr_dlv2 ยังเป็น delivered', (select status from public.punpang_orders where id = 'sr_dlv2') = 'delivered');

-- 6) punpang_set_status ยังเปลี่ยนสถานะปกติได้ตามสิทธิ์เดิม (ไม่ใช่การย้อน)
select sr.ok('punpang_set_status order_confirmed→preparing ด้วย startPreparing ผ่าน',
  sr.as_staff('aa000000-0000-0000-0000-000000000004', $q$select public.punpang_set_status('sr_pm', 'preparing')$q$) = 'OK');
select sr.ok('สถานะ sr_pm เป็น preparing', (select status from public.punpang_orders where id = 'sr_pm') = 'preparing');

rollback;
