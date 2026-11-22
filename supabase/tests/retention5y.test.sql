-- ทดสอบระยะเก็บ 5 ปี (migration 20261122120000) · รันโดย run.sh หลัง member_staff.test.sql
-- ใช้ test.ok / test.rpc_as จาก security.test.sql · ข้อมูลทดสอบใช้รหัสขึ้นต้น ret_ · ข้อความที่ต้องหายไปมี ZZPII-RET
-- ทำในธุรกรรมที่ย้อนกลับ · วันตัด = วันนี้ (เวลาไทย) − 5 ปี ตามที่ punpang__ret_cfg คำนวณ

begin;

-- ---------- ตัวช่วย (pg_temp หายเมื่อจบธุรกรรม) ----------
create function pg_temp.ret_cut() returns date language sql stable as $$
  select ((now() at time zone 'Asia/Bangkok')::date - make_interval(years => 5))::date
$$;
create function pg_temp.ret_at(d date, t time default '12:00') returns timestamptz language sql immutable as $$
  select (d + t) at time zone 'Asia/Bangkok'
$$;
create function pg_temp.ret_ev(p_c text, p_o text, p_day date, p_amt numeric) returns void language sql as $$
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_c, p_o, 'spend', pg_temp.ret_at(p_day), p_day, p_amt, 140, 1)
$$;
create function pg_temp.ret_undo(p_c text, p_o text, p_day date, p_amt numeric) returns void language sql as $$
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_c, p_o, 'undo', pg_temp.ret_at(p_day), p_day, p_amt, null, null)
$$;
create function pg_temp.ret_cfg(v jsonb) returns void language sql as $$
  insert into public.punpang_kv (collection, id, data) values ('config', 'retention5y', jsonb_build_object('v', v))
  on conflict (collection, id) do update set data = excluded.data
$$;

-- ---------- เตรียมข้อมูล ----------
-- กลุ่มตัวเลือก: g_text = ข้อความ (ตัดออกเมื่อนิรนาม) · g_flavor = ตัวเลือกทั่วไป (คงไว้)
insert into public.punpang_kv (collection, id, data) values
  ('config', 'optionGroups', '{"v":[{"id":"g_text","type":"text"},{"id":"g_flavor","type":"choice"}]}')
on conflict (collection, id) do update set data = excluded.data;

insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'ret-admin@example.test'),
  ('dddddddd-0000-4000-8000-000000000002', 'ret-sales@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms, active) values
  ('dddddddd-0000-4000-8000-000000000001', 'ผู้ดูแลทดสอบระยะเก็บ', 'admin', array['manage'], true),
  ('dddddddd-0000-4000-8000-000000000002', 'พนักงานขายทดสอบระยะเก็บ', 'sales', array['viewAllOrders'], true)
on conflict do nothing;

insert into public.punpang_customers (id, name, data) values
  ('ret_c1', 'ลูกค้าทดสอบ ปิดแล้ว', '{"ledger":[],"spins":0}'),
  ('ret_c2', 'ลูกค้าทดสอบ ยังค้าง', '{"ledger":[],"spins":0}'),
  ('ret_c3', 'ลูกค้าทดสอบ ถอนยอดหลังวันตัด', '{"ledger":[],"spins":0}'),
  ('ret_c4', 'ลูกค้าทดสอบ หลังวันตัด', '{"ledger":[],"spins":0}'),
  ('ret_b1', 'ลูกค้าทดสอบ ชุดแรก', '{"ledger":[],"spins":0}'),
  ('ret_b2', 'ลูกค้าทดสอบ ชุดสอง', '{"ledger":[],"spins":0}'),
  ('ret_left', 'ลูกค้าทดสอบ มีการอ้างอิงเหลือ', '{"ledger":[],"spins":0}'),
  ('ret_eq1', 'ลูกค้าทดสอบ เทียบหลายรอบ', '{"ledger":[],"spins":0}'),
  ('ret_eq2', 'ลูกค้าทดสอบ เทียบวันครบพอดี', '{"ledger":[],"spins":0}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data, created_at) values
-- ออร์เดอร์เก่าสุด (ใช้ทดสอบการทำทีละชุด)
('ret_b1', 'OR-RET-B1', 'ret_b1', 'delivered', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_b1',
   'items', jsonb_build_array(jsonb_build_object('id', 'bx1', 'name', 'เค้กชุดแรก', 'qty', 1, 'unitPrice', 300)),
   'payments', jsonb_build_array(jsonb_build_object('id', 'pbx1', 'amount', 300, 'status', 'confirmed', 'method', 'เงินสด'))),
 pg_temp.ret_at(pg_temp.ret_cut() - 900)),
('ret_b2', 'OR-RET-B2', 'ret_b2', 'delivered', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_b2',
   'items', jsonb_build_array(jsonb_build_object('id', 'bx2', 'name', 'เค้กชุดสอง', 'qty', 1, 'unitPrice', 300)),
   'payments', jsonb_build_array(jsonb_build_object('id', 'pbx2', 'amount', 300, 'status', 'confirmed', 'method', 'เงินสด'))),
 pg_temp.ret_at(pg_temp.ret_cut() - 800)),
