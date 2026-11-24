-- ทดสอบเลขที่ PRE- ของสั่งล่วงหน้า (migration 20261127120000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ

begin;

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-0000000000b1', 'pn_admin@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d7000000-0000-4000-8000-0000000000b1', 'ผู้จัดการเลข', 'admin', '{manage}');

-- N1 เซิร์ฟเวอร์ออกเลข PRE ต่อเนื่อง: ครั้งที่สองเริ่มหลังครั้งแรกเท่ากับจำนวนที่ขอ
select test.ok('N1 เซิร์ฟเวอร์ออกเลข PRE ต่อเนื่องกัน',
  (select public.punpang_alloc_numbers_server('PRE', '241124', 2)) + 2
    = (select public.punpang_alloc_numbers_server('PRE', '241124', 1)));

-- N2 prefix ที่ไม่รู้จักถูกปฏิเสธฝั่งเซิร์ฟเวอร์
do $$
declare rejected boolean := false;
begin
  begin
    perform public.punpang_alloc_numbers_server('XXX', '241124', 1);
  exception when others then
    rejected := true;
  end;
  perform test.ok('N2 เซิร์ฟเวอร์ปฏิเสธ prefix XXX', rejected);
end $$;

-- N3 พนักงานที่มีสิทธิ์ขอเลข PRE ล่วงหน้าได้ (แอปเรียกผ่าน prefetch)
select test.ok('N3 พนักงานขอเลข PRE ได้',
  test.as_staff('d7000000-0000-4000-8000-0000000000b1',
    $$select public.punpang_alloc_numbers('PRE', '241124', 2)$$) = 'OK');

-- N4 พนักงานเรียกฝั่งเซิร์ฟเวอร์ไม่ได้ (จำกัดเฉพาะ service_role)
select test.ok('N4 พนักงานเรียกตัวออกเลขฝั่งเซิร์ฟเวอร์ไม่ได้',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000b1',
    $$select public.punpang_alloc_numbers_server('PRE', '241124', 1)$$), 10) = 'ERR:42501:');

rollback;
