-- ทดสอบการส่งซ้ำจากคิวรอตรวจ (punpang_review_resend) · ใช้ test.* จาก security.test.sql · รันโดย run.sh ก่อน mirror.test.sql
-- ผู้ใช้: Sales 1111… (pos, createOrder) · Driver 2222… (ไม่มีสิทธิ์ผู้จัดการ) · Admin 5555… (manage แต่ไม่มี pos)
-- ลูกค้า c1 มีจากชุดข้อมูลของ security.test.sql

begin;

-- ---------- ตัวตั้งต้น: รายการในคิวที่พนักงานขายเพิ่ม ----------
select test.ok('RR0 พนักงานขายเพิ่มรายการในคิวสำหรับทดสอบ',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000001', 'rr_o1', 'OR-RR-1', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_o1","code":"OR-RR-1","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","pickupAt":"2026-11-23T10:00:00","items":[{"id":"i1","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[{"id":"rp1","status":"confirmed","amount":100,"posMethod":"cash"}],"history":[]}') $q$) = 'OK');

-- ---------- A) สิทธิ์ ----------
select test.ok('RR1 ผู้ที่ไม่มีสิทธิ์ผู้จัดการ (คนขับ) ส่งซ้ำไม่ได้',
  left(test.as_staff('22222222-2222-2222-2222-222222222222', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000001') $q$), 10) = 'ERR:42501:');
select test.ok('RR2 พนักงานขาย (มี pos) ก็ส่งซ้ำไม่ได้ ต้องเป็นผู้จัดการ',
  left(test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000001') $q$), 10) = 'ERR:42501:');
select test.ok('RR3 ผู้ไม่ได้ล็อกอิน (anon) เรียกไม่ได้',
  left(test.as_anon($q$ select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000001') $q$), 10) = 'ERR:42501:');

-- ---------- B) ผู้จัดการที่ไม่มี pos ส่งซ้ำได้ และผลถูกต้อง ----------
select test.ok('RR4 ผู้จัดการ (ไม่มี pos) ส่งซ้ำบิลหน้าร้านได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000001') $q$) = 'OK');
select test.ok('RR5 ออร์เดอร์ถูกเพิ่มเป็นบิลหน้าร้านของลูกค้าเดิม พร้อมสถานะเดิม',
  (select channel = 'pos' and customer_id = 'c1' and status = 'pos_pending' and code = 'OR-RR-1' from public.punpang_orders where id = 'rr_o1'));
select test.ok('RR6 ข้อมูลออร์เดอร์เก็บการชำระไว้ และไม่มีคีย์ระบุตัวตนซ้ำใน data',
  (select data ? 'payments' and data->'payments'->0->>'amount' = '100' and not (data ? 'id') and not (data ? 'code') and not (data ? 'customerId') and not (data ? 'channel')
     from public.punpang_orders where id = 'rr_o1'));
select test.ok('RR7 วันนัดถูกเก็บในคอลัมน์ pickup_at',
  (select pickup_at is not null from public.punpang_orders where id = 'rr_o1'));
select test.ok('RR8 รายการในคิวปิดเป็นส่งซ้ำแล้ว โดยผู้จัดการเป็นผู้ทำ',
  (select status || ':' || resolved_by from public.punpang_sync_review where id = 'eeeeeeee-0000-4000-8000-000000000001') = 'resent:55555555-5555-5555-5555-555555555555');
select test.ok('RR9 ส่งซ้ำรายการที่ปิดแล้วไม่ได้ (ไม่พบรายการที่เปิด)',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000001') $q$), 10) = 'ERR:P0002:');

-- ---------- C) ออร์เดอร์มีอยู่แล้ว: ไม่ถือว่าส่งสำเร็จ และคิวยังเปิด ----------
select test.ok('RR10 พนักงานขายเพิ่มรายการที่ออร์เดอร์ชนกับของเดิม',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000002', 'rr_o2', 'OR-RR-2', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_o2","code":"OR-RR-2","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"i2","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[],"history":[]}') $q$) = 'OK');
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
  values ('rr_o2', 'OR-RR-2X', 'c1', 'pos_pending', 'pickup', 'pos', '{"items":[{"unitPrice":100,"qty":1}],"payments":[]}');
select test.ok('RR11 ออร์เดอร์มีอยู่แล้ว → ปฏิเสธ (23505) และรายการในคิวยังเปิด',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000002') $q$), 10) = 'ERR:23505:'
  and (select status from public.punpang_sync_review where id = 'eeeeeeee-0000-4000-8000-000000000002') = 'open');

-- ---------- D) ด่านฟังก์ชันเอง: แต้ม/คูปอง/ส่วนลด/ช่องทาง/รหัสไม่ตรง ----------
select test.ok('RR12 เพิ่มรายการที่มีแต้มในคิว',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000003', 'rr_o3', 'OR-RR-3', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_o3","code":"OR-RR-3","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","pointsUsed":{"amount":10},"items":[{"id":"i3","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[],"history":[]}') $q$) = 'OK');
select test.ok('RR13 รายการที่มีแต้มส่งซ้ำจากคิวไม่ได้ และไม่สร้างออร์เดอร์',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000003') $q$), 10) = 'ERR:22023:'
  and not exists (select 1 from public.punpang_orders where id = 'rr_o3'));