-- ปิดแล้วก่อนวันตัด: มีข้อความส่วนตัวทุกช่อง + การอ้างอิงไฟล์หลายแบบ
('ret_o1', 'OR-RET-1', 'ret_c1', 'delivered', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_c1',
   'address', 'ZZPII-RET 99 ถนนทดสอบ', 'placeName', 'ZZPII-RET สถานที่', 'detail', 'ZZPII-RET รายละเอียด',
   'mapUrl', 'https://maps.example.test/ZZPII-RET', 'chatId', 'ret_chat_1',
   'birthday', jsonb_build_object('name', 'ZZPII-RET ชื่อ', 'md', '05-12'),
   'occasion', jsonb_build_object('kind', 'ZZPII-RET โอกาส', 'consent', true),
   'items', jsonb_build_array(jsonb_build_object(
      'id', 'it1', 'name', 'เค้กทดสอบ', 'qty', 1, 'unitPrice', 500, 'note', 'ZZPII-RET โน้ต',
      'images', jsonb_build_array('r2://private/ret_o1/img1.png', 'r2://private/pay-qr/ret_o1/qr.png',
                                  'r2://private/ret_o1/shared.png', 'r2://private/ret_o1/chatpic.png',
                                  'r2://private/ret_o1/bad..png', 'r2://private/other/x.png'),
      'workPhotos', jsonb_build_array(jsonb_build_object('id', 'wp1', 'image', 'r2://private/ret_o1/wp1.png')),
      'selections', jsonb_build_object('g_text', 'ZZPII-RET ข้อความบนเค้ก', 'g_flavor', 'ช็อกโกแลต'))),
   'vat', jsonb_build_object('rate', 7, 'mode', 'inclusive'),
   'adjustment', jsonb_build_object('amount', 0, 'reason', 'ZZPII-RET เหตุผลปรับ'),
   'history', jsonb_build_array(jsonb_build_object('at', '2026-01-01T00:00:00Z', 'by', 'admin', 'text', 'ZZPII-RET ประวัติ')),
   'approval', jsonb_build_object('status', 'approved', 'note', 'ZZPII-RET หมายเหตุอนุมัติ', 'decisionNote', 'ZZPII-RET ผลอนุมัติ'),
   'photoConsent', jsonb_build_object('status', 'requested', 'note', 'ZZPII-RET ขอไม่เผยแพร่',
      'history', jsonb_build_array(jsonb_build_object('at', '2026-01-01T00:00:00Z', 'text', 'ZZPII-RET ประวัติความยินยอม'))),
   'payments', jsonb_build_array(jsonb_build_object('id', 'pay_ret_1', 'amount', 500, 'status', 'confirmed', 'method', 'โอนเงิน',
      'slip', 'r2://private/ret_o1/slip.jpg', 'note', 'ZZPII-RET โน้ตสลิป', 'cancelReason', 'ZZPII-RET เหตุผลยกเลิกยอด')),
   'returns', jsonb_build_array(jsonb_build_object('id', 'rf_ret_1', 'amount', 0, 'reason', 'ZZPII-RET เหตุผลคืน',
      'note', 'ZZPII-RET โน้ตคืน', 'refunds', '[]'::jsonb,
      'cancelled', jsonb_build_object('at', '2026-01-02T00:00:00Z', 'reason', 'ZZPII-RET เหตุผลยกเลิกการคืน')))),
 pg_temp.ret_at(pg_temp.ret_cut() - 400)),
-- ยังค้างชำระ (ไม่ปิด): ต้องไม่แตะ และลูกค้าต้องไม่ถูกยกยอด
('ret_o_open', 'OR-RET-O', 'ret_c2', 'awaiting_payment', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_c2',
   'items', jsonb_build_array(jsonb_build_object('id', 'ito', 'name', 'เค้กค้าง', 'qty', 1, 'unitPrice', 500)),
   'adjustment', jsonb_build_object('amount', 0, 'reason', 'ค้างชำระ'),
   'payments', '[]'::jsonb), pg_temp.ret_at(pg_temp.ret_cut() - 400)),
