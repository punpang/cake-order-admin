-- ทดสอบเพดานการขอ OTP ของสั่งล่วงหน้า (migration 20261127160000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- O1–O2: purpose preorder ใช้ได้ ค่าอื่นถูกปฏิเสธ · O3–O6: เพดานต่อเบอร์/IP/รวม · O7–O8: log เพิ่มได้อย่างเดียว

begin;

create function test.pgd_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-0000000000c1', 'otp_staff@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d7000000-0000-4000-8000-0000000000c1', 'พนักงานทดสอบ OTP', 'sales', '{createOrder}');

-- O1 purpose ใหม่ใช้บันทึก OTP ได้
select test.ok('O1 punpang_otps รับ purpose preorder',
  test.pgd_try($$insert into public.punpang_otps (id, phone, purpose, code_hash, salt, expires_at)
    values ('o1', '0800000001', 'preorder', 'x', 'y', now() + interval '5 minutes')$$) = 'OK');
-- O2 purpose อื่นยังถูกปฏิเสธ
select test.ok('O2 purpose ที่ไม่รู้จักถูกปฏิเสธ (23514)',
  left(test.pgd_try($$insert into public.punpang_otps (id, phone, purpose, code_hash, salt, expires_at)
    values ('o2', '0800000002', 'bogus', 'x', 'y', now() + interval '5 minutes')$$), 10) = 'ERR:23514:');

-- O3 เพดานต่อเบอร์ต่อชั่วโมง = 5: ครั้งที่ 1–5 ผ่าน ครั้งที่ 6 ถูกปฏิเสธ
select test.ok('O3a ครั้งที่ 1–5 ของเบอร์เดียวกันในชั่วโมงผ่าน',
  (select bool_and(public.punpang_preorder_otp_allowed('ph1', 'ip1', 'preorder')) from generate_series(1, 5)));
select test.ok('O3b ครั้งที่ 6 ของเบอร์เดียวกันในชั่วโมงถูกปฏิเสธ',
  public.punpang_preorder_otp_allowed('ph1', 'ip2', 'preorder') = false);

-- O4 เพดานต่อ IP ต่อชั่วโมง = 20 (เบอร์ต่างกันทั้งหมด)
select test.ok('O4 IP เดียวกัน 20 เบอร์ผ่าน แล้วเบอร์ที่ 21 ถูกปฏิเสธ',
  (select bool_and(public.punpang_preorder_otp_allowed('p' || g, 'ipX', 'preorder')) from generate_series(1, 20) g)
  and public.punpang_preorder_otp_allowed('p21', 'ipX', 'preorder') = false);

-- O5 purpose อื่นที่ไม่ใช่ preorder ถูกปฏิเสธโดยฟังก์ชันนี้
select test.ok('O5 ฟังก์ชันนี้รับเฉพาะ purpose preorder',
  public.punpang_preorder_otp_allowed('ph9', 'ip9', 'register') = false);

-- O6 เพดานรวมต่อวัน = 300 (ตรวจเฉพาะการนับ: เติมแถว log ให้ครบ 300 แล้วคนใหม่ถูกปฏิเสธ)
insert into public.punpang_otp_log (phone_hash, ip_hash, purpose, created_at)
  select 'bulk' || g, 'bulkip' || g, 'preorder', now() - interval '2 hours' from generate_series(1, 300) g;
select test.ok('O6 เกินเพดานรวม 300 ต่อวันถูกปฏิเสธ',
  public.punpang_preorder_otp_allowed('fresh1', 'freship', 'preorder') = false);

-- O7 log เขียนได้ผ่านฟังก์ชัน แต่ลบ/แก้ไม่ได้ (ไม่มีสิทธิ์ตารางสำหรับบทบาทแอปและ service_role)
select test.ok('O7a authenticated ลบ log ไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000c1', $$delete from public.punpang_otp_log$$), 10) = 'ERR:42501:');
select test.ok('O7b anon อ่าน log ไม่ได้ (42501)',
  left(test.as_anon($$select count(*) from public.punpang_otp_log$$), 10) = 'ERR:42501:');
select test.ok('O7c service_role ลบ log ไม่ได้ (42501)',
  left(test.pgd_try($$set local role service_role; delete from public.punpang_otp_log$$), 10) = 'ERR:42501:');

-- O8 ไม่สามารถเรียกการนับนอกธุรกรรมปัจจุบันเพื่อแก้เพดานได้: ฟังก์ชันนี้เรียกจากบทบาทแอปไม่ได้
select test.ok('O8 authenticated เรียก punpang_preorder_otp_allowed ไม่ได้',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000c1', $$select public.punpang_preorder_otp_allowed('a', 'b', 'preorder')$$), 10) = 'ERR:42501:');

rollback;