select test.ok('RR14 ส่วนลดปรับเองต้องมีสิทธิ์ปรับราคา (ผู้จัดการทั่วไปส่งซ้ำไม่ได้ → 42501)',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000004', 'rr_o4', 'OR-RR-4', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_o4","code":"OR-RR-4","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","adjustment":{"amount":-20},"items":[{"id":"i4","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[],"history":[]}') $q$) = 'OK'
  and left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000004') $q$), 10) = 'ERR:42501:');
select test.ok('RR15 ช่องทางอื่นส่งซ้ำจากคิวไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000005', 'rr_o5', 'OR-RR-5', 'web', 'P0001', 'ทดสอบ',
     '{"id":"rr_o5","code":"OR-RR-5","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"web","items":[{"id":"i5","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[],"history":[]}') $q$) = 'OK'
  and left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000005') $q$), 10) = 'ERR:22023:');
select test.ok('RR16 รหัสในต้นฉบับไม่ตรงกับรหัสในคิว → ปฏิเสธ',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000006', 'rr_o6', 'OR-RR-6', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_zz","code":"OR-RR-6","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[],"payments":[],"history":[]}') $q$) = 'OK'
  and left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000006') $q$), 10) = 'ERR:22023:');

-- ---------- E) ด่านของตารางออร์เดอร์ปฏิเสธ → ทั้งธุรกรรมย้อนกลับ คิวยังเปิด ----------
select test.ok('RR17 ยอดชำระเกินยอดบิล: ด่านปฏิเสธ ไม่มีออร์เดอร์ และคิวยังเปิด',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('eeeeeeee-0000-4000-8000-000000000007', 'rr_o7', 'OR-RR-7', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rr_o7","code":"OR-RR-7","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"i7","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[{"id":"rp7","status":"confirmed","amount":200,"posMethod":"cash"}],"history":[]}') $q$) = 'OK'
  and left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('eeeeeeee-0000-4000-8000-000000000007') $q$), 10) = 'ERR:P0001:');
select test.ok('RR18 หลังด่านปฏิเสธ ไม่มีออร์เดอร์ rr_o7 และรายการในคิวยังเปิด',
  not exists (select 1 from public.punpang_orders where id = 'rr_o7')
  and (select status from public.punpang_sync_review where id = 'eeeeeeee-0000-4000-8000-000000000007') = 'open');

-- ---------- F) คูปองที่จองไว้กับออร์เดอร์ ส่วนลดปรับเอง การยืนยัน และการคืนคูปองตอนปิด ----------
-- คูปองถูกจองบนเซิร์ฟเวอร์ตอนกดใช้ (status used + orderId) · คูปองคืนเงินจองเป็น holds ตามรหัสออร์เดอร์
insert into public.punpang_records (collection, id, data) values
  ('coupons', 'rc_cp1', '{"type":"discount","mode":"fixed","name":"ลด 30","amount":30,"minSpend":0,"status":"used","orderId":"rc_o1","customerId":"c1"}'),
  ('coupons', 'rc_cp2', '{"type":"discount","mode":"fixed","name":"ลด 30 อื่น","amount":30,"minSpend":0,"status":"used","orderId":"rc_other","customerId":"c1"}'),
  ('coupons', 'rc_cp3', '{"type":"discount","mode":"fixed","name":"ลด 30 ปิด","amount":30,"minSpend":0,"status":"used","orderId":"rc_o6","customerId":"c1"}'),
  ('coupons', 'rc_cr1', '{"type":"discount","mode":"credit","name":"คืนเงิน","balance":60,"holds":{"rc_o3":40},"status":"pending","customerId":"c1"}');

