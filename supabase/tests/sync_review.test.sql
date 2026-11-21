-- ทดสอบคิวรอตรวจของผู้จัดการ (punpang_sync_review) · ใช้ test.* จาก security.test.sql · รันโดย run.sh ก่อน mirror.test.sql
-- พนักงานขาย (pos/createOrder) เพิ่มรายการเปิดได้เท่านั้น และลงชื่อผู้สร้างเป็นตนเอง · ผู้จัดการ (manage) อ่านได้ทั้งหมด
-- ต้นฉบับแก้ไม่ได้ · รายการที่ปิดหรือส่งซ้ำแล้วแก้ไม่ได้ · ปิดต้องมีเหตุผล · ผู้ปิดและเวลาบันทึกโดยฐานข้อมูล · ไม่มีการลบ
-- ผู้ใช้: Sales 1111… (pos, createOrder) · Driver 2222… (ไม่มีสิทธิ์ขาย) · Admin 5555… (manage)
-- หมายเหตุ: การแก้ผ่าน test.as_staff กับการตรวจผลต้องเป็นคนละคำสั่ง (ภายในคำสั่งเดียว subquery จะไม่เห็นการแก้ของฟังก์ชัน)

begin;

-- ---------- A) การเพิ่มรายการ ----------
select test.ok('SR1 พนักงานขาย (pos) เพิ่มรายการเปิดได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, order_code, channel, reason_code, reason_message, payload)
    values ('sr_o1', 'OR-SR-000001', 'pos', 'P0001', 'ยอดเกินบิล', '{"id":"sr_o1","payments":[{"id":"p1","amount":900}]}') $q$) = 'OK');
select test.ok('SR2 เพิ่มด้วยสถานะอื่นที่ไม่ใช่เปิดไม่ได้',
  left(test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, status, payload) values ('sr_x', 'closed', '{}') $q$), 10) in ('ERR:42501:', 'ERR:23514:'));
select test.ok('SR3 ผู้ที่ไม่มีสิทธิ์ขาย (คนขับ) เพิ่มไม่ได้',
  left(test.as_staff('22222222-2222-2222-2222-222222222222', $q$
    insert into public.punpang_sync_review (order_id, payload) values ('sr_x', '{}') $q$), 10) = 'ERR:42501:');
select test.ok('SR4 ผู้ไม่ได้ล็อกอิน (anon) เพิ่มไม่ได้',
  left(test.as_anon($q$ insert into public.punpang_sync_review (order_id, payload) values ('sr_x', '{}') $q$), 10) = 'ERR:42501:');
select test.ok('SR5 เพิ่มโดยระบุชื่อผู้สร้างเป็นคนอื่นไม่ได้',
  left(test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, created_by, payload) values ('sr_x', '55555555-5555-5555-5555-555555555555', '{}') $q$), 10) = 'ERR:42501:');

-- ---------- B) การอ่านและการแก้ ----------
select test.ok('SR6 พนักงานขายอ่านคิวไม่ได้ (เห็น 0 แถว)',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(count(*)) from public.punpang_sync_review $q$) = '0'::jsonb);
select test.ok('SR7 ผู้จัดการอ่านคิวได้ทั้งหมด',
  test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select to_jsonb(count(*)) from public.punpang_sync_review $q$) = '1'::jsonb);
select test.ok('SR8 พนักงานขายแก้รายการไม่ได้ (ไม่มีแถวให้แก้ ไม่ error)',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    update public.punpang_sync_review set status = 'closed', resolution_note = 'ลอง' where order_id = 'sr_o1' $q$) = 'OK');
select test.ok('SR8b สถานะรายการไม่เปลี่ยนจากการแก้ของพนักงานขาย',
  (select status from public.punpang_sync_review where order_id = 'sr_o1') = 'open');
select test.ok('SR9 ผู้จัดการแก้ต้นฉบับ (payload) ไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set payload = '{"hack":1}' where order_id = 'sr_o1' $q$), 10) = 'ERR:42501:');
select test.ok('SR10 ผู้จัดการแก้ผู้สร้างรายการไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set created_by = 'ปลอม' where order_id = 'sr_o1' $q$), 10) = 'ERR:42501:');
select test.ok('SR11 ลบรายการไม่ได้ (ไม่ได้ให้สิทธิ์ลบ)',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    delete from public.punpang_sync_review where order_id = 'sr_o1' $q$), 10) = 'ERR:42501:');
select test.ok('SR12 ผู้จัดการบันทึกแก้ไขแล้วส่งขณะยังเปิดอยู่ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set edited_payload = '{"id":"sr_o1","payments":[{"id":"p1","amount":800}]}' where order_id = 'sr_o1' $q$) = 'OK');
select test.ok('SR12b ค่าแก้ไขแล้วส่งถูกบันทึก',
  (select edited_payload->'payments'->0->>'amount' from public.punpang_sync_review where order_id = 'sr_o1') = '800');

-- ---------- C) การปิด ----------
select test.ok('SR13 ปิดโดยไม่มีเหตุผลไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set status = 'closed' where order_id = 'sr_o1' $q$), 10) = 'ERR:23514:');
select test.ok('SR14 ปิดพร้อมเหตุผลได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set status = 'closed', resolution_note = 'ซ้ำกับบิลอื่น',
      resolved_by = 'ปลอม', resolved_at = '2000-01-01' where order_id = 'sr_o1' $q$) = 'OK');
