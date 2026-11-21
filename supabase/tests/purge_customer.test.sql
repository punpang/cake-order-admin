-- ทดสอบลบข้อมูลลูกค้าตามคำขอ (PDPA) ที่ฐานข้อมูล: punpang_purge_customer
-- รันโดย supabase/tests/run.sh หลัง migration ทั้งหมด (ใช้ test.ok / test.rpc_as จาก security.test.sql) · ข้อมูลทดสอบขึ้นต้น pc_ · ธุรกรรมย้อนกลับ
begin;

-- ใช้พนักงานจาก security.test.sql: 5555… = Admin (manage) · 1111… = Sales (ไม่มี manage)

insert into public.punpang_customers (id, name, phone, note, data) values
  ('pc_c1', 'ลูกค้าทดสอบ', '0855500001', 'โน้ตส่วนตัว', '{"ledger":[{"pts":5}],"spins":1,"fbPsid":"PSID-pc","tax":{"name":"บริษัท","taxId":"1234567890123"},"places":[{"name":"บ้าน"}],"promoOptIn":false}'),
  ('pc_c2', 'ลูกค้าค้าง', '0855500002', '', '{"ledger":[]}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, data, balance) values
  ('pc_o1', 'PC-0001', 'pc_c1', 'delivered', 'pickup',
   '{"address":"บ้านเลขที่ 1","detail":"ส่วนตัว","placeName":"บ้าน","mapUrl":"https://maps","birthday":"2000-01-01","chatId":"pc_ch1",
     "items":[{"name":"เค้ก","qty":1,"price":100,"note":"เขียนชื่อ","images":["sb:img1"],"workPhotos":[{"id":"w1","image":"sb:w1"}],
               "selections":{"g_text":"สุขสันต์วันเกิด","g_size":"s1"},"tiers":[{"selections":{"g_text":"ชั้นบน","g_flavor":"f1"}}]}],
     "payments":[{"id":"p1","amount":100,"status":"reported","slip":"sb:slip1","note":"โอนจากบัญชี"}],
     "cancel":{"refundNote":"เลขบัญชี"}}', 0),
  ('pc_o2', 'PC-0002', 'pc_c2', 'awaiting_payment', 'pickup', '{"items":[],"payments":[]}', 100);

insert into public.punpang_chats (id, channel, external_id, customer_id, data) values ('pc_ch1', 'facebook', 'PSID-pc', 'pc_c1', '{"messages":[{"text":"สวัสดี"}]}');
insert into public.punpang_quotes (id, code, chat_id, customer_id, status, data) values ('pc_q1', 'PCQ-1', 'pc_ch1', 'pc_c1', 'sent', '{}');
insert into public.punpang_records (collection, id, data) values
  ('coupons', 'pc_cp1', '{"customerId":"pc_c1"}'),
  ('reviews', 'pc_rv1', '{"customerId":"pc_c1"}'),
  ('outbox', 'pc_ob1', '{"orderId":"pc_o1"}'),
  ('outbox', 'pc_ob2', '{"to":"0855500001"}'),
  ('chatDrafts', 'pc_ch1', '{}'),
  ('orderLinks', 'pc_ol1', '{"orderId":"pc_o1"}'),
  ('birthdayGreeted', 'pc_c1|ลูกค้า|0101|2026', '{}'),
  ('notifySent', 'bd|pc_c1|2026', '{}'),
  ('consents', 'pc_cs1', '{"customerId":"pc_c1","kind":"privacy","version":1}'),
  ('reviews', 'pc_rv2', '{"customerId":"pc_c2"}');
insert into public.punpang_customer_auth (customer_id, pin_hash, pin_salt, phone) values ('pc_c1', 'h', 's', '0855500001');
insert into public.punpang_customer_sessions (token_hash, customer_id, expires_at) values ('pc_tok', 'pc_c1', now() + interval '1 day');

-- สิทธิ์: ไม่ใช่แอดมิน = ไม่ได้
select test.ok('ผู้ไม่มีสิทธิ์ manage ลบข้อมูลลูกค้าไม่ได้',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_purge_customer('pc_c1', '{g_text}') $q$)->>'exception' = '42501');
select test.ok('ผู้ไม่มีสิทธิ์: ข้อมูลยังอยู่ครบ', (select name from public.punpang_customers where id = 'pc_c1') = 'ลูกค้าทดสอบ');