select test.ok('RC1 เพิ่มรายการในคิว: คูปองที่จองไว้กับออร์เดอร์นี้ คูปองของออร์เดอร์อื่น คูปองคืนเงิน ส่วนลดปรับเอง และรายการปกติ',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    insert into public.punpang_sync_review (id, order_id, order_code, channel, reason_code, reason_message, payload) values
    ('ffffffff-0000-4000-8000-000000000001', 'rc_o1', 'OR-RC-1', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o1","code":"OR-RC-1","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic1","name":"คัพเค้ก","qty":1,"unitPrice":100}],"couponsUsed":[{"couponId":"rc_cp1","name":"ลด 30","amount":30}],"payments":[{"id":"rcp1","status":"confirmed","amount":70,"posMethod":"cash"}],"history":[]}'),
    ('ffffffff-0000-4000-8000-000000000003', 'rc_o3', 'OR-RC-3', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o3","code":"OR-RC-3","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic3","name":"คัพเค้ก","qty":1,"unitPrice":100}],"couponsUsed":[{"couponId":"rc_cr1","name":"คืนเงิน","amount":40,"credit":true}],"payments":[{"id":"rcp3","status":"confirmed","amount":60,"posMethod":"cash"}],"history":[]}'),
    ('ffffffff-0000-4000-8000-000000000004', 'rc_o4', 'OR-RC-4', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o4","code":"OR-RC-4","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic4","name":"คัพเค้ก","qty":1,"unitPrice":100}],"couponsUsed":[{"couponId":"rc_cp2","name":"ลด 30 อื่น","amount":30}],"payments":[{"id":"rcp4","status":"confirmed","amount":70,"posMethod":"cash"}],"history":[]}'),
    ('ffffffff-0000-4000-8000-000000000005', 'rc_o5', 'OR-RC-5', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o5","code":"OR-RC-5","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic5","name":"คัพเค้ก","qty":1,"unitPrice":100}],"adjustment":{"amount":-10,"reason":"ทดสอบ"},"payments":[{"id":"rcp5","status":"confirmed","amount":90,"posMethod":"cash"}],"history":[]}'),
    ('ffffffff-0000-4000-8000-000000000006', 'rc_o6', 'OR-RC-6', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o6","code":"OR-RC-6","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic6","name":"คัพเค้ก","qty":1,"unitPrice":100}],"couponsUsed":[{"couponId":"rc_cp3","name":"ลด 30 ปิด","amount":30}],"payments":[{"id":"rcp6","status":"confirmed","amount":70,"posMethod":"cash"}],"history":[]}'),
    ('ffffffff-0000-4000-8000-000000000007', 'rc_o7', 'OR-RC-7', 'pos', 'P0001', 'ทดสอบ',
     '{"id":"rc_o7","code":"OR-RC-7","customerId":"c1","status":"pos_pending","fulfillment":"pickup","channel":"pos","items":[{"id":"ic7","name":"คัพเค้ก","qty":1,"unitPrice":100}],"payments":[{"id":"rcp7","status":"confirmed","amount":100,"posMethod":"cash"}],"history":[]}') $q$) = 'OK');

select test.ok('RC2 มีคูปองแต่ยังไม่ยืนยันว่าตรวจแล้ว → ส่งซ้ำไม่ได้',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('ffffffff-0000-4000-8000-000000000001') $q$), 10) = 'ERR:22023:');
select test.ok('RC3 ยืนยันแล้ว: คูปองที่จองไว้กับออร์เดอร์นี้ผ่านการตรวจ ส่งซ้ำได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('ffffffff-0000-4000-8000-000000000001', true) $q$) = 'OK');
select test.ok('RC4 ออร์เดอร์ถูกสร้าง และคูปองยังผูกกับออร์เดอร์นี้ (ไม่ถูกจองซ้ำหรือคืน)',
  exists (select 1 from public.punpang_orders where id = 'rc_o1')
  and (select (data->>'status') || ':' || (data->>'orderId') from public.punpang_records where collection = 'coupons' and id = 'rc_cp1') = 'used:rc_o1');
select test.ok('RC5 คูปองที่จองไว้กับออร์เดอร์อื่น ส่งซ้ำไม่ได้ แม้ยืนยันแล้ว และไม่สร้างออร์เดอร์',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('ffffffff-0000-4000-8000-000000000004', true) $q$), 10) = 'ERR:22023:'
  and not exists (select 1 from public.punpang_orders where id = 'rc_o4'));
select test.ok('RC6 ส่วนลดปรับเองต้องมีสิทธิ์ปรับราคา (ผู้จัดการทั่วไปส่งซ้ำไม่ได้)',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_resend('ffffffff-0000-4000-8000-000000000005', true) $q$), 10) = 'ERR:42501:');
insert into auth.users (id, email) values ('cccccccc-0000-4000-8000-000000000009', 'adj@t') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms, active) values
  ('cccccccc-0000-4000-8000-000000000009', 'ปรับราคา', 'admin', array['manage', 'adjustPrice'], true) on conflict do nothing;
