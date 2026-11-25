-- ทดสอบการตรวจสิทธิ์ในฟังก์ชันที่ยังไม่ตรวจ perms เอง: ค้นออร์เดอร์ (punpang_order_search), ยอดบัญชียกมา (punpang_acct_opening), เลขเอกสาร (punpang_alloc_numbers)
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok, test.as_staff, test.rpc_as, test.as_anon จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น sg_ · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- นับแถวของคำสั่ง select ในฐานะผู้ใช้ที่กำหนด · คืน -1 ถ้าผิดพลาด
create function test.cnt_as(uid uuid, q text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute 'select count(*) from (' || q || ') x' into n;
  exception when others then
    execute 'reset role';
    return -1;
  end;
  execute 'reset role';
  return n;
end $$;

-- ผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงาน (ลูกค้า)
insert into auth.users (id, email) values ('ac0c0de0-0000-4000-8000-000000000001', 'sg-out@example.test') on conflict do nothing;
-- พนักงานตามสิทธิ์ต่าง ๆ
insert into auth.users (id, email) values
  ('ac0c0de0-0000-4000-8000-000000000002', 'sg-pos@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000003', 'sg-chat@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000004', 'sg-ord@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000005', 'sg-acct@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000006', 'sg-create@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000007', 'sg-pay@example.test'),
  ('ac0c0de0-0000-4000-8000-000000000008', 'sg-pick@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('ac0c0de0-0000-4000-8000-000000000002', 'SgPos', 'sales', '{pos}'),
  ('ac0c0de0-0000-4000-8000-000000000003', 'SgChat', 'sales', '{chat}'),
  ('ac0c0de0-0000-4000-8000-000000000004', 'SgOrd', 'sales', '{viewAllOrders}'),
  ('ac0c0de0-0000-4000-8000-000000000005', 'SgAcct', 'sales', '{acctReports}'),
  ('ac0c0de0-0000-4000-8000-000000000006', 'SgCreate', 'sales', '{createOrder}'),
  ('ac0c0de0-0000-4000-8000-000000000007', 'SgPay', 'sales', '{reportPayment}'),
  ('ac0c0de0-0000-4000-8000-000000000008', 'SgPick', 'sales', '{deliverPickup}');

-- ข้อมูลทดสอบ: ออร์เดอร์ 1 รายการ และรายการบัญชี 1 รายการ (ลงวันที่ 2026-11-01)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('sg_o1', 'OR-SG-1', null, 'preparing', 'pickup', 'web', '{"items":[],"payments":[],"adjustment":{"amount":0}}');
insert into public.punpang_acct_entries (id, entry_date, no, data) values
  ('sg_e1', '2026-11-01', 'SG-0001', '{"lines":[{"account":"1100","dr":500,"cr":0}]}');

-- ---------- ค้นออร์เดอร์ ----------
-- G1: ผู้ไม่ใช่พนักงานค้นออร์เดอร์ไม่ได้ (ได้ผลว่าง)
select test.ok('G1: ผู้ไม่ใช่พนักงานค้นออร์เดอร์ไม่ได้',
  test.cnt_as('ac0c0de0-0000-4000-8000-000000000001', $q$ select id from public.punpang_order_search('SG') $q$) = 0);
-- G2: พนักงานที่มีเฉพาะ pos ค้นออร์เดอร์ไม่ได้ (เฉพาะ viewAllOrders)
select test.ok('G2: พนักงาน pos ค้นออร์เดอร์ทั้งหมดไม่ได้',
  test.cnt_as('ac0c0de0-0000-4000-8000-000000000002', $q$ select id from public.punpang_order_search('SG') $q$) = 0);
-- G3: พนักงาน viewAllOrders ค้นได้
select test.ok('G3: พนักงาน viewAllOrders ค้นออร์เดอร์ได้',
  test.cnt_as('ac0c0de0-0000-4000-8000-000000000004', $q$ select id from public.punpang_order_search('SG') $q$) = 1);

-- ---------- ยอดบัญชียกมา ----------
-- A1: ผู้ไม่ใช่พนักงานได้ผลว่าง
select test.ok('A1: ผู้ไม่ใช่พนักงานอ่านยอดบัญชีไม่ได้',
  test.rpc_as('ac0c0de0-0000-4000-8000-000000000001', $q$ select public.punpang_acct_opening('2026-12-31') $q$) = '[]'::jsonb);
-- A2: พนักงานที่มีสิทธิ์บัญชีอ่านได้
select test.ok('A2: พนักงานที่มี acctReports อ่านยอดบัญชีได้',
  jsonb_array_length(test.rpc_as('ac0c0de0-0000-4000-8000-000000000005', $q$ select public.punpang_acct_opening('2026-12-31') $q$)) = 1);

-- ---------- เลขเอกสาร ----------
-- N1: ผู้ไม่ใช่พนักงานขอเลขเอกสารไม่ได้
select test.ok('N1: ผู้ไม่ใช่พนักงานขอเลขเอกสารไม่ได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000001', $q$ select public.punpang_alloc_numbers('OR', '261125', 1) $q$) like 'ERR:42501:%');
-- N2: พนักงานที่มีเฉพาะ chat ขอเลขเอกสารไม่ได้ (ต้องมี createOrder หรือ pos)
select test.ok('N2: พนักงาน chat ขอเลขเอกสารไม่ได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000003', $q$ select public.punpang_alloc_numbers('OR', '261125', 1) $q$) like 'ERR:42501:%');
-- N3: พนักงาน createOrder ขอได้
select test.ok('N3: พนักงาน createOrder ขอเลขเอกสารได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000006', $q$ select public.punpang_alloc_numbers('OR', '261125', 1) $q$) = 'OK');
-- N5: พนักงานที่มี reportPayment ขอเลข PAY ได้ (สิทธิ์นี้ออกเลข PAY)
select test.ok('N5: พนักงาน reportPayment ขอเลข PAY ได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000007', $q$ select public.punpang_alloc_numbers('PAY', '261125', 1) $q$) = 'OK');
-- N6: พนักงานที่มีเฉพาะ deliverPickup ขอเลขไม่ได้ (ไม่ออกเลขเอกสาร)
select test.ok('N6: พนักงาน deliverPickup ขอเลขไม่ได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000008', $q$ select public.punpang_alloc_numbers('OR', '261125', 1) $q$) like 'ERR:42501:%');
-- N4: พนักงาน pos ขอได้
select test.ok('N4: พนักงาน pos ขอเลขเอกสารได้',
  test.as_staff('ac0c0de0-0000-4000-8000-000000000002', $q$ select public.punpang_alloc_numbers('POS', '261125', 1) $q$) = 'OK');

rollback;