select test.ok('SR14b ผู้ปิดเป็นของฐานข้อมูล (ค่าที่ส่งมาถูกแทนที่)',
  (select resolved_by from public.punpang_sync_review where order_id = 'sr_o1' and status = 'closed') = '55555555-5555-5555-5555-555555555555');
select test.ok('SR14c เวลาปิดเป็นของฐานข้อมูล (ไม่ใช่ค่าที่ส่งมา)',
  (select resolved_at > '2001-01-01'::timestamptz from public.punpang_sync_review where order_id = 'sr_o1' and status = 'closed'));
select test.ok('SR15 รายการที่ปิดแล้วเปิดใหม่ไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set status = 'open' where order_id = 'sr_o1' and status = 'closed' $q$), 10) = 'ERR:42501:');
select test.ok('SR16 รายการที่ปิดแล้วแก้เหตุผลไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set resolution_note = 'แก้' where order_id = 'sr_o1' and status = 'closed' $q$), 10) = 'ERR:42501:');

-- ---------- D) ออร์เดอร์เดียวมีรายการเปิดได้ทีละรายการ ----------
select test.ok('SR17 หลังปิดแล้ว เพิ่มรายการเปิดใหม่ของออร์เดอร์เดิมได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, order_code, channel, reason_code, reason_message, payload)
    values ('sr_o1', 'OR-SR-000001', 'pos', 'P0001', 'ยอดเกินบิล', '{"id":"sr_o1"}') $q$) = 'OK');
select test.ok('SR17b ผู้สร้างรายการเปิดคือพนักงานที่เพิ่ม',
  (select created_by from public.punpang_sync_review where order_id = 'sr_o1' and status = 'open') = '11111111-1111-1111-1111-111111111111');
select test.ok('SR18 มีรายการเปิดซ้ำของออร์เดอร์เดียวกันไม่ได้',
  left(test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, payload) values ('sr_o1', '{}') $q$), 10) = 'ERR:23505:');

-- ---------- E) ส่งซ้ำ และค่าช่องรอตรวจ ----------
select test.ok('SR19 ผู้จัดการส่งซ้ำได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set status = 'resent' where order_id = 'sr_o1' and status = 'open' $q$) = 'OK');
select test.ok('SR19b ผู้ส่งซ้ำถูกบันทึกเป็นผู้จัดการ',
  (select resolved_by from public.punpang_sync_review where order_id = 'sr_o1' and status = 'resent') = '55555555-5555-5555-5555-555555555555');
select test.ok('SR20 รายการที่ส่งซ้ำแล้วแก้ไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set status = 'closed', resolution_note = 'ปิด' where order_id = 'sr_o1' and status = 'resent' $q$), 10) = 'ERR:42501:');
select test.ok('SR21 เพิ่มรายการเปิดสำหรับทดสอบการล้างค่า',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (order_id, payload) values ('sr_o2', '{"id":"sr_o2"}') $q$) = 'OK');
select test.ok('SR21b ผู้จัดการแก้ค่าการปิดมาในรายการเปิด',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    update public.punpang_sync_review set resolved_by = 'ปลอม', resolution_note = 'ค้าง' where order_id = 'sr_o2' $q$) = 'OK');
select test.ok('SR21c ระบบล้างค่าการปิดของรายการที่ยังเปิดอยู่',
  (select resolved_by is null and resolved_at is null and resolution_note = '' from public.punpang_sync_review where order_id = 'sr_o2'));

-- ---------- F) ปุ่มล้างข้อมูลทดสอบล้างคิวในสำเนา (นิยามที่แอปเรียกในโหมดทดสอบ) และไม่แตะคิวจริง ----------
insert into punpang_test.punpang_sync_review (order_id, payload) values ('sr_t1', '{"id":"sr_t1"}');
select test.ok('SR22 มีรายการทดสอบอยู่ในสำเนาก่อนล้าง',
  (select count(*) = 1 from punpang_test.punpang_sync_review where order_id = 'sr_t1'));
select test.ok('SR23 ผู้จัดการล้างข้อมูลทดสอบ (สำเนา) ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$ select punpang_test.punpang_reset_test_data() $q$) = 'OK');
select test.ok('SR24 หลังล้าง คิวในสำเนาว่าง',
  (select count(*) = 0 from punpang_test.punpang_sync_review));
select test.ok('SR25 การล้างสำเนาไม่แตะคิวจริง',
  exists (select 1 from public.punpang_sync_review where order_id = 'sr_o2'));

rollback;
select 'ผ่านทั้งหมด' as sync_review_tests;
