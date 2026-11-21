-- ทดสอบกะ POS (punpang_shifts) ระดับฐานข้อมูล: สิทธิ์เปิด/ปิดกะ · เปิดได้ครั้งละหนึ่งกะ · กะที่ปิดแล้วแก้ไม่ได้ · คอลัมน์ระบบถูกล็อก · ไม่มีสิทธิ์ลบ · การมองเห็นกะตามสิทธิ์
-- รันโดย run.sh หลัง security.test.sql (ใช้ test.as_staff · test.rpc_as · test.as_anon) · แต่ละข้อใช้ sh.ok(ชื่อ, เงื่อนไข) · เงื่อนไขไม่เป็นจริง = ล้มทันที

create schema sh;

create function sh.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- ผู้ใช้ทดสอบ: มีสิทธิ์ pos (เปิด/ปิดกะ) กับไม่มีสิทธิ์ pos (มีแค่ createOrder)
insert into auth.users (id, email) values
  ('a5a5a5a5-0000-4000-8000-00000000a001', 'shift-pos@t'),
  ('a5a5a5a5-0000-4000-8000-00000000a002', 'shift-nopos@t');
insert into public.punpang_staff (user_id, name, role, perms) values
  ('a5a5a5a5-0000-4000-8000-00000000a001', 'ทดสอบกะ มีสิทธิ์', 'sales', '{pos}'),
  ('a5a5a5a5-0000-4000-8000-00000000a002', 'ทดสอบกะ ไม่มีสิทธิ์', 'sales', '{createOrder}');

-- A: การเปิดและปิดกะ
-- A1 ผู้มีสิทธิ์ pos เปิดกะได้
select sh.ok('A1 ผู้มีสิทธิ์ pos เปิดกะได้',
  test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ insert into public.punpang_shifts (id, opened_at) values ('SH-T-1', now()) $q$) = 'OK');

-- A2 เปิดกะซ้อนไม่ได้ (มีกะเปิดอยู่แล้ว) · ดัชนีกะเปิดเดียวปฏิเสธ (23505)
select sh.ok('A2 เปิดกะซ้อนไม่ได้ (ดัชนีกะเปิดเดียว)',
  split_part(test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ insert into public.punpang_shifts (id, opened_at) values ('SH-T-X', now()) $q$), ':', 2) = '23505');

-- A3 ผู้ไม่มีสิทธิ์ pos ปิดกะไม่ได้ · นโยบายแก้ไขกรองออก ไม่มีแถวถูกแก้ (ไม่มีข้อผิดพลาด)
select test.as_staff('a5a5a5a5-0000-4000-8000-00000000a002',
  $q$ update public.punpang_shifts set closed_at = now() where id = 'SH-T-1' $q$);
select sh.ok('A3 ผู้ไม่มีสิทธิ์ pos ปิดกะไม่ได้ (กะยังเปิดอยู่)',
  exists (select 1 from public.punpang_shifts where id = 'SH-T-1' and closed_at is null));

-- A4 ผู้ไม่ได้ล็อกอิน (anon) เปิดกะไม่ได้
select sh.ok('A4 ผู้ไม่ได้ล็อกอิน เปิดกะไม่ได้ (42501)',
  split_part(test.as_anon($q$ insert into public.punpang_shifts (id, opened_at) values ('SH-T-A', now()) $q$), ':', 2) = '42501');

-- A5 ผู้มีสิทธิ์ pos ปิดกะได้ (แยกคำสั่ง: คำสั่งเดียวกันไม่เห็นผลของ UPDATE ที่เกิดในฟังก์ชัน)
select sh.ok('A5 ผู้มีสิทธิ์ pos ปิดกะได้',
  test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ update public.punpang_shifts set closed_at = now() where id = 'SH-T-1' $q$) = 'OK');
select sh.ok('A5 ตรวจผล: กะ SH-T-1 ถูกปิดแล้ว',
  exists (select 1 from public.punpang_shifts where id = 'SH-T-1' and closed_at is not null));