-- ยกเลิกแล้ว มีข้อความ และถอนยอดหลังวันตัด: นิรนามได้ แต่ลูกค้าต้องไม่ถูกยกยอด
('ret_o3', 'OR-RET-3', 'ret_c3', 'cancelled', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_c3',
   'address', 'ZZPII-RET ที่อยู่ ret_o3',
   'items', jsonb_build_array(jsonb_build_object('id', 'it3', 'name', 'เค้กยกเลิก', 'qty', 1, 'unitPrice', 500, 'note', 'ZZPII-RET โน้ต ret_o3')),
   'payments', jsonb_build_array(jsonb_build_object('id', 'pay_ret_3', 'amount', 500, 'status', 'refunded', 'method', 'โอนเงิน', 'note', 'ZZPII-RET โน้ตยอด ret_o3')),
   'cancel', jsonb_build_object('reason', 'ZZPII-RET เหตุผลยกเลิก', 'refundNote', 'ZZPII-RET หมายเหตุคืน', 'refunds', '[]'::jsonb, 'refundAmount', 0, 'at', '2026-01-02T00:00:00Z'),
   'adjustment', jsonb_build_object('amount', 0, 'reason', 'ZZPII-RET ปรับ ret_o3'),
   'history', jsonb_build_array(jsonb_build_object('at', '2026-01-02T00:00:00Z', 'by', 'admin', 'text', 'ZZPII-RET ประวัติ ret_o3'))),
 pg_temp.ret_at(pg_temp.ret_cut() - 400)),
-- มีการอ้างอิงไฟล์ในฟิลด์ที่ไม่รู้จัก: ต้องข้ามทั้งออร์เดอร์ ไม่แตะไฟล์
('ret_o_left', 'OR-RET-L', 'ret_left', 'delivered', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_left',
   'items', jsonb_build_array(jsonb_build_object('id', 'itl', 'name', 'เค้กเหลือ', 'qty', 1, 'unitPrice', 300, 'extra', 'r2://private/ret_o_left/x.png')),
   'payments', jsonb_build_array(jsonb_build_object('id', 'payl', 'amount', 300, 'status', 'confirmed', 'method', 'เงินสด'))),
 pg_temp.ret_at(pg_temp.ret_cut() - 400)),
-- หลังวันตัด: ไม่แตะ · ออร์เดอร์ค้างที่ใช้ไฟล์ร่วมกับ ret_o1 (ทำให้ไฟล์นั้นลบไม่ได้)
('ret_o_post', 'OR-RET-P', 'ret_c4', 'delivered', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_c4',
   'items', jsonb_build_array(jsonb_build_object('id', 'itp', 'name', 'เค้กหลังวันตัด', 'qty', 1, 'unitPrice', 300)),
   'adjustment', jsonb_build_object('amount', 0, 'reason', 'หลังวันตัด'),
   'payments', jsonb_build_array(jsonb_build_object('id', 'payp', 'amount', 300, 'status', 'confirmed', 'method', 'เงินสด'))),
 pg_temp.ret_at(pg_temp.ret_cut() + 30)),
('ret_o_shared2', 'OR-RET-S', 'ret_c4', 'awaiting_payment', 'pickup', 'web', jsonb_build_object(
   'customerId', 'ret_c4',
   'items', jsonb_build_array(jsonb_build_object('id', 'its', 'name', 'เค้กใช้รูปร่วม', 'qty', 1, 'unitPrice', 200,
      'images', jsonb_build_array('r2://private/ret_o1/shared.png')))),
 pg_temp.ret_at(pg_temp.ret_cut() + 30));

-- ข้อความอิสระที่ระบบอื่นเก็บไว้ของออร์เดอร์ ret_o1 (ต้องถูกล้างด้วย) และการอ้างอิงไฟล์จากตารางอื่น
insert into public.punpang_records (collection, id, data) values
  ('photoRequests', 'pr_ret_1', jsonb_build_object('id', 'pr_ret_1', 'orderId', 'ret_o1', 'customerId', 'ret_c1',
     'status', 'approved', 'note', 'ZZPII-RET คำขอไม่เผยแพร่', 'decisionNote', 'ZZPII-RET ผลคำขอ')),
  ('orderLinks', 'ret_link_1', jsonb_build_object('orderId', 'ret_o1', 'image', 'r2://private/ret_o1/chatpic.png'));

select pg_temp.ret_ev('ret_b1', 'ret_b1', pg_temp.ret_cut() - 900, 300);
select pg_temp.ret_ev('ret_b2', 'ret_b2', pg_temp.ret_cut() - 800, 300);
select pg_temp.ret_ev('ret_c1', 'ret_o1', pg_temp.ret_cut() - 400, 500);
select pg_temp.ret_ev('ret_c2', 'ret_o_open', pg_temp.ret_cut() - 400, 500);
select pg_temp.ret_ev('ret_c3', 'ret_o3', pg_temp.ret_cut() - 400, 500);
select pg_temp.ret_undo('ret_c3', 'ret_o3', (now() at time zone 'Asia/Bangkok')::date, 500);
select pg_temp.ret_ev('ret_c4', 'ret_o_post', pg_temp.ret_cut() + 30, 300);
select pg_temp.ret_ev('ret_left', 'ret_o_left', pg_temp.ret_cut() - 400, 300);

