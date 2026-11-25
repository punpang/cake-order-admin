-- ทดสอบตาราง preorder เฟส 1 (migration 20261127100000): สิทธิ์ RLS ค่าตั้งต้นของตาราง และข้อจำกัด
-- รันโดย supabase/tests/run.sh (ใช้ test.ok, test.as_staff, test.as_anon จาก security.test.sql) · ทำในธุรกรรมที่ย้อนกลับ

begin;

insert into auth.users (id, email) values
  ('d7000000-0000-4000-8000-000000000001', 'pc_mgrp@example.test'),
  ('d7000000-0000-4000-8000-000000000002', 'pc_manage@example.test'),
  ('d7000000-0000-4000-8000-000000000003', 'pc_sales@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d7000000-0000-4000-8000-000000000001', 'ผู้จัดการสั่งล่วงหน้า', 'admin', '{managePreorder}'),
  ('d7000000-0000-4000-8000-000000000002', 'ผู้จัดการทั่วไป', 'admin', '{manage}'),
  ('d7000000-0000-4000-8000-000000000003', 'พนักงานขาย', 'sales', '{createOrder,pos}');

-- แคมเปญตัวอย่างโดยระบบ (ไม่ผ่านสิทธิ์พนักงาน) · ร่าง เพราะเปิดรับต้องมีสินค้า (ดู preorder_guard.test.sql)
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
values ('pcseed', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 120);

-- PC1 ผู้ที่มี managePreorder สร้างแคมเปญได้
select test.ok('PC1 managePreorder สร้างแคมเปญได้',
  test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_a', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 120)$$) = 'OK');

-- PC2 ผู้ที่มีเฉพาะ manage (ผู้จัดการทั่วไป) ก็ทำได้ (นโยบายรวม manage)
select test.ok('PC2 manage อย่างเดียวสร้างแคมเปญได้',
  test.as_staff('d7000000-0000-4000-8000-000000000002', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_b', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 120)$$) = 'OK');

-- PC3 พนักงานขายที่ไม่มีสิทธิ์สร้างไม่ได้
select test.ok('PC3 พนักงานขายสร้างแคมเปญไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000003', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_c', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 120)$$), 10) = 'ERR:42501:');

-- PC4 ผู้ใช้ anon เขียนไม่ได้
select test.ok('PC4 anon เขียนแคมเปญไม่ได้',
  test.as_anon($$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_d', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 120)$$) <> 'OK');

-- PC5 ข้อจำกัดของค่า: เวลาจ่ายว่าง/ศูนย์ มัดจำนอกช่วง ช่วงวันผิดลำดับ
select test.ok('PC5a เวลาจ่ายว่าง → not null (23502)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent)
    values ('pc_e', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50)$$), 10) = 'ERR:23502:');
select test.ok('PC5b เวลาจ่ายศูนย์ → check (23514)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_f', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 50, 0)$$), 10) = 'ERR:23514:');
select test.ok('PC5c มัดจำ 101% → check (23514)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_g', 'draft', '2026-12-01', '2026-12-15', '2026-12-24', '2026-12-26', 101, 120)$$), 10) = 'ERR:23514:');
select test.ok('PC5d ช่วงรับสั่งผิดลำดับ → check (23514)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min)
    values ('pc_h', 'draft', '2026-12-20', '2026-12-10', '2026-12-24', '2026-12-26', 50, 120)$$), 10) = 'ERR:23514:');

-- PC6 ลบแคมเปญ/เขียนช่องโควตา/สร้างออร์เดอร์ตรงๆ จากผู้ใช้ทั่วไปไม่ได้ (ไม่มีสิทธิ์ตาราง)
select test.ok('PC6a ลบแคมเปญไม่ได้ (ไม่มี grant delete)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    delete from public.punpang_preorder_campaigns where id = 'pcseed'$$), 10) = 'ERR:42501:');
select test.ok('PC6b เขียนช่องโควตาโดยตรงไม่ได้ (จองต้องผ่าน RPC)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_slots (campaign_id, pickup_date, item_id, reserved)
    values ('pcseed', '2026-12-24', '', 1)$$), 10) = 'ERR:42501:');
select test.ok('PC6c สร้างออร์เดอร์ preorder โดยตรงจากพนักงานไม่ได้',
  left(test.as_staff('d7000000-0000-4000-8000-000000000001', $$
    insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date)
    values ('po_x', 'pcseed', 'PRE-241124-000001', 'awaiting_payment', '2026-12-24')$$), 10) = 'ERR:42501:');

rollback;
