-- ทดสอบเซสชันของสั่งล่วงหน้าแยกจากเซสชันลูกค้า และการลบข้อมูลลูกค้า (migration 20261127170000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- PS1–PS2: เซสชันอ่านไม่ได้จากบทบาทแอปและ anon · PS3: service_role ออกและอ่านเซสชันได้ · PS4–PS5: การลบลูกค้าถูกกั้นเมื่อมีออร์เดอร์ค้าง และลบเซสชันกับปกปิดข้อมูลเมื่อเสร็จ

begin;

create function test.pgd_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-0000000000d1', 'ps_manage@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d7000000-0000-4000-8000-0000000000d1', 'ผู้จัดการทดสอบลบข้อมูล', 'admin', '{manage}');

insert into public.punpang_customers (id, name, phone, data) values ('pu1', 'ลูกค้าลบข้อมูล', '0800000099', '{}');
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('pu_camp', 'closed', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120, '{"name":"ทดสอบลบ","dayCap":null,"items":[]}');
insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, customer_id, data)
  values ('pu_o1', 'pu_camp', 'PRE-241124-900101', 'awaiting_payment', '2099-12-24', 'pu1', '{"address":"บ้านเลขที่ 1","status":"awaiting_payment"}');
insert into public.punpang_preorder_sessions (token_hash, customer_id, expires_at)
  values ('presess:abc', 'pu1', now() + interval '14 days');

-- PS1–PS2 บทบาทแอปและ anon อ่านเซสชันไม่ได้
select test.ok('PS1 พนักงานอ่านเซสชันสั่งล่วงหน้าไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000d1', $$select count(*) from public.punpang_preorder_sessions$$), 10) = 'ERR:42501:');
select test.ok('PS2 anon อ่านเซสชันสั่งล่วงหน้าไม่ได้ (42501)',
  left(test.as_anon($$select count(*) from public.punpang_preorder_sessions$$), 10) = 'ERR:42501:');

-- PS3 service_role ออกเซสชันและอ่านได้
do $$
declare cnt int;
begin
  set local role service_role;
  insert into public.punpang_preorder_sessions (token_hash, customer_id, expires_at) values ('presess:def', 'pu1', now() + interval '1 day');
  select count(*) into cnt from public.punpang_preorder_sessions where token_hash = 'presess:def';
  reset role;
  perform test.ok('PS3 service_role ออกเซสชันใหม่และอ่านได้', cnt = 1);
end $$;

-- PS4 มีออร์เดอร์ค้างจ่าย: การลบถูกกั้น (เซสชันยังอยู่ ข้อมูลยังไม่ถูกปกปิด)
select test.as_staff('d7000000-0000-4000-8000-0000000000d1', $$select public.punpang_purge_customer('pu1', '{}')$$);
select test.ok('PS4 มีออร์เดอร์สั่งล่วงหน้าค้าง → ไม่ลบเซสชัน ไม่ปกปิดข้อมูล',
  (select count(*) from public.punpang_preorder_sessions where customer_id = 'pu1') = 2
  and (select data->>'address' from public.punpang_preorder_orders where id = 'pu_o1') = 'บ้านเลขที่ 1');

-- PS5 ออร์เดอร์จบแล้ว: ลบเซสชันทั้งหมดและปกปิดที่อยู่ในออร์เดอร์
update public.punpang_preorder_orders set status = 'cancelled' where id = 'pu_o1';
select test.as_staff('d7000000-0000-4000-8000-0000000000d1', $$select public.punpang_purge_customer('pu1', '{}')$$);
select test.ok('PS5 ลบลูกค้า: เซสชันสั่งล่วงหน้าถูกลบ และที่อยู่ในออร์เดอร์ถูกปกปิด',
  (select count(*) from public.punpang_preorder_sessions where customer_id = 'pu1') = 0
  and (select data->>'address' from public.punpang_preorder_orders where id = 'pu_o1') = '');

rollback;