-- ด่าน: ออร์เดอร์ยังไม่จบ
select test.ok('ลูกค้าที่มีออร์เดอร์ยังไม่จบ ลบไม่ได้',
  test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_purge_customer('pc_c2', '{g_text}') $q$)->>'error' = 'open_orders');

-- ลบจริง
select test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_purge_customer('pc_c1', '{g_text}') $q$) as res \gset
select test.ok('ลบสำเร็จ', (:'res'::jsonb)->>'ok' = 'true');

select test.ok('ลูกค้า: ตัดชื่อ/เบอร์/โน้ต', (select name = 'ลูกค้าที่ลบแล้ว' and phone = '' and note = '' from public.punpang_customers where id = 'pc_c1'));
select test.ok('ลูกค้า: ตัดข้อมูลภาษี/สถานที่/PSID และล้างคะแนน', (select not (data ? 'tax') and data->'places' = '[]'::jsonb and data->>'fbPsid' = '' and data->'ledger' = '[]'::jsonb and (data->>'deleted')::boolean from public.punpang_customers where id = 'pc_c1'));

select test.ok('ออร์เดอร์ยังอยู่ (เก็บยอดเงิน)', exists (select 1 from public.punpang_orders where id = 'pc_o1' and (data->'items'->0->>'price')::numeric = 100 and (data->'payments'->0->>'amount')::numeric = 100));
select test.ok('ออร์เดอร์: ตัดที่อยู่/รายละเอียด/วันเกิด', (select data->>'address' = '' and data->>'detail' = '' and data->'birthday' = 'null'::jsonb and data->'chatId' = 'null'::jsonb from public.punpang_orders where id = 'pc_o1'));
select test.ok('ออร์เดอร์: ตัดโน้ต/รูป/รูปงาน ของรายการ', (select data->'items'->0->>'note' = '' and data->'items'->0->'images' = '[]'::jsonb and data->'items'->0->'workPhotos' = '[]'::jsonb from public.punpang_orders where id = 'pc_o1'));
select test.ok('ออร์เดอร์: ตัดข้อความบนเค้ก (กลุ่มข้อความ) เก็บตัวเลือกอื่น', (select not (data->'items'->0->'selections' ? 'g_text') and data->'items'->0->'selections'->>'g_size' = 's1' and not (data->'items'->0->'tiers'->0->'selections' ? 'g_text') and data->'items'->0->'tiers'->0->'selections'->>'g_flavor' = 'f1' from public.punpang_orders where id = 'pc_o1'));
select test.ok('ออร์เดอร์: ตัดสลิป/โน้ตการชำระ และโน้ตคืนเงิน', (select data->'payments'->0->>'slip' = '' and data->'payments'->0->>'note' = '' and data->'cancel'->>'refundNote' = '' from public.punpang_orders where id = 'pc_o1'));

select test.ok('แชทและใบเสนอถูกลบ', not exists (select 1 from public.punpang_chats where id = 'pc_ch1') and not exists (select 1 from public.punpang_quotes where id = 'pc_q1'));
select test.ok('ข้อมูลรายแถวของลูกค้าถูกลบ (คูปอง รีวิว คิวข้อความ ร่างแชท ลิงก์ กันส่งซ้ำ)',
  not exists (select 1 from public.punpang_records where id in ('pc_cp1', 'pc_rv1', 'pc_ob1', 'pc_ob2', 'pc_ch1', 'pc_ol1', 'pc_c1|ลูกค้า|0101|2026', 'bd|pc_c1|2026')));
select test.ok('บันทึกความยินยอมยังเก็บไว้ (หลักฐาน)', exists (select 1 from public.punpang_records where id = 'pc_cs1'));
select test.ok('ข้อมูลของลูกค้าอื่นไม่ถูกแตะ', exists (select 1 from public.punpang_records where id = 'pc_rv2') and (select name from public.punpang_customers where id = 'pc_c2') = 'ลูกค้าค้าง');
select test.ok('บัญชีลูกค้า (PIN/เซสชัน) ถูกลบ', not exists (select 1 from public.punpang_customer_auth where customer_id = 'pc_c1') and not exists (select 1 from public.punpang_customer_sessions where customer_id = 'pc_c1'));

select test.ok('เรียกซ้ำหลังลบแล้ว = สำเร็จ (ไม่ทำซ้ำ)',
  test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_purge_customer('pc_c1', '{}') $q$)->>'already' = 'true');

rollback;