-- ---------- 1) ค่าตั้ง: ค่าผิดหรือไม่ครบ = ปิด ----------
select pg_temp.ret_cfg('{"mode":"bogus","years":5,"batch":200}');
select test.ok('1.1 โหมดไม่รู้จัก = ปิด', public.punpang__ret_cfg()->>'mode' = 'off');
select pg_temp.ret_cfg('{"mode":"live","years":4,"batch":200}');
select test.ok('1.2 ปีน้อยกว่า 5 = ปิด', public.punpang__ret_cfg()->>'mode' = 'off');
select pg_temp.ret_cfg('{"mode":"live","years":31,"batch":200}');
select test.ok('1.3 ปีมากกว่า 30 = ปิด', public.punpang__ret_cfg()->>'mode' = 'off');
select pg_temp.ret_cfg('{"mode":"live","years":"5","batch":200}');
select test.ok('1.4 ปีเป็นข้อความ = ปิด', public.punpang__ret_cfg()->>'mode' = 'off');
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":0}');
select test.ok('1.5 ชุดต่ำสุดถูกบังคับเป็น 1', (public.punpang__ret_cfg()->>'batch')::int = 1);
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":5000}');
select test.ok('1.6 ชุดสูงสุดถูกบังคับเป็น 1000', (public.punpang__ret_cfg()->>'batch')::int = 1000);
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":"x"}');
select test.ok('1.7 ชุดไม่ใช่ตัวเลข = 200', (public.punpang__ret_cfg()->>'batch')::int = 200);

-- ---------- 2) โหมดปิด / รายงาน / ไม่มีกลุ่มข้อความ ----------
select pg_temp.ret_cfg('{"mode":"off","years":5,"batch":200}');
select test.ok('2.1 โหมดปิด: ไม่ทำอะไรเลย', public.punpang_retention5y_run()->>'mode' = 'off'
  and not exists (select 1 from public.punpang_orders where data ? 'retentionAnon'));
select pg_temp.ret_cfg('{"mode":"report","years":5,"batch":200}');
select test.ok('2.2 โหมดรายงาน: นับได้แต่ไม่แก้ข้อมูล', public.punpang_retention5y_run()->>'mode' = 'report'
  and (public.punpang_retention5y_run()->>'ordersReady')::int >= 5
  and not exists (select 1 from public.punpang_orders where data ? 'retentionAnon'));
delete from public.punpang_kv where collection = 'config' and id = 'optionGroups';
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":200}');
select test.ok('2.3 สดแต่ไม่มีกลุ่มข้อความ = หยุด ไม่ตัดข้อมูล', public.punpang_retention5y_run()->>'error' = 'no_text_groups'
  and not exists (select 1 from public.punpang_orders where data ? 'retentionAnon'));
insert into public.punpang_kv (collection, id, data) values
  ('config', 'optionGroups', '{"v":[{"id":"g_text","type":"text"},{"id":"g_flavor","type":"choice"}]}')
on conflict (collection, id) do update set data = excluded.data;

-- ---------- 3) ทำจริง: ทีละชุด แล้วส่วนที่เหลือ ----------
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":200}');
-- เรียกฟังก์ชันที่แก้ข้อมูลในคำสั่งของมันเอง แล้วตรวจในคำสั่งถัดไป (คำสั่งเดียวกันมองไม่เห็นการแก้ของฟังก์ชัน)
create temp table ret_run1 as select public.punpang_retention5y_run(1) as r;
select test.ok('3.1 ชุด 1 ทำเฉพาะออร์เดอร์เก่าสุด (ret_b1)', (select (r->>'orders')::int from ret_run1) = 1
  and exists (select 1 from public.punpang_orders where id = 'ret_b1' and data ? 'retentionAnon')
  and not exists (select 1 from public.punpang_orders where id = 'ret_b2' and data ? 'retentionAnon'));

create temp table ret_run as select public.punpang_retention5y_run() as r;
select test.ok('3.2 รอบเต็มทำที่เหลือ: 3 ออร์เดอร์ (ret_b2, ret_o1, ret_o3)', (select (r->>'orders')::int from ret_run) = 3);
select test.ok('3.3 ข้ามออร์เดอร์ที่มีการอ้างอิงเหลือ และลูกค้าที่ยังไม่ยุติ', (select (r->>'leftoverRefs')::int from ret_run) = 1
  and (select (r->>'customersBlocked')::int from ret_run) >= 3
  and (select (r->>'customersCarried')::int from ret_run) = 2);
select test.ok('3.4 ไฟล์: เข้าคิว 4 รายการ และไม่ลบ 4 รายการที่ใช้ร่วม/อ้างจากที่อื่น/ชื่อไม่ถูก/ของคนอื่น',
  (select (r->>'filesQueued')::int from ret_run) = 4 and (select (r->>'filesKept')::int from ret_run) = 4);

