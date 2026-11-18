-- ทดสอบรหัสสมาชิกสำหรับบาร์โค้ด: รหัสซ้ำไม่ได้ · การเขียนทับ data โดยไม่มี scanCode ไม่ทำให้รหัสหาย · การเปลี่ยนรหัสโดยตั้งใจทำได้
-- รันโดย supabase/tests/run.sh หลัง migration ทั้งหมด (ใช้ test.ok จาก security.test.sql) · ข้อมูลทดสอบใช้รหัสขึ้นต้น ms_
-- ทำในธุรกรรมที่ย้อนกลับ
begin;

insert into public.punpang_customers (id, name, phone, data) values
  ('ms_c1', 'ทดสอบ ก', '0800000001', '{"ledger":[],"scanCode":"0123456789abcdef0123456789abcdef"}'),
  ('ms_c2', 'ทดสอบ ข', '0800000002', '{"ledger":[]}');

do $$
declare dup boolean := false;
begin
  begin
    insert into public.punpang_customers (id, name, phone, data)
      values ('ms_c3', 'ทดสอบ ค', '0800000003', '{"scanCode":"0123456789abcdef0123456789abcdef"}');
  exception when unique_violation then dup := true;
  end;
  if not dup then raise exception 'รหัสสมาชิกซ้ำกันได้'; end if;
end
$$;

update public.punpang_customers set data = '{"ledger":[],"note":"เขียนทับ"}' where id = 'ms_c1';
select test.ok('เขียนทับ data โดยไม่มี scanCode แล้วรหัสเดิมยังอยู่', (select data->>'scanCode' from public.punpang_customers where id = 'ms_c1') = '0123456789abcdef0123456789abcdef');

update public.punpang_customers set data = jsonb_set(data, '{scanCode}', '"fedcba9876543210fedcba9876543210"') where id = 'ms_c1';
select test.ok('เปลี่ยนรหัสโดยตั้งใจ (มีค่าใหม่ใน data) ได้ผล', (select data->>'scanCode' from public.punpang_customers where id = 'ms_c1') = 'fedcba9876543210fedcba9876543210');

select test.ok('ลูกค้าที่ยังไม่มีรหัสยังไม่ถูกสร้างรหัสโดยทริกเกอร์ (สร้างโดย ensure_scan_code)', (select data ? 'scanCode' from public.punpang_customers where id = 'ms_c2') = false);

rollback;
