-- ทดสอบสิทธิ์ของ collection consignRounds (สรุปยอดฝากขาย · migration 20261125100000)
-- ครอบคลุม: allow-list รับชื่อใหม่ · ผู้ดูยอดออร์เดอร์อ่านได้แต่เขียนไม่ได้ · ผู้จัดการเขียนได้
-- รันโดย supabase/tests/run.sh (ใช้ test.ok และ test.as_staff จาก security.test.sql) · ทำในธุรกรรมที่ย้อนกลับ

begin;

insert into auth.users (id, email) values
  ('c5000000-0000-4000-8000-000000000001', 'cs_view@example.test'),
  ('c5000000-0000-4000-8000-000000000002', 'cs_mgr@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('c5000000-0000-4000-8000-000000000001', 'ผู้ดูยอด', 'sales', '{viewAllOrders}'),
  ('c5000000-0000-4000-8000-000000000002', 'ผู้จัดการ', 'admin', '{manage}');

-- ข้อมูลตั้งต้นโดยระบบ (ไม่ผ่านสิทธิ์พนักงาน)
insert into public.punpang_records (collection, id, data) values ('consignRounds', 'cr_seed', '{"consignor":"ก","from":"2026-11-01","to":"2026-11-15","sales":100,"payout":30,"shop":70}');

select test.ok('CR1 allow-list รับ consignRounds (เขียนข้อมูลระบบได้)',
  (select count(*) from public.punpang_records where collection = 'consignRounds') = 1);

select test.ok('CR2 ผู้ดูยอดออร์เดอร์เขียนรอบฝากขายไม่ได้',
  test.as_staff('c5000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_records (collection, id, data) values ('consignRounds', 'cr_bad', '{}')$$) <> 'OK');

select test.ok('CR3 ผู้ดูยอดออร์เดอร์อ่านรอบฝากขายได้',
  test.as_staff('c5000000-0000-4000-8000-000000000001', $q$
    do $d$ begin
      if (select count(*) from public.punpang_records where collection = 'consignRounds') < 1 then
        raise exception 'read denied';
      end if;
    end $d$$q$) = 'OK');

select test.ok('CR4 ผู้จัดการเขียนรอบฝากขายได้ (สรุปรอบ)',
  test.as_staff('c5000000-0000-4000-8000-000000000002', $$
    insert into public.punpang_records (collection, id, data) values ('consignRounds', 'cr_mgr', '{"consignor":"ข"}')$$) = 'OK');

rollback;