select test.ok('3.5 ออร์เดอร์นิรนาม: ระบุตัวตนและข้อความอิสระถูกล้าง ยังมีเครื่องหมายบอกว่าทำแล้ว', (
  select data->>'address' = '' and data->>'placeName' = '' and data->>'detail' = '' and data->>'mapUrl' = ''
     and data->'birthday' = 'null'::jsonb and data->>'chatId' is null and not (data ? 'occasion')
     and data->'items'->0->>'note' = '' and data->'items'->0->'images' = '[]'::jsonb and data->'items'->0->'workPhotos' = '[]'::jsonb
     and not ((data->'items'->0->'selections') ? 'g_text') and data->'items'->0->'selections'->>'g_flavor' = 'ช็อกโกแลต'
     and not ((data->'history'->0) ? 'text') and data->'history'->0->>'by' = 'admin'
     and data->'adjustment'->>'reason' = '' and data->'approval'->>'note' = '' and data->'approval'->>'decisionNote' = ''
     and data->'photoConsent'->>'note' = '' and not ((data->'photoConsent'->'history'->0) ? 'text')
     and data->'payments'->0->>'note' = '' and data->'payments'->0->>'slip' = '' and data->'payments'->0->>'cancelReason' = ''
     and data->'returns'->0->>'reason' = '' and data->'returns'->0->>'note' = '' and data->'returns'->0->'cancelled'->>'reason' = ''
     and data ? 'retentionAnon'
  from public.punpang_orders where id = 'ret_o1'));
select test.ok('3.6 ออร์เดอร์นิรนาม: ยอด รายการ สถานะ และเลขเอกสารยังอยู่', (
  select data->'items'->0->>'unitPrice' = '500' and data->'items'->0->>'name' = 'เค้กทดสอบ'
     and data->'payments'->0->>'amount' = '500' and data->'vat'->>'rate' = '7' and status = 'delivered' and code = 'OR-RET-1'
  from public.punpang_orders where id = 'ret_o1'));
select test.ok('3.7 คิวไฟล์มีเฉพาะไฟล์ของออร์เดอร์นี้ที่ไม่มีที่อื่นอ้าง', (
  select coalesce(array_agg(id order by id), '{}') from public.punpang_kv where collection = 'retentionFiles')
  = array['pay-qr/ret_o1/qr.png', 'ret_o1/img1.png', 'ret_o1/slip.jpg', 'ret_o1/wp1.png']);
select test.ok('3.8 รายการที่คืนให้ลบ (deleteKeys) ตรงกับคิว', (
  select array_agg(x order by x) from ret_run, jsonb_array_elements_text(r->'deleteKeys') as x)
  = array['pay-qr/ret_o1/qr.png', 'ret_o1/img1.png', 'ret_o1/slip.jpg', 'ret_o1/wp1.png']);
select test.ok('3.9 ออร์เดอร์ที่ยังไม่ปิด/หลังวันตัด/ข้ามได้ ไม่ถูกแตะ', (
  select count(*) = 0 from public.punpang_orders where id in ('ret_o_open', 'ret_o_post', 'ret_o_shared2', 'ret_o_left') and data ? 'retentionAnon')
  and (select data->'adjustment'->>'reason' = 'ค้างชำระ' from public.punpang_orders where id = 'ret_o_open')
  and (select data->'adjustment'->>'reason' = 'หลังวันตัด' from public.punpang_orders where id = 'ret_o_post')
  and (select data->'items'->0->>'extra' = 'r2://private/ret_o_left/x.png' from public.punpang_orders where id = 'ret_o_left'));
select test.ok('3.10 บันทึกการแก้ยอดและรายการที่ยังนับได้: ข้อความอิสระในบันทึกถูกล้าง',
  not exists (select 1 from public.punpang_order_changes where changed_at >= now() - interval '1 day' and summary::text like '%ZZPII-RET%'));
select test.ok('3.11 คำขอถ่ายรูปของออร์เดอร์นี้: หมายเหตุถูกล้าง',
  (select data->>'note' = '' and data->>'decisionNote' = '' from public.punpang_records where collection = 'photoRequests' and id = 'pr_ret_1'));

do $$
declare t record; c bigint; n bigint := 0;
begin
  for t in select c2.relname as name from pg_class c2 join pg_namespace s on s.oid = c2.relnamespace
            where s.nspname = 'public' and c2.relkind = 'r' loop
    execute format('select count(*) from public.%I x where x::text like %L', t.name, '%ZZPII-RET%') into c;
    n := n + c;
  end loop;
  perform test.ok('3.12 ไม่มีข้อความ ZZPII-RET เหลือในตารางสาธารณะใดเลย', n = 0);
end $$;