select test.ok('RC7 ผู้จัดการที่มีสิทธิ์ปรับราคาส่งซ้ำรายการที่มีส่วนลดปรับเองได้เมื่อยืนยันแล้ว',
  test.as_staff('cccccccc-0000-4000-8000-000000000009', $q$
    select public.punpang_review_resend('ffffffff-0000-4000-8000-000000000005', true) $q$) = 'OK');
select test.ok('RC8 ปิดโดยไม่มีเหตุผลไม่ได้ (รายการยังเปิด)',
  left(test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_close('ffffffff-0000-4000-8000-000000000007', '   ') $q$), 10) = 'ERR:22023:'
  and (select status from public.punpang_sync_review where id = 'ffffffff-0000-4000-8000-000000000007') = 'open');
select test.ok('RC9 พนักงานขายปิดรายการจากคิวไม่ได้ ต้องเป็นผู้จัดการ',
  left(test.as_staff('11111111-1111-1111-1111-111111111111', $q$
    select public.punpang_review_close('ffffffff-0000-4000-8000-000000000007', 'เหตุผล') $q$), 10) = 'ERR:42501:');
select test.ok('RC10 ปิดพร้อมเหตุผล คืนคูปองที่จองไว้กับออร์เดอร์นั้นให้ใช้ได้อีก',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_close('ffffffff-0000-4000-8000-000000000006', 'ลูกค้ายกเลิก') $q$) = 'OK');
select test.ok('RC11 คูปองที่ถูกคืนกลับเป็นพร้อมใช้ และคูปองของออร์เดอร์อื่นไม่ถูกแตะ',
  (select data->>'status' || ':' || coalesce(data->>'orderId', 'null') from public.punpang_records where collection = 'coupons' and id = 'rc_cp3') = 'pending:null'
  and (select data->>'orderId' from public.punpang_records where collection = 'coupons' and id = 'rc_cp1') = 'rc_o1');
select test.ok('RC12 ปิดรายการคูปองคืนเงิน: ยอดคืนเข้าคูปอง และยกเลิกการจองของออร์เดอร์นั้น',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$
    select public.punpang_review_close('ffffffff-0000-4000-8000-000000000003', 'ยกเลิกการขาย') $q$) = 'OK');
select test.ok('RC13 คูปองคืนเงินกลับมามียอดเต็มและไม่มีการจองค้างของออร์เดอร์นั้น',
  (select (data->>'balance')::numeric = 100 and not (data->'holds' ? 'rc_o3') and data->>'status' = 'pending' from public.punpang_records where collection = 'coupons' and id = 'rc_cr1'));
select test.ok('RC14 ปิดแล้วบันทึกเหตุผลและผู้ปิดเป็นผู้จัดการ',
  (select status || ':' || resolution_note || ':' || resolved_by from public.punpang_sync_review where id = 'ffffffff-0000-4000-8000-000000000006')
    = 'closed:ลูกค้ายกเลิก:55555555-5555-5555-5555-555555555555');

rollback;
select 'ผ่านทั้งหมด' as review_resend_tests;