-- A6 ผู้ไม่มีสิทธิ์ pos เปิดกะไม่ได้ (ไม่มีกะเปิดอยู่แล้ว จึงตัดปัญหาดัชนีออก)
select sh.ok('A6 ผู้ไม่มีสิทธิ์ pos เปิดกะไม่ได้ (42501)',
  split_part(test.as_staff('a5a5a5a5-0000-4000-8000-00000000a002',
    $q$ insert into public.punpang_shifts (id, opened_at) values ('SH-T-N', now()) $q$), ':', 2) = '42501');

-- A7 เปิดกะใหม่ได้หลังปิดกะก่อนหน้า
select sh.ok('A7 เปิดกะใหม่ได้หลังปิดกะก่อนหน้า',
  test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ insert into public.punpang_shifts (id, opened_at) values ('SH-T-2', now()) $q$) = 'OK');

-- B: กะที่ปิดแล้วและคอลัมน์ระบบ
-- B1 แก้กะที่ปิดแล้วไม่ได้ (P0001 · กฎของทริกเกอร์)
select sh.ok('B1 แก้กะที่ปิดแล้วไม่ได้ (P0001)',
  split_part(test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ update public.punpang_shifts set data = '{"x":1}'::jsonb where id = 'SH-T-1' $q$), ':', 2) = 'P0001');

-- B2 คอลัมน์ระบบ (id, opened_at, created_at) แก้ไม่ได้: ค่าเดิมคงอยู่ และไม่เกิดแถว HACK
do $$
declare before_at timestamptz; ok_row boolean;
begin
  select opened_at into before_at from public.punpang_shifts where id = 'SH-T-2';
  perform test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ update public.punpang_shifts set opened_at = '2000-01-01T00:00:00Z', created_at = '2000-01-01T00:00:00Z', id = 'HACK' where id = 'SH-T-2' $q$);
  select (opened_at = before_at) and not exists (select 1 from public.punpang_shifts where id = 'HACK')
    into ok_row from public.punpang_shifts where id = 'SH-T-2';
  perform sh.ok('B2 คอลัมน์ระบบ (id, opened_at, created_at) แก้ไม่ได้', coalesce(ok_row, false));
end $$;

-- B3 ไม่มีสิทธิ์ลบกะ (42501)
select sh.ok('B3 ลบกะไม่ได้ (42501)',
  split_part(test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ delete from public.punpang_shifts where id = 'SH-T-2' $q$), ':', 2) = '42501');

-- B4 การมองเห็นกะ: ไม่มีสิทธิ์ pos ไม่เห็นกะ (0 แถว) · มีสิทธิ์ pos เห็นกะที่สร้างไว้ (อย่างน้อย 2)
select sh.ok('B4 ผู้ไม่มีสิทธิ์ pos มองไม่เห็นกะ · ผู้มีสิทธิ์เห็น',
  (test.rpc_as('a5a5a5a5-0000-4000-8000-00000000a002',
     $q$ select jsonb_build_object('n', count(*)) from public.punpang_shifts $q$) ->> 'n')::int = 0
  and (test.rpc_as('a5a5a5a5-0000-4000-8000-00000000a001',
     $q$ select jsonb_build_object('n', count(*)) from public.punpang_shifts $q$) ->> 'n')::int >= 2);

-- C: ปิดรอบทดสอบ
-- C1 ปิดกะที่เหลือ จนไม่มีกะเปิดค้างหลังทดสอบ (แยกคำสั่งตรวจผล)
select sh.ok('C1 ปิดกะทดสอบทั้งหมดได้',
  test.as_staff('a5a5a5a5-0000-4000-8000-00000000a001',
    $q$ update public.punpang_shifts set closed_at = now() where closed_at is null $q$) = 'OK');
select sh.ok('C1 ตรวจผล: ไม่มีกะเปิดค้าง',
  not exists (select 1 from public.punpang_shifts where closed_at is null));