-- ret_c1 ลดถึง LV1 และไม่มีรายการหลังวันตัด → ยกยอดแล้วสแนปช็อตถูกลบในรอบเดียวกัน (กติกา 365 วัน)
select test.ok('3.13 ยกยอดลูกค้าที่ยุติแล้ว: ไม่เหลือเหตุการณ์ก่อนวันตัด และสแนปช็อต LV1 ที่ไม่มีรายการ 365 วันถูกลบ', (
  select count(*) = 0 from public.punpang_member_snapshots where customer_id = 'ret_c1')
  and not exists (select 1 from public.punpang_member_events where customer_id = 'ret_c1' and day < pg_temp.ret_cut()));
select test.ok('3.14 ลูกค้าที่ยังค้าง/ถอนยอดหลังวันตัด/ไม่มีออร์เดอร์: ไม่ยกยอด เหตุการณ์ยังอยู่ครบ', (
  not exists (select 1 from public.punpang_member_snapshots where customer_id in ('ret_c2', 'ret_c3', 'ret_left')))
  and (select count(*) from public.punpang_member_events where customer_id in ('ret_c2', 'ret_c3', 'ret_left')) = 4);
select test.ok('3.15 เหตุการณ์หลังวันตัดยังอยู่', (select count(*) from public.punpang_member_events where customer_id = 'ret_c4') = 1);
select test.ok('3.16 สแนปช็อตที่หมดอายุในแต่ละรอบ: รอบชุด 1 = 1 (ret_b1) · รอบเต็ม = 2 (ret_b2, ret_c1)',
  (select (r->>'snapshotsExpired')::int from ret_run1) = 1 and (select (r->>'snapshotsExpired')::int from ret_run) = 2);

-- ---------- 4) รันซ้ำ / ยืนยันลบ / การกันบันทึกทับ ----------
create temp table ret_run2 as select public.punpang_retention5y_run() as r;
select test.ok('4.1 รันซ้ำไม่ทำซ้ำ และยังคืนไฟล์ที่ยังไม่ยืนยัน', (select (r->>'orders')::int from ret_run2) = 0
  and (select r->'deleteKeys' ? 'ret_o1/img1.png' from ret_run2));
create temp table ret_ack as select public.punpang_retention5y_ack(array['ret_o1/img1.png', 'pay-qr/ret_o1/qr.png']) as n;
select test.ok('4.2 ยืนยันลบแล้วเอาออกจากคิว (รายการอื่นยังอยู่)', (select n from ret_ack) = 2
  and not exists (select 1 from public.punpang_kv where collection = 'retentionFiles' and id in ('ret_o1/img1.png', 'pay-qr/ret_o1/qr.png'))
  and exists (select 1 from public.punpang_kv where collection = 'retentionFiles' and id = 'ret_o1/wp1.png'));

do $$
declare st text := 'none';
begin
  begin
    update public.punpang_orders set data = data - 'retentionAnon' where id = 'ret_o1';
  exception when sqlstate '42501' then st := '42501';
  end;
  perform test.ok('4.3 บันทึกทับออร์เดอร์นิรนามด้วยข้อมูลเดิมไม่ได้ (42501)', st = '42501');
end $$;
do $$
declare st text := 'none';
begin
  begin
    update public.punpang_orders set customer_id = 'ret_c2' where id = 'ret_o1';
  exception when sqlstate '42501' then st := '42501';
  end;
  perform test.ok('4.4 โอนผู้ซื้อของออร์เดอร์นิรนามไม่ได้ (42501)', st = '42501');
end $$;
do $$
declare st text := 'none';
begin
  begin
    update public.punpang_orders set data = jsonb_set(data, '{loyalty}', '{"points": 1}'::jsonb) where id = 'ret_o1';
  exception when sqlstate '42501' then st := '42501';
  end;
  perform test.ok('4.5 แก้คะแนนของออร์เดอร์นิรนามไม่ได้ (42501)', st = '42501');
end $$;

-- ---------- 5) สิทธิ์ ----------
select test.ok('5.1 รายงานให้ผู้ดูแลเปิดได้', test.rpc_as('dddddddd-0000-4000-8000-000000000001', 'select public.punpang_retention5y_report()')->>'exception' is null);
select test.ok('5.2 พนักงานขายเปิดรายงานไม่ได้ (42501)', test.rpc_as('dddddddd-0000-4000-8000-000000000002', 'select public.punpang_retention5y_report()')->>'exception' = '42501');
select test.ok('5.3 ตารางสแนปช็อตไม่เปิดให้ผู้ใช้ anon/authenticated/service_role',
  not has_table_privilege('authenticated', 'public.punpang_member_snapshots', 'select')
  and not has_table_privilege('anon', 'public.punpang_member_snapshots', 'select')
  and not has_table_privilege('service_role', 'public.punpang_member_snapshots', 'select'));
