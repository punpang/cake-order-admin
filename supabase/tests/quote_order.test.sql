-- ทดสอบฟังก์ชันสร้างออร์เดอร์จากใบเสนอแบบอะตอมิก และดัชนีกันใบเสนอซ้ำ (รันก่อน mirror.test.sql · ทั้งไฟล์อยู่ในธุรกรรมที่ย้อนกลับเมื่อจบ)
begin;

create schema qo;

create function qo.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- แทรกออร์เดอร์ตรง (ไม่ผ่านฟังก์ชัน) คืน 'OK' หรือ 'ERR:<sqlstate>'
create function qo.insert_direct(oid text, qid text) returns text language plpgsql as $$
begin
  insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
  values (oid, 'QO-D-' || oid, 'c_qo', 'awaiting_payment', 'pickup', 'web',
          jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'quoteId', qid));
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate;
end $$;

-- แถวออร์เดอร์รูปแบบเดียวกับ orderRowOf ของ order-create
create function qo.row(oid text, qid text, cust text default 'c_qo') returns jsonb language sql as $$
  select jsonb_build_object(
    'id', oid, 'code', 'QO-' || oid, 'customer_id', cust, 'status', 'awaiting_payment', 'fulfillment', 'pickup',
    'channel', 'web', 'pickup_at', '2099-01-01T10:00', 'balance', 100,
    'data', jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'quoteId', qid));
$$;

insert into public.punpang_customers (id, name, phone, data) values
  ('c_qo', 'QO customer', '0899990002', '{"ledger":[],"spins":0}'),
  ('c_qo_other', 'QO other', '0899990003', '{"ledger":[],"spins":0}');

insert into public.punpang_quotes (id, code, chat_id, customer_id, status, order_id, data) values
  ('q_qo1', 'QO-Q1', 'chat-qo', 'c_qo', 'customer_ok', null,
   jsonb_build_object('payload', jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'pickupAt', '2099-01-01T10:00'))),
  ('q_qo2', 'QO-Q2', 'chat-qo', 'c_qo', 'pending', null,
   jsonb_build_object('payload', jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'pickupAt', '2099-01-01T10:00'))),
  ('q_qo3', 'QO-Q3', 'chat-qo', 'c_qo', 'customer_ok', null,
   jsonb_build_object('payload', jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'pickupAt', '2099-01-01T10:00'))),
  ('q_qo4', 'QO-Q4', 'chat-qo', 'c_qo', 'customer_ok', null,
   jsonb_build_object('payload', jsonb_build_object('items', '[{"id":"i1","qty":1,"unitPrice":100}]'::jsonb, 'shippingFee', 0, 'pickupAt', '2099-01-01T10:00')));

-- 1) ครั้งแรกสำเร็จ: ได้แถวกลับมาพร้อม updated_at และผูกใบเสนอ
select qo.ok('ครั้งแรกคืน ok พร้อมแถวออร์เดอร์',
  (select (public.punpang_quote_order_create('q_qo1', qo.row('o_qo1', 'q_qo1'))->>'code') = 'ok'));
select qo.ok('แถวที่คืนมี updated_at (แอปใช้เปรียบเทียบเวอร์ชัน)',
  (select (public.punpang_quote_order_create('q_qo4', qo.row('o_qo4', 'q_qo4'))->'row'->>'updated_at') is not null));
select qo.ok('ใบเสนอ q_qo1 ผูก order_id และเป็น accepted',
  (select order_id = 'o_qo1' and status = 'accepted' from public.punpang_quotes where id = 'q_qo1'));

-- 2) ออร์เดอร์ที่สองจากใบเดิม (รหัสต่างกัน) ต้องถูกปฏิเสธ และไม่มีแถวเพิ่ม
select qo.ok('ออร์เดอร์ที่สองจากใบเดิมได้ converted',
  (select public.punpang_quote_order_create('q_qo1', qo.row('o_qo2', 'q_qo1'))->>'code') = 'converted');
select qo.ok('มีออร์เดอร์ที่อ้างใบเสนอ q_qo1 เพียงใบเดียว',
  (select count(*) from public.punpang_orders where data->>'quoteId' = 'q_qo1') = 1);

-- 3) ส่งซ้ำด้วยรหัสเดิม = exists (ไม่ซ้ำ ไม่ error)
select qo.ok('ส่งรหัสออร์เดอร์เดิมซ้ำได้ exists',
  (select public.punpang_quote_order_create('q_qo1', qo.row('o_qo1', 'q_qo1'))->>'code') = 'exists');

-- 4) กติกาใบเสนอเดิมยังมีผล: ไม่พบ / ยังไม่พร้อม / ลูกค้าไม่ตรง / รายการไม่ตรง
select qo.ok('ใบเสนอไม่พบ → not_found',
  (select public.punpang_quote_order_create('q_nope', qo.row('o_x1', 'q_nope'))->>'code') = 'not_found');
select qo.ok('ใบเสนอยังไม่ยืนยัน → not_ready',
  (select public.punpang_quote_order_create('q_qo2', qo.row('o_x2', 'q_qo2'))->>'code') = 'not_ready');
select qo.ok('ลูกค้าไม่ตรงกับใบเสนอ → customer',
  (select public.punpang_quote_order_create('q_qo3', qo.row('o_x3', 'q_qo3', 'c_qo_other'))->>'code') = 'customer');
select qo.ok('รายการไม่ตรงกับใบเสนอ → items',
  (select public.punpang_quote_order_create('q_qo3', jsonb_set(qo.row('o_x4', 'q_qo3'), '{data,items}', '[{"id":"i1","qty":2,"unitPrice":100}]'::jsonb))->>'code') = 'items');
select qo.ok('การปฏิเสธทุกกรณีไม่ทิ้งแถวออร์เดอร์',
  (select count(*) from public.punpang_orders where id in ('o_x1', 'o_x2', 'o_x3', 'o_x4')) = 0);
select qo.ok('ใบเสนอ q_qo3 ยังไม่ถูกผูก (ทุกคำขอที่ปฏิเสธไม่เปลี่ยนใบเสนอ)',
  (select order_id is null from public.punpang_quotes where id = 'q_qo3'));

-- 5) ดัชนีกันซ้ำระดับฐานข้อมูล: แทรกตรงซ้ำ (แม้ออร์เดอร์เดิมถูกยกเลิกแล้ว) ต้องถูกปฏิเสธ 23505
select qo.ok('แทรกออร์เดอร์ตรงที่ quoteId ซ้ำ → 23505',
  qo.insert_direct('o_dup1', 'q_qo1') = 'ERR:23505');
update public.punpang_orders set status = 'cancelled' where id = 'o_qo1';
select qo.ok('ออร์เดอร์เดิมถูกยกเลิกแล้ว แทรกตรงซ้ำยังถูกปฏิเสธ 23505',
  qo.insert_direct('o_dup2', 'q_qo1') = 'ERR:23505');
select qo.ok('ใบเสนอที่ไม่มีออร์เดอร์อ้างยังแทรกได้ (ดัชนีไม่บังคับเกินจำเป็น)',
  qo.insert_direct('o_free1', 'q_free_nobody') = 'OK');

-- 6) สิทธิ์เรียก: authenticated ต้องเรียกฟังก์ชันนี้ไม่ได้ (เรียกได้เฉพาะ service_role)
select qo.ok('authenticated ไม่มีสิทธิ์เรียก punpang_quote_order_create',
  not has_function_privilege('authenticated', 'public.punpang_quote_order_create(text, jsonb)', 'EXECUTE'));

rollback;