select test.ok('5.4 งานระยะเก็บและการยืนยันลบ: เฉพาะ service_role',
  has_function_privilege('service_role', 'public.punpang_retention5y_run(int)', 'execute')
  and not has_function_privilege('authenticated', 'public.punpang_retention5y_run(int)', 'execute')
  and not has_function_privilege('anon', 'public.punpang_retention5y_run(int)', 'execute')
  and has_function_privilege('service_role', 'public.punpang_retention5y_ack(text[])', 'execute')
  and not has_function_privilege('authenticated', 'public.punpang_retention5y_ack(text[])', 'execute'));
select test.ok('5.5 ฟังก์ชันภายในปิดจากผู้ใช้ทั้งหมด',
  not has_function_privilege('authenticated', 'public.punpang__ret_cfg()', 'execute')
  and not has_function_privilege('anon', 'public.punpang__ret_carry(text, date)', 'execute'));

-- ---------- 6) ลบลูกค้า (PDPA) ลบสแนปช็อตด้วย ----------
update public.punpang_customers set data = data || '{"deleted": true}'::jsonb where id = 'ret_c1';
select test.ok('6.1 ลบลูกค้า: ลบสแนปช็อตและเหตุการณ์ของลูกค้าคนนั้น', not exists (select 1 from public.punpang_member_snapshots where customer_id = 'ret_c1')
  and not exists (select 1 from public.punpang_member_events where customer_id = 'ret_c1'));
select test.ok('6.2 ลูกค้าที่ไม่มีเหตุการณ์ก่อนวันตัด: ยกยอดซ้ำไม่ได้ (คืน false)', public.punpang__ret_carry('ret_c1', pg_temp.ret_cut()) = false);

-- ---------- 7) ยกยอดสมาชิก: ผลหลังยกยอดต้องเท่ากับการคำนวณเต็มทุกจุดเวลา ----------
create temp table ret_ref (tag text, cid text, p_now timestamptz, f jsonb);
-- eq1: ซื้อ 1,200 → 2,500 (ต่ออายุ) → 150 (ก่อนวันตัด) → 150 (หลังวันตัด)
select pg_temp.ret_ev('ret_eq1', 'ret_eq_a', pg_temp.ret_cut() - 900, 1200);
select pg_temp.ret_ev('ret_eq1', 'ret_eq_b', pg_temp.ret_cut() - 700, 2500);
select pg_temp.ret_ev('ret_eq1', 'ret_eq_c', pg_temp.ret_cut() - 200, 150);
select pg_temp.ret_ev('ret_eq1', 'ret_eq_d', pg_temp.ret_cut() + 10, 150);
-- eq2: ต่ออายุวันครบกำหนดลดขั้นพอดีวันตัด (วันตัด − จำนวนวันลดขั้น)
select pg_temp.ret_ev('ret_eq2', 'ret_eq_e', pg_temp.ret_cut() - (public.punpang__member_cfg()->>'downgradeDays')::int, 1500);

insert into ret_ref (tag, cid, p_now, f)
select 'eq1', 'ret_eq1', t, public.punpang__member_fold('ret_eq1', t)
  from (select pg_temp.ret_at(pg_temp.ret_cut() + n, time '23:00') as t from unnest(array[0, 9, 10, 100, 165, 200, 400]) as n) x;
insert into ret_ref (tag, cid, p_now, f)
select 'eq2', 'ret_eq2', t, public.punpang__member_fold('ret_eq2', t)
  from (select pg_temp.ret_at(pg_temp.ret_cut() + n, time '23:00') as t from unnest(array[0, 1, 30, 400]) as n) x;

do $$
begin
  perform public.punpang__ret_carry('ret_eq2', pg_temp.ret_cut());        -- ยกยอดรอบเดียว (วันครบพอดี)
  perform public.punpang__ret_carry('ret_eq1', pg_temp.ret_cut() - 500);  -- ยกยอดรอบที่ 1
  perform public.punpang__ret_carry('ret_eq1', pg_temp.ret_cut());        -- ยกยอดรอบที่ 2 ต่อจากสแนปช็อต
end $$;

select test.ok('7.1 หลังยกยอดทุกรอบ สถานะทุกจุดเวลาเท่ากับการคำนวณเต็มก่อนยกยอด', not exists (
  select 1 from ret_ref r where public.punpang__member_fold(r.cid, r.p_now) is distinct from r.f));
select test.ok('7.2 วันครบกำหนดพอดีวันตัด: ลดขั้นในการคำนวณเต็ม (ระดับ 1)', (
  select (f->>'level')::int = 1 from ret_ref where tag = 'eq2' and p_now = pg_temp.ret_at(pg_temp.ret_cut(), time '23:00')));
select test.ok('7.3 สแนปช็อตลูกค้าสองรายตั้งวันตัด และเหลือเฉพาะเหตุการณ์หลังวันตัด', (
  select count(*) = 2 from public.punpang_member_snapshots where customer_id in ('ret_eq1', 'ret_eq2') and as_of = pg_temp.ret_cut())
  and (select count(*) = 1 from public.punpang_member_events where customer_id = 'ret_eq1')
  and not exists (select 1 from public.punpang_member_events where customer_id = 'ret_eq2'));
select test.ok('7.4 วันของรายการล่าสุดที่ยกยอดไว้ (last_day) = รายการล่าสุดก่อนวันตัด ไม่ถอยหลังเมื่อยกยอดซ้ำ', (
  select last_day = pg_temp.ret_cut() - 200 from public.punpang_member_snapshots where customer_id = 'ret_eq1')
  and (select last_day = pg_temp.ret_cut() - (public.punpang__member_cfg()->>'downgradeDays')::int from public.punpang_member_snapshots where customer_id = 'ret_eq2'));

-- ---------- 8) สแนปช็อตหมดอายุ: ลดถึง LV1 และไม่มีรายการ 365 วัน ----------
-- ตั้งสแนปช็อตโดยตรงตามวันที่ต้องการ (ลูกค้าไม่มีเหตุการณ์ก่อนวันตัด) แล้วรันงานจริง
create function pg_temp.ret_today() returns date language sql stable as $$
  select (now() at time zone 'Asia/Bangkok')::date
$$;
insert into public.punpang_customers (id, name, data) values
  ('ret_x1', 'ลูกค้าทดสอบ LV1 เงียบ 400 วัน', '{"ledger":[],"spins":0}'),
  ('ret_x2', 'ลูกค้าทดสอบ LV1 ล่าสุด 100 วัน', '{"ledger":[],"spins":0}'),
  ('ret_x3', 'ลูกค้าทดสอบ LV2 ลดขั้นยังไม่ครบ', '{"ledger":[],"spins":0}'),
  ('ret_x4', 'ลูกค้าทดสอบ มีรายการใหม่ค้างอยู่', '{"ledger":[],"spins":0}');
insert into public.punpang_member_snapshots (customer_id, as_of, lvl, cum, renew_at, down_at, last_day) values
  ('ret_x1', pg_temp.ret_today() - 400, 1, 0, pg_temp.ret_today() - 400, null, pg_temp.ret_today() - 400),
  ('ret_x2', pg_temp.ret_today() - 100, 1, 0, pg_temp.ret_today() - 100, null, pg_temp.ret_today() - 100),
  ('ret_x3', pg_temp.ret_today() - 500, 2, 1000, pg_temp.ret_today() - 500, pg_temp.ret_today() - 135, pg_temp.ret_today() - 500),
  ('ret_x4', pg_temp.ret_today() - 400, 1, 0, pg_temp.ret_today() - 400, null, pg_temp.ret_today() - 400);
select pg_temp.ret_ev('ret_x4', 'ret_x4_o', pg_temp.ret_today() - 10, 300);

-- 8.1 โหมดรายงาน: นับได้แต่ไม่ลบ
select pg_temp.ret_cfg('{"mode":"report","years":5,"batch":200}');
create temp table ret_rep as select public.punpang_retention5y_run() as r;
select test.ok('8.1 โหมดรายงาน: นับสแนปช็อตที่จะหมดอายุ (อย่างน้อย ret_x1) แต่ไม่ลบ',
  (select (r->>'snapshotsExpiring')::int >= 1 from ret_rep)
  and exists (select 1 from public.punpang_member_snapshots where customer_id = 'ret_x1'));

-- 8.2–8.5 โหมดทำจริง
select pg_temp.ret_cfg('{"mode":"live","years":5,"batch":200}');
create temp table ret_exp as select public.punpang_retention5y_run() as r;
select test.ok('8.2 LV1 และไม่มีรายการ 365 วัน → ลบ (ret_x1 และ ret_eq2 จากหมวด 7)',
  (select (r->>'snapshotsExpired')::int from ret_exp) = 2
  and not exists (select 1 from public.punpang_member_snapshots where customer_id in ('ret_x1', 'ret_eq2')));
select test.ok('8.3 รายการล่าสุดยังไม่ครบ 365 วัน → เก็บ (ret_x2)',
  exists (select 1 from public.punpang_member_snapshots where customer_id = 'ret_x2'));
select test.ok('8.4 ยังเป็น LV2 (ลดขั้นยังไม่ครบ) แม้รายการล่าสุดเกิน 365 วัน → เก็บ (ret_x3)',
  exists (select 1 from public.punpang_member_snapshots where customer_id = 'ret_x3')
  and (public.punpang__member_fold('ret_x3', now())->>'level')::int = 2);
select test.ok('8.5 มีรายการใหม่ค้างอยู่ → เก็บ แม้เป็น LV1 และสแนปช็อตเกิน 365 วัน (ret_x4)',
  exists (select 1 from public.punpang_member_snapshots where customer_id = 'ret_x4'));

-- ปิดท้าย: ไม่บันทึกอะไรถาวร
rollback;
