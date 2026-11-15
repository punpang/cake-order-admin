-- ทดสอบความปลอดภัยของฐานข้อมูล: รันโดย supabase/tests/run.sh หลัง stubs.sql + migration ทุกไฟล์
-- แต่ละข้อใช้ test.ok(ชื่อ, เงื่อนไข) · เงื่อนไขไม่เป็นจริง = ล้มทันที (psql จบด้วยรหัสผิดพลาด)
-- ข้อที่ขึ้นต้นด้วยรหัส T1–T9 มาจากการทดสอบเจาะระบบที่พบในรายงานตรวจโค้ด (ก่อนแก้ ข้อเหล่านี้ "สำเร็จ" = ช่องโหว่)

-- ---------- ตัวช่วย ----------
create function test.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- รันคำสั่งในฐานะพนักงาน (role authenticated + sub = uid) · คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function test.as_staff(uid uuid, stmt text) returns text language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return 'OK';
end $$;

-- เหมือน as_staff แต่ stmt ต้องคืนค่า jsonb หนึ่งค่า (เรียก RPC) · ผิดพลาด = { exception, message }
create function test.rpc_as(uid uuid, stmt text) returns jsonb language plpgsql as $$
declare res jsonb;
begin
  perform set_config('request.jwt.claim.sub', coalesce(uid::text, ''), true);
  execute 'set local role authenticated';
  begin
    execute stmt into res;
  exception when others then
    execute 'reset role';
    return jsonb_build_object('exception', sqlstate, 'message', sqlerrm);
  end;
  execute 'reset role';
  return res;
end $$;

-- รันคำสั่งในฐานะผู้ไม่ล็อกอิน
create function test.as_anon(stmt text) returns text language plpgsql as $$
begin
  execute 'set local role anon';
  begin
    execute stmt;
  exception when others then
    execute 'reset role';
    return 'ERR:' || sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  return 'OK';
end $$;

-- ---------- ข้อมูลตั้งต้น ----------
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'sales@t'),
  ('22222222-2222-2222-2222-222222222222', 'driver@t'),
  ('33333333-3333-3333-3333-333333333333', 'baker@t'),
  ('44444444-4444-4444-4444-444444444444', 'refunder@t'),
  ('55555555-5555-5555-5555-555555555555', 'admin@t'),
  ('66666666-6666-6666-6666-666666666666', 'payer@t'),
  ('77777777-7777-7777-7777-777777777777', 'changer@t');
insert into public.punpang_staff (user_id, name, role, perms) values
  ('11111111-1111-1111-1111-111111111111', 'Sales', 'sales', '{createOrder,viewAllOrders,useLoyalty,pos}'),
  ('22222222-2222-2222-2222-222222222222', 'Driver', 'driver', '{deliverShipping,viewDeliveryOrders}'),
  ('33333333-3333-3333-3333-333333333333', 'Baker', 'baker', '{startPreparing,markPrepared,workPhoto,viewPrepOrders}'),
  ('44444444-4444-4444-4444-444444444444', 'Refunder', 'sales', '{refundPartial,viewAllOrders}'),
  ('55555555-5555-5555-5555-555555555555', 'Admin', 'admin', '{manage,manageUsers,adjustPoints,confirmPayment,useLoyalty,viewAllOrders,createOrder,revertStatus,cancel}'),
  ('66666666-6666-6666-6666-666666666666', 'Payer', 'sales', '{reportPayment}'),
  ('77777777-7777-7777-7777-777777777777', 'Changer', 'sales', '{changeBuyer,viewAllOrders}');

insert into public.punpang_customers (id, name, phone, data) values
  ('c1', 'Cust One', '0811111111', '{"ledger":[],"spins":0}'),
  ('c2', 'Cust Two', '0822222222', '{"ledger":[],"spins":0}'),
  ('c_legacy', 'Legacy', '0833333333', '{}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('o_prep', 'OR-141126-000001', 'c1', 'preparing', 'pickup', 'line',
   '{"items":[{"unitPrice":300,"qty":3}],"payments":[],"adjustment":{"amount":0}}'),
  ('o_del', 'OR-141126-000002', 'c1', 'delivered', 'pickup', 'line',
   '{"items":[{"unitPrice":300,"qty":3}],"payments":[{"id":"p1","status":"confirmed","amount":900}],"adjustment":{"amount":0}}'),
  ('o_del2', 'OR-141126-000004', 'c1', 'delivered', 'pickup', 'line',
   '{"items":[{"unitPrice":300,"qty":3}],"payments":[{"id":"p3","status":"confirmed","amount":900}],"adjustment":{"amount":0}}'),
  ('o_del3', 'OR-141126-000005', 'c1', 'delivered', 'pickup', 'line',
   '{"items":[{"unitPrice":300,"qty":3}],"payments":[{"id":"p4","status":"confirmed","amount":900}],"adjustment":{"amount":0}}'),
  ('o_pay', 'OR-141126-000003', 'c1', 'payment_confirmed', 'pickup', 'line',
   '{"items":[{"unitPrice":500,"qty":1}],"payments":[{"id":"p2","status":"confirmed","amount":500}],"loyalty":{"points":5,"spins":1,"lotId":"lot_award"}}');

-- ===== H1/T1: แก้สมุดแต้ม/สิทธิ์หมุนตรง ๆ =====
select test.ok('T1: sales (createOrder) แก้ spins ตรง ๆ ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_customers set data = jsonb_set(data, '{spins}', '9999') where id = 'c1' $q$) like 'ERR:42501:%');
select test.ok('T1: sales แก้ ledger ตรง ๆ ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_customers set data = jsonb_set(data, '{ledger}', '[{"id":"x","delta":1000000,"remaining":1000000}]'::jsonb) where id = 'c1' $q$) like 'ERR:42501:%');
select test.ok('H1: sales แก้ชื่อได้ตามเดิม',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_customers set name = 'Cust One X' where id = 'c1' $q$) = 'OK');
select test.ok('H1: บันทึกซ้ำด้วย ledger/spins เดิมและเพิ่มฟิลด์อื่นได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_customers set data = data || '{"promoOptIn":true}'::jsonb where id = 'c1' $q$) = 'OK');
select test.ok('H1: ลูกค้าเก่าที่ยังไม่มี ledger/spins บันทึกด้วยสมุดว่างได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_customers set data = jsonb_build_object('ledger', '[]'::jsonb, 'spins', 0) where id = 'c_legacy' $q$) = 'OK');
select test.ok('H1: สร้างลูกค้าใหม่ที่มีแต้มมาให้ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_customers (id, name, data) values ('c_fake', 'Fake', '{"ledger":[{"id":"x","delta":500,"remaining":500}],"spins":0}') $q$) like 'ERR:42501:%');
select test.ok('H1: สร้างลูกค้าใหม่ที่มีสิทธิ์หมุนมาให้ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_customers (id, name, data) values ('c_fake2', 'Fake2', '{"ledger":[],"spins":50}') $q$) like 'ERR:42501:%');
select test.ok('H1: สร้างลูกค้าใหม่ด้วยสมุดว่างได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_customers (id, name, data) values ('c_new', 'New', '{"ledger":[],"spins":0}') $q$) = 'OK');
update public.punpang_customers set data = jsonb_set(jsonb_set(data, '{ledger}', '[{"id":"seed","delta":10,"remaining":10}]'::jsonb), '{spins}', '3') where id = 'c2';
select test.ok('H1: แอดมิน (manage) ล้างสมุดตรงได้ (ลบข้อมูลตามคำขอ PDPA)',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_customers set data = jsonb_set(jsonb_set(data, '{ledger}', '[]'::jsonb), '{spins}', '0') where id = 'c2' $q$) = 'OK');
select test.ok('H1: RPC ปรับแต้ม (security definer) ยังเขียนสมุดได้',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_adjust_points('c1', 2000, 'seed') $q$)->>'ok')::boolean);
select test.ok('H1: หลัง RPC ปรับแต้ม สมุดของ c1 มีรายการ',
  (select jsonb_array_length(data->'ledger') from public.punpang_customers where id = 'c1') = 1);

-- ===== H2/T2: ให้คะแนนตอนส่งมอบ =====
select test.ok('T2: คนส่งของให้คะแนนออร์เดอร์ที่ยังไม่ส่งมอบไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_prep', 9, 0, 1, 900) $q$)->>'error' = 'not_delivered');
select test.ok('T2: คนส่งของขอ 1,000,000 แต้ม + 10,000 สิทธิ์หมุนบนออร์เดอร์ที่ส่งมอบแล้วไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 1000000, 0, 10000, 900) $q$)->>'error' = 'invalid');
select test.ok('H2: ยอดฐานเกินยอดสินค้าของออร์เดอร์ไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 10, 0, 1, 1000) $q$)->>'error' = 'invalid');
select test.ok('H2: คะแนนเกินสูตร (ไม่มีโปร: 900 บาท = 9 แต้ม) ไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 10, 0, 1, 900) $q$)->>'error' = 'invalid');
select test.ok('H2: คะแนนโบนัสเกินคะแนนรวมไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 9, 20, 1, 900) $q$)->>'error' = 'invalid');
select test.ok('H2: คนส่งของให้คะแนนตามสูตรจริงได้ (900 บาท = 9 แต้ม 1 สิทธิ์หมุน)',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 9, 0, 1, 900) $q$)->>'ok')::boolean);
select test.ok('H2: ให้ซ้ำไม่ได้',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del', 9, 0, 1, 900) $q$)->>'error' = 'already_awarded');
select test.ok('H2: คนที่ไม่มีสิทธิ์ส่งมอบ (ช่างเค้ก) ให้คะแนนไม่ได้',
  test.rpc_as('33333333-3333-3333-3333-333333333333', $q$ select public.punpang_award_order('o_del2', 9, 0, 1, 900) $q$)->>'exception' = '42501');
insert into public.punpang_kv (collection, id, data) values
  ('config', 'pointPromos', '{"v":[{"id":"pt1","multiplier":3,"active":true},{"id":"pt2","multiplier":50,"active":false}]}');
select test.ok('H2: มีโปรคูณ 3 → เกิน 27 แต้มไม่ได้ (โปรที่ปิดอยู่ไม่นับ)',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del2', 28, 19, 1, 900) $q$)->>'error' = 'invalid');
select test.ok('H2: มีโปรคูณ 3 → 27 แต้มได้',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('o_del2', 27, 18, 1, 900) $q$)->>'ok')::boolean);

-- ===== H2/T3: แก้สมุดหลายรายการ =====
select test.ok('T3: ผู้มีแค่ refundPartial เพิ่ม 50 × 1,000,000 แต้มไม่ได้',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c1', (select jsonb_agg(jsonb_build_object('op','earn','id','m'||g,'points',1000000,'reason','x','orderId','o_pay')) from generate_series(1,50) g)) $q$)->>'message' = 'cap_exceeded');
select test.ok('H2: earn ไม่ระบุออร์เดอร์ ต้องเป็นแอดมินเท่านั้น (ผู้มี refundPartial ไม่ได้)',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"n1","points":10,"reason":"x"}]'::jsonb) $q$)->>'exception' = '42501');
select test.ok('H2: ผู้มีแค่ useLoyalty เพิ่มคะแนนด้วย earn ไม่ได้ (ไม่ใช่การคืนเงิน/ยกเลิก)',
  test.rpc_as('11111111-1111-1111-1111-111111111111',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"n2","points":10,"reason":"x","orderId":"o_pay"}]'::jsonb) $q$)->>'exception' = '42501');
select test.ok('H2: earn อ้างออร์เดอร์ที่ไม่มีอยู่ไม่ได้',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"n3","points":10,"reason":"x","orderId":"no_such"}]'::jsonb) $q$)->>'message' = 'invalid_op');
select test.ok('H2: คืนเงินเป็นคะแนนตามที่ชำระจริงได้ (ออร์เดอร์จ่าย 500 → คืน 300 แต้ม)',
  (test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"r1","points":300,"reason":"คืนเงิน OR-141126-000003","orderId":"o_pay"}]'::jsonb) $q$)->>'ok')::boolean);
select test.ok('H2: คืนรอบสอง 300 แต้ม รวมเกินที่ชำระ (500) ไม่ได้',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"r2","points":300,"reason":"คืนเงิน","orderId":"o_pay"}]'::jsonb) $q$)->>'message' = 'cap_exceeded');
select test.ok('H2: แอดมินเพิ่มคะแนนแบบไม่ระบุออร์เดอร์ได้ (เช่น คืนคะแนนคูปอง)',
  (test.rpc_as('55555555-5555-5555-5555-555555555555',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"earn","id":"a1","points":100,"reason":"คืนคะแนนคูปอง"}]'::jsonb) $q$)->>'ok')::boolean);
select test.ok('H2: สิทธิ์หมุนเพิ่มโดยไม่อ้างออร์เดอร์ ต้องเป็นแอดมิน',
  test.rpc_as('44444444-4444-4444-4444-444444444444', $q$ select public.punpang_ledger_apply('c1', '[{"op":"spins","delta":5}]'::jsonb) $q$)->>'exception' = '42501');
-- ===== H2 (รอบ 2026-11-15): คืนเงินต้องเป็นของผู้ซื้อ · เพดานสะสมต่อออร์เดอร์ · โอนได้เท่าที่ตัดไว้ =====
select test.ok('H2: คืนเงินเป็นคะแนนให้ลูกค้าอีกคนที่ไม่ใช่ผู้ซื้อของออร์เดอร์ไม่ได้',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"earn","id":"x1","points":5,"reason":"คืนเงิน","orderId":"o_pay"}]'::jsonb) $q$)->>'exception' = '42501');
-- ก้อนคะแนนของการขายและสิทธิ์หมุน 1 ของ o_pay อยู่ที่ c1 (ตั้งค่าโดยผู้ดูแลระบบสำหรับเทสต์)
update public.punpang_customers
   set data = jsonb_set(jsonb_set(data, '{ledger}', coalesce(data->'ledger', '[]'::jsonb) || '[{"id":"lot_award","at":"2026-11-14T00:00:00Z","delta":5,"remaining":5,"orderId":"o_pay","expiresAt":"2099-01-01"}]'::jsonb),
                                  '{spins}', to_jsonb(coalesce((data->>'spins')::int, 0) + 1))
 where id = 'c1';
select test.ok('H2: เปลี่ยนผู้ซื้อ: ตัดคะแนนและสิทธิ์หมุนของออร์เดอร์จากผู้ซื้อเดิมได้',
  (test.rpc_as('77777777-7777-7777-7777-777777777777',
    $q$ select public.punpang_ledger_apply('c1', '[{"op":"cut","lotId":"lot_award","orderId":"o_pay"},{"op":"spins","delta":-1,"orderId":"o_pay"}]'::jsonb) $q$)->>'ok')::boolean);
select test.rpc_as('77777777-7777-7777-7777-777777777777',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"earn","id":"t1","points":5,"reason":"โอนมา","orderId":"o_pay","transfer":true},{"op":"spins","delta":1,"orderId":"o_pay","transfer":true}]'::jsonb) $q$) as r1 \gset
select test.ok('H2: โอนให้ผู้ซื้อใหม่ได้เท่าที่ตัดไว้ (5 แต้ม 1 สิทธิ์) และไม่เกิดของเพิ่ม',
  (:'r1'::jsonb->>'ok')::boolean
  and (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'c2' and e->>'orderId' = 'o_pay') = 5
  and (select (data->>'spins')::int from public.punpang_customers where id = 'c2') = 1);
select test.rpc_as('77777777-7777-7777-7777-777777777777',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"earn","id":"t2","points":5,"reason":"โอนมา","orderId":"o_pay","transfer":true},{"op":"spins","delta":1,"orderId":"o_pay","transfer":true}]'::jsonb) $q$) as r2 \gset
select test.ok('H2: โอนซ้ำหลังโอนครบแล้วไม่ได้คะแนนหรือสิทธิ์หมุนเพิ่ม (ออร์เดอร์เดียวกันออกซ้ำไม่ได้)',
  (:'r2'::jsonb->>'ok')::boolean
  and (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'c2' and e->>'orderId' = 'o_pay') = 5
  and (select (data->>'spins')::int from public.punpang_customers where id = 'c2') = 1);
select test.ok('H2: ผู้มีแค่ refundPartial โอนคะแนนไม่ได้ (ต้องมีสิทธิ์เปลี่ยนผู้ซื้อหรือแอดมิน)',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"earn","id":"t3","points":5,"reason":"x","orderId":"o_pay","transfer":true}]'::jsonb) $q$)->>'exception' = '42501');
select test.ok('H2: สิทธิ์หมุนที่อ้างออร์เดอร์ (ไม่ใช่การโอน) ผู้ที่ไม่ใช่แอดมินเพิ่มไม่ได้',
  test.rpc_as('77777777-7777-7777-7777-777777777777',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"spins","delta":1,"orderId":"o_pay"}]'::jsonb) $q$)->>'exception' = '42501');
select test.ok('H2: การตัดสิทธิ์หมุน (ค่าลบ) ยังทำได้ตามสิทธิ์เดิม',
  (test.rpc_as('77777777-7777-7777-7777-777777777777', $q$ select public.punpang_ledger_apply('c2', '[{"op":"spins","delta":-1}]'::jsonb) $q$)->>'ok')::boolean);

-- ===== H3 (รอบ 2026-11-15): คืนเงินซ้ำหลังใช้คะแนนไปแล้วต้องถูกปฏิเสธ =====
insert into public.punpang_customers (id, name, phone, data) values ('c4', 'Cust Four', '0844444444', '{"ledger":[],"spins":0}');
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('o_ref', 'OR-141126-000010', 'c4', 'delivered', 'pickup', 'line', '{"items":[{"unitPrice":1000,"qty":1}],"payments":[{"id":"pr1","status":"confirmed","amount":1000}],"adjustment":{"amount":0}}'),
  ('o_ref2', 'OR-141126-000011', 'c4', 'preparing', 'pickup', 'line', '{"items":[{"unitPrice":2000,"qty":1}],"payments":[],"adjustment":{"amount":0}}');
select test.ok('H3: คืนเงินเป็นคะแนนครั้งแรก 1,000 แต้ม (ชำระ 1,000 บาท) ได้',
  (test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c4', '[{"op":"earn","id":"e4a","points":1000,"reason":"คืนเงิน","orderId":"o_ref"}]'::jsonb) $q$)->>'ok')::boolean);
select test.ok('H3: ใช้คะแนนทั้งหมดเป็นส่วนลดของออร์เดอร์อื่นแล้ว',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_apply_points('o_ref2', 1000) $q$)->>'ok')::boolean);
select test.ok('H3: คืนเงินเป็นคะแนนซ้ำหลังใช้คะแนนไปแล้วต้องถูกปฏิเสธ (เพดานสะสมต่อออร์เดอร์)',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c4', '[{"op":"earn","id":"e4b","points":1000,"reason":"คืนเงิน","orderId":"o_ref"}]'::jsonb) $q$)->>'message' = 'cap_exceeded');
select test.ok('H3: คืนเงินให้ลูกค้าอีกคนจากออร์เดอร์ของ c4 ไม่ได้',
  test.rpc_as('44444444-4444-4444-4444-444444444444',
    $q$ select public.punpang_ledger_apply('c2', '[{"op":"earn","id":"e4c","points":10,"reason":"คืนเงิน","orderId":"o_ref"}]'::jsonb) $q$)->>'exception' = '42501');

-- ===== H2: ใช้คะแนนเป็นส่วนลด =====
select test.ok('H2: ใช้คะแนนเป็นส่วนลดเกินยอดออร์เดอร์ (900) ไม่ได้',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_apply_points('o_prep', 901) $q$)->>'error' = 'exceeds_total');
select test.ok('H2: ช่างเค้กใช้คะแนนไม่ได้',
  test.rpc_as('33333333-3333-3333-3333-333333333333', $q$ select public.punpang_apply_points('o_prep', 10) $q$)->>'exception' = '42501');
select test.ok('H2: ใช้คะแนนเท่ายอดออร์เดอร์ได้',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_apply_points('o_prep', 900) $q$)->>'ok')::boolean);

-- ===== T6: สถานะออร์เดอร์ =====
select test.ok('T6: ตั้งสถานะที่ไม่มีในระบบผ่าน punpang_set_status ไม่ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_set_status('o_prep', 'totally_bogus_status') $q$) like 'ERR:23514:%');
select test.ok('T6: เพิ่มออร์เดอร์ที่สถานะไม่รู้จักไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment) values ('o_bogus', 'OR-141126-000099', 'c1', 'totally_bogus_status', 'pickup') $q$) like 'ERR:%');
select test.ok('T6: ช่างเค้กเปลี่ยนเป็น "เตรียมสินค้าแล้ว" ผ่าน punpang_set_status ได้ตามเดิม',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ select public.punpang_set_status('o_prep', 'prepared') $q$) = 'OK');
alter table public.punpang_orders disable trigger punpang_orders_status_valid;
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data)
  values ('o_legacy', 'OR-141126-000098', 'c1', 'legacy_status', 'pickup', 'line', '{"items":[]}');
alter table public.punpang_orders enable trigger punpang_orders_status_valid;
select test.ok('T6: แถวเก่าที่สถานะแปลก แก้ฟิลด์อื่นได้ (ตรวจเฉพาะตอนสถานะเปลี่ยน)',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = data || '{"note":"x"}'::jsonb where id = 'o_legacy' $q$) = 'OK');

-- หมายเหตุ: คำสั่งที่แก้ข้อมูลต้องรันเป็นคำสั่งแยกก่อน แล้วค่อยตรวจผลในคำสั่งถัดไป (ฟังก์ชัน volatile ในคำสั่งเดียวกัน
--          มองไม่เห็นผลของตัวเองใน subquery เพราะใช้ snapshot ของคำสั่ง) · ใช้ \gset เก็บผลของการเรียกไว้ตรวจ

-- ===== T5: RPC ของผู้ไม่ล็อกอิน =====
select test.as_anon($q$ select public.punpang_record_pageview('9999-99-99'); select public.punpang_record_pageview('0001-01-01') $q$) as r \gset
select test.ok('T5: นับเข้าชมด้วยวันปลอมไม่ผิดพลาด แต่ไม่สร้างแถววันปลอม (ใช้วันของเซิร์ฟเวอร์ → 1 แถว)',
  :'r' = 'OK'
  and not exists (select 1 from public.punpang_kv where collection = 'pageViews' and id in ('9999-99-99', '0001-01-01'))
  and (select count(*) from public.punpang_kv where collection = 'pageViews') = 1);
select test.as_anon($q$ select public.punpang_record_pageview('not-a-date') $q$) as r \gset
select test.ok('T5: รูปแบบวันผิดไม่สร้างแถว',
  :'r' = 'OK' and (select count(*) from public.punpang_kv where collection = 'pageViews') = 1);
select test.as_anon($q$ select public.punpang_record_pageview('2026-01-01') $q$) as r \gset
select test.ok('T5: นับซ้ำในวันเดียวกัน = แถวเดิม เพิ่มจำนวน (วันปลอม 2 ครั้ง + วันที่ถูกต้อง 1 ครั้ง = 3)',
  :'r' = 'OK' and (select count(*) from public.punpang_kv where collection = 'pageViews') = 1
  and (select (data->>'n')::int from public.punpang_kv where collection = 'pageViews') = 3);

insert into public.punpang_cake_clicks (v, photo_id, at)
  select 'visitor_' || lpad(g::text, 6, '0'), 'p1', now() - interval '100 days' from generate_series(1, 50000) g;
analyze public.punpang_cake_clicks;
select test.as_anon($q$ select public.punpang_record_click('photo1', 'visitor_new_001') $q$) as r \gset
select test.ok('D5: ตารางคลิกเต็ม 50,000 แถว (เก่ากว่า 90 วัน) → ลบของเก่าแล้วบันทึกต่อได้',
  :'r' = 'OK'
  and (select count(*) from public.punpang_cake_clicks) = 1
  and exists (select 1 from public.punpang_cake_clicks where v = 'visitor_new_001' and photo_id = 'photo1'));
insert into public.punpang_cake_clicks (v, photo_id, at)
  select 'visitor_' || lpad(g::text, 6, '0'), 'p1', now() from generate_series(1, 49999) g;
analyze public.punpang_cake_clicks;
select test.as_anon($q$ select public.punpang_record_click('photo2', 'visitor_new_002') $q$) as r \gset
select test.ok('D5: ตารางเต็มด้วยแถวใหม่ (ยังไม่ครบ 90 วัน) → ไม่เพิ่มเกินเพดาน',
  :'r' = 'OK' and (select count(*) from public.punpang_cake_clicks) = 50000
  and not exists (select 1 from public.punpang_cake_clicks where v = 'visitor_new_002'));

select test.ok('T9: ผู้ไม่ล็อกอินเรียก punpang_order_search ไม่ได้',
  test.as_anon($q$ select * from public.punpang_order_search('x') $q$) like 'ERR:42501:%');

-- ===== T8: สลิปในบักเก็ตเดิม =====
insert into storage.objects (bucket_id, name) values ('punpang-slips', 'o9/evidence.png');
select test.as_staff('66666666-6666-6666-6666-666666666666', $q$ delete from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/evidence.png' $q$) as r \gset
select test.ok('T8: ผู้มีแค่ reportPayment ลบสลิปของคนอื่นไม่ได้ (ไม่ผิดพลาด แต่ไม่มีแถวถูกลบ)',
  :'r' = 'OK' and exists (select 1 from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/evidence.png'));
select test.as_staff('66666666-6666-6666-6666-666666666666', $q$ update storage.objects set name = 'o9/hacked.png' where bucket_id = 'punpang-slips' and name = 'o9/evidence.png' $q$) as r \gset
select test.ok('T8: ผู้มีแค่ reportPayment เขียนทับสลิปไม่ได้',
  :'r' = 'OK' and exists (select 1 from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/evidence.png')
  and not exists (select 1 from storage.objects where name = 'o9/hacked.png'));
select test.as_staff('66666666-6666-6666-6666-666666666666', $q$ insert into storage.objects (bucket_id, name) values ('punpang-slips', 'o9/new.png') $q$) as r \gset
select test.ok('T8: ผู้แจ้งชำระเพิ่มสลิปได้ตามเดิม',
  :'r' = 'OK' and exists (select 1 from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/new.png'));
select test.as_staff('55555555-5555-5555-5555-555555555555', $q$ delete from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/evidence.png' $q$) as r \gset
select test.ok('T8: ผู้ยืนยันชำระ (admin) ลบสลิปได้',
  :'r' = 'OK' and not exists (select 1 from storage.objects where bucket_id = 'punpang-slips' and name = 'o9/evidence.png'));

-- ===== N1: แชทเว็บ/แอป + trigger แจ้งเตือน =====
insert into public.punpang_chats (id, channel, external_id, customer_id, data)
  values ('chweb1', 'web', 'c1', 'c1', '{"messages":[{"id":"m1","from":"customer","text":"hi","at":"2026-11-14T10:00:00Z"}]}');
select test.ok('N1: สร้างกระทู้แชท channel = web ได้ (ก่อนแก้ ล้มด้วย check constraint)',
  exists (select 1 from public.punpang_chats where id = 'chweb1' and channel = 'web'));
select test.ok('N1: ลูกค้าส่งข้อความ ไม่ยิงแจ้งเตือน', (select count(*) from test.net_calls) = 0);
update public.punpang_chats set data = jsonb_set(data, '{messages}', data->'messages' || '[{"id":"m2","from":"staff","text":"reply","at":"2026-11-14T10:01:00Z"}]'::jsonb) where id = 'chweb1';
select test.ok('N1: พนักงานตอบ → ยิง push-send หนึ่งครั้งพร้อม chatId',
  (select count(*) from test.net_calls) = 1
  and (select body->>'chatId' from test.net_calls order by id limit 1) = 'chweb1'
  and (select url from test.net_calls order by id limit 1) like '%/push-send');
update public.punpang_chats set data = jsonb_set(data, '{unreadStaff}', '0') where id = 'chweb1';
select test.ok('N1: แก้ฟิลด์อื่นของกระทู้ ไม่ยิงซ้ำ', (select count(*) from test.net_calls) = 1);
insert into public.punpang_chats (id, channel, external_id, customer_id, data)
  values ('chfb1', 'facebook', '1234567', 'c1', '{"messages":[{"id":"m1","from":"staff","text":"x","at":"2026-11-14T10:00:00Z"}]}');
select test.ok('N1: ข้อความพนักงานในแชท Facebook ไม่ยิง push ของลูกค้า', (select count(*) from test.net_calls) = 1);

-- ===== D9: แจ้งเตือนล้มเหลวต้องไม่ทำให้การบันทึกข้อมูลหลักล้ม =====
set test.net_fail = 'on';
update public.punpang_chats set data = jsonb_set(data, '{messages}', data->'messages' || '[{"id":"m3","from":"staff","text":"reply2","at":"2026-11-14T10:02:00Z"}]'::jsonb) where id = 'chweb1';
select test.ok('D9: pg_net ล้มเหลว → บันทึกข้อความตอบของพนักงานยังสำเร็จ',
  (select jsonb_array_length(data->'messages') from public.punpang_chats where id = 'chweb1') = 3
  and (select count(*) from test.net_calls) = 1);
insert into public.punpang_records (collection, id, data) values ('bell', 'bl_fail', '{"audience":"staff","event":"team_new_order","text":"x"}');
select test.ok('D9: pg_net ล้มเหลว → เพิ่มกระดิ่งพนักงานยังสำเร็จ',
  exists (select 1 from public.punpang_records where id = 'bl_fail') and (select count(*) from test.net_calls) = 1);
reset test.net_fail;
insert into public.punpang_records (collection, id, data) values ('bell', 'bl_ok', '{"audience":"staff","event":"team_new_order","text":"x"}');
select test.ok('D9: กระดิ่งพนักงานประเภทที่ต้องแจ้ง → ยิง push-send พร้อม recordId',
  (select count(*) from test.net_calls) = 2
  and (select body->>'recordId' from test.net_calls order by id desc limit 1) = 'bl_ok');
insert into public.punpang_records (collection, id, data) values ('bell', 'bl_other', '{"audience":"staff","event":"some_other_event","text":"x"}');
select test.ok('D9: กระดิ่งประเภทอื่นไม่ยิง push', (select count(*) from test.net_calls) = 2);


-- ===== D2 (รอบ 2026-11-15): ราคา/ยอดของออร์เดอร์แก้ได้เฉพาะผู้มีสิทธิ์ (ผ่าน PostgREST) =====
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('o_draft', 'OR-141126-000020', 'c1', 'draft', 'pickup', 'line', '{"items":[{"id":"it1","unitPrice":300,"qty":1}],"payments":[],"adjustment":{"amount":0}}');
select test.ok('D2: ช่างเค้กแก้ราคาในออร์เดอร์ไม่ได้',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ update public.punpang_orders set data = jsonb_set(data, '{items,0,unitPrice}', '1') where id = 'o_prep' $q$) like 'ERR:42501:%');
select test.ok('D2: ช่างเค้กบันทึกรูปงานในออร์เดอร์ได้ (ไม่เปลี่ยนยอด)',
  test.as_staff('33333333-3333-3333-3333-333333333333', $q$ update public.punpang_orders set data = jsonb_set(data, '{items,0,workPhotos}', '[]'::jsonb) where id = 'o_prep' $q$) = 'OK');
select test.ok('D2: พนักงานขายแก้ราคาออร์เดอร์ที่กำลังเตรียมไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set data = jsonb_set(data, '{items,0,unitPrice}', '1') where id = 'o_prep' $q$) like 'ERR:42501:%');
select test.ok('D2: พนักงานขายแก้ราคาในออร์เดอร์ร่างได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set data = jsonb_set(data, '{items,0,unitPrice}', '250') where id = 'o_draft' $q$) = 'OK');
select test.ok('D2: พนักงานขายแก้ส่วนลด (adjustment) ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set data = jsonb_set(data, '{adjustment}', '{"amount":-100,"reason":"x"}') where id = 'o_draft' $q$) like 'ERR:42501:%');
select test.ok('D2: พนักงานขายแก้จำนวนเงินของงวดที่ยืนยันแล้วไม่ได้ (เห็นออร์เดอร์นี้ได้ แต่ไม่มีสิทธิ์ยืนยันชำระ)',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set data = jsonb_set(data, '{payments,0,amount}', '1') where id = 'o_del' $q$) like 'ERR:42501:%');
select test.ok('D2: พนักงานขายเปลี่ยนผู้ซื้อไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set customer_id = 'c2' where id = 'o_draft' $q$) like 'ERR:42501:%');
select test.ok('D2: ตั้งคะแนนที่ใช้ในออร์เดอร์โดยตรงไม่ได้ (ต้องผ่านเซิร์ฟเวอร์)',
  test.as_staff('11111111-1111-1111-1111-111111111111', $q$ update public.punpang_orders set data = jsonb_set(data, '{pointsUsed}', '{"points":500,"amount":500,"entryId":"fake"}') where id = 'o_draft' $q$) like 'ERR:42501:%');
select test.ok('D2: ผู้จัดการแก้ส่วนลดได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$ update public.punpang_orders set data = jsonb_set(data, '{adjustment}', '{"amount":-10,"reason":"x"}') where id = 'o_draft' $q$) = 'OK');

-- ===== E1 (รอบ 2026-11-15): สิทธิ์ของผู้ไม่ล็อกอินและตารางที่ใช้ภายใน =====
select test.ok('E1: ผู้ไม่ล็อกอินอ่านตารางคลิกไม่ได้', test.as_anon($q$ select count(*) from public.punpang_cake_clicks $q$) like 'ERR:42501:%');
select test.ok('E1: ผู้ไม่ล็อกอินเพิ่มอุปกรณ์ push ไม่ได้', test.as_anon($q$ insert into public.punpang_push_devices (token, staff_id) values ('x', '11111111-1111-1111-1111-111111111111') $q$) like 'ERR:42501:%');
select test.ok('E1: ผู้ไม่ล็อกอินลงทะเบียน push ไม่ได้', test.as_anon($q$ select public.punpang_register_push_token('x') $q$) like 'ERR:42501:%');
select test.ok('E1: ผู้ไม่ล็อกอินอ่านสินค้าที่เปิดขายได้ตามเดิม', test.as_anon($q$ select count(*) from public.punpang_items $q$) = 'OK');
select test.ok('E1: ผู้ไม่ล็อกอินนับคลิกรูปแนะนำได้ตามเดิม', test.as_anon($q$ select public.punpang_click_pairs() $q$) = 'OK');
select test.ok('E1: ผู้ไม่ล็อกอินอ่านตารางยอดที่ออกจากออร์เดอร์ไม่ได้', test.as_anon($q$ select count(*) from public.punpang_order_issued $q$) like 'ERR:42501:%');
select test.ok('E1: พนักงานที่ล็อกอินแล้วอ่านตารางยอดที่ออกจากออร์เดอร์ตรง ๆ ไม่ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555', $q$ select 1 from public.punpang_order_issued $q$) like 'ERR:42501:%');

-- ===== D9 (รอบ 2026-11-15): คำขอ push ต้องแนบคีย์จาก Vault =====
select test.ok('D9: คำขอ push แนบคีย์ x-push-key จาก Vault',
  (select headers->>'x-push-key' from test.net_calls order by id desc limit 1) = 'test-push-key');

-- ===== C1 (รอบ 2026-11-15): ส่วนลดคูปองต้องตรงกับคูปองที่จองไว้กับออร์เดอร์ที่เซิร์ฟเวอร์ =====
insert into public.punpang_records (collection, id, data) values
  ('coupons', 'cpA', '{"type":"discount","status":"used","orderId":"o_pay","customerId":"c1","amount":100,"name":"คูปอง 100"}'),
  ('coupons', 'cpB', '{"type":"discount","status":"pending","customerId":"c1","amount":100,"name":"ยังไม่จอง"}'),
  ('coupons', 'cpC', '{"type":"discount","status":"used","orderId":"o_other","customerId":"c1","amount":100,"name":"จองให้ออร์เดอร์อื่น"}'),
  ('coupons', 'cpD', '{"type":"discount","status":"used","orderId":"pos-pending","customerId":"c1","amount":50,"name":"จองหน้าร้าน"}'),
  ('coupons', 'cpE', '{"type":"discount","status":"used","orderId":"o_draft","customerId":"c2","amount":100,"name":"ของลูกค้าอีกคน"}'),
  ('coupons', 'cpF', '{"type":"discount","status":"used","orderId":"o_draft","customerId":"c1","amount":100,"name":"คูปอง 100"}'),
  ('coupons', 'cpM', '{"type":"discount","status":"used","orderId":"o_draft","customerId":"c1","amount":50,"minSpend":10000,"name":"ขั้นต่ำ 10,000"}');
select test.ok('C1: ส่วนลดจากคูปองที่ไม่มีอยู่จริงเพิ่มไม่ได้ (เคสเดิม 400 บาท)',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"ไม่มีคูปองนี้","name":"ส่วนลดพิเศษ","amount":400}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: คูปองที่ยังไม่ได้จองกับออร์เดอร์ใส่ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpB","name":"ยังไม่จอง","amount":100}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: คูปองที่จองให้ออร์เดอร์อื่นใส่ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpC","name":"จองให้ออร์เดอร์อื่น","amount":100}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: คูปองของลูกค้าอีกคนใส่ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpE","name":"ของลูกค้าอีกคน","amount":100}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: ส่วนลดเกินมูลค่าคูปอง (คูปอง 100 บาท ใส่ 150) ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpF","name":"คูปอง 100","amount":150}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: ยอดสินค้าไม่ถึงขั้นต่ำของคูปองใส่ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpM","name":"ขั้นต่ำ","amount":50}]'::jsonb) where id = 'o_draft' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: คูปองที่จองไว้กับออร์เดอร์นี้และไม่เกินมูลค่า ใช้ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cpF","name":"คูปอง 100","amount":100}]'::jsonb) where id = 'o_draft' $q$) = 'OK');
select test.ok('C1: ลบคูปองออกจากออร์เดอร์ทำได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[]'::jsonb) where id = 'o_draft' $q$) = 'OK');
select test.ok('C1: ผู้จัดการใส่ส่วนลดเองได้ (ผู้จัดการผ่านทุกข้อ)',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"ไม่มีคูปองนี้","name":"แอดมิน","amount":400}]'::jsonb) where id = 'o_draft' $q$) = 'OK');
select test.ok('C1: สร้างออร์เดอร์หน้าร้านที่ใช้คูปองซึ่งจองด้วยรหัสชั่วคราว (pos-pending) ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_pos1', 'OR-POS-1', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"p1","unitPrice":500,"qty":1}],"payments":[],"couponsUsed":[{"couponId":"cpD","name":"จองหน้าร้าน","amount":50}]}') $q$) = 'OK');
select test.ok('C1: สร้างออร์เดอร์ออนไลน์ด้วยคูปอง pos-pending ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_pos2', 'OR-POS-2', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"p2","unitPrice":500,"qty":1}],"payments":[],"couponsUsed":[{"couponId":"cpD","name":"จองหน้าร้าน","amount":50}]}') $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('C1: สร้างออร์เดอร์โดยใส่คูปองปลอมไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_pos3', 'OR-POS-3', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"p3","unitPrice":500,"qty":1}],"payments":[],"couponsUsed":[{"couponId":"ไม่มีคูปองนี้","name":"ปลอม","amount":400}]}') $q$) like 'ERR:42501:coupon is not claimed%');

-- ===== C2 (รอบ 2026-11-15): ตอนสร้างออร์เดอร์ ห้ามตั้งคะแนนที่ใช้หรือส่วนลดเอง =====
insert into auth.users (id, email) values ('88888888-8888-8888-8888-888888888888', 'pricer@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values ('88888888-8888-8888-8888-888888888888', 'Pricer', 'sales', '{adjustPrice,createOrder,viewAllOrders}');
select test.ok('C2: สร้างออร์เดอร์ที่ตั้งคะแนนที่ใช้เองไม่ได้ (เคส 500 แต้มปลอม)',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2a', 'OR-C2-1', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"q1","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":{"points":500,"amount":500,"entryId":"fake"}}') $q$) like 'ERR:42501:points can only be applied%');
select test.ok('C2: สร้างออร์เดอร์ที่ตั้งส่วนลดเองไม่ได้ (ไม่มีสิทธิ์ปรับราคา)',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2b', 'OR-C2-2', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"q2","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":-400,"reason":"x"},"pointsUsed":null}') $q$) like 'ERR:42501:no permission to set a discount%');
select test.ok('C2: สร้างออร์เดอร์ใหม่ที่ส่วนลดเป็นศูนย์และคะแนนว่างได้ (ค่าเริ่มต้นของแอป)',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2c', 'OR-C2-3', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"q3","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null}') $q$) = 'OK');
select test.ok('C2: บิลหน้าร้านที่ไม่มีสิทธิ์ปรับราคาให้ส่วนลดไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2d', 'OR-C2-4', 'c1', 'payment_confirmed', 'pickup', 'pos', '{"items":[{"id":"q4","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":-50,"reason":"ส่วนลดหน้าร้าน"},"pointsUsed":null}') $q$) like 'ERR:42501:no permission to set a discount%');
select test.ok('C2: ผู้ที่มีสิทธิ์ปรับราคาสร้างออร์เดอร์ที่มีส่วนลดได้ (ไม่ใช่ผู้จัดการ)',
  test.as_staff('88888888-8888-8888-8888-888888888888',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2e', 'OR-C2-5', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"q5","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":-50,"reason":"ตกลงกับลูกค้า"},"pointsUsed":null}') $q$) = 'OK');
select test.ok('C2: ผู้จัดการสร้างออร์เดอร์ที่มีส่วนลดและคะแนนที่ใช้ได้ (ผู้จัดการผ่านทุกข้อ)',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_c2f', 'OR-C2-6', 'c1', 'awaiting_payment', 'pickup', 'line', '{"items":[{"id":"q6","unitPrice":500,"qty":1}],"payments":[],"adjustment":{"amount":-50,"reason":"แอดมิน"},"pointsUsed":{"points":10,"amount":10,"entryId":"x"}}') $q$) = 'OK');

-- ===== C3 (รอบ 2026-11-15): ราคาในใบเสนอที่ส่งแล้วคือราคาที่ตกลง (ล็อก) =====
insert into auth.users (id, email) values ('99999999-9999-9999-9999-999999999999', 'chat@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values ('99999999-9999-9999-9999-999999999999', 'Chat', 'sales', '{chat,createOrder,viewAllOrders}');
insert into public.punpang_quotes (id, code, chat_id, customer_id, status, order_id, data) values
  ('qt1', 'QT-C3-1', 'chq1', 'c1', 'customer_ok', null, '{"createdAt":"2026-11-14T10:00:00Z","respondedAt":null,"note":"","payload":{"customerId":"c1","pickupAt":"2099-01-01T10:00:00.000Z","fulfillment":"pickup","items":[{"id":"qi1","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0}}'),
  ('qt2', 'QT-C3-2', 'chq2', 'c2', 'customer_ok', null, '{"createdAt":"2026-11-14T10:00:00Z","respondedAt":null,"note":"","payload":{"customerId":"c2","pickupAt":"2099-01-01T10:00:00.000Z","fulfillment":"pickup","items":[{"id":"qi2","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0}}'),
  ('qt3', 'QT-C3-3', 'chq3', 'c1', 'customer_ok', null, '{"createdAt":"2026-11-14T10:00:00Z","respondedAt":null,"note":"","payload":{"customerId":"c1","pickupAt":"2099-01-01T10:00:00.000Z","fulfillment":"pickup","items":[{"id":"qi3","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0}}'),
  ('qt4', 'QT-C3-4', 'chq4', 'c1', 'pending', null, '{"createdAt":"2026-11-14T10:00:00Z","respondedAt":null,"note":"","payload":{"customerId":"c1","pickupAt":"2099-01-01T10:00:00.000Z","fulfillment":"pickup","items":[{"id":"qi4","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0}}');
select test.ok('C3: แก้ราคาในใบเสนอที่บันทึกแล้วไม่ได้ แม้มีสิทธิ์แชท',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ update public.punpang_quotes set data = jsonb_set(data, '{payload,items,0,unitPrice}', '1') where id = 'qt1' $q$) like 'ERR:42501:quote terms are locked%');
select test.ok('C3: เปลี่ยนสถานะใบเสนอได้ตามปกติ',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ update public.punpang_quotes set status = 'converting' where id = 'qt1' $q$) = 'OK');
select test.ok('C3: ออร์เดอร์จากใบเสนอที่รายการ VAT และค่าส่งตรงกับที่ลูกค้าเห็น สร้างได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q1', 'OR-Q-1', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt1","items":[{"id":"qi1","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) = 'OK');
select test.ok('C3: ผูกใบเสนอกับออร์เดอร์ที่สร้างแล้ว',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ update public.punpang_quotes set order_id = 'o_q1' where id = 'qt1' $q$) = 'OK');
select test.ok('C3: ใบเสนอเดียวกันแปลงเป็นออร์เดอร์ซ้ำไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q2', 'OR-Q-2', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt1","items":[{"id":"qi1","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:quote already converted%');
select test.ok('C3: ใบเสนอของลูกค้าอีกคนแปลงให้ลูกค้าคนนี้ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q3', 'OR-Q-3', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt2","items":[{"id":"qi2","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:quote customer mismatch%');
select test.ok('C3: ตั้งราคาในออร์เดอร์ต่างจากใบเสนอ (เคส 1 บาท) สร้างไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q4', 'OR-Q-4', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt3","items":[{"id":"qi3","unitPrice":1,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:order items differ%');
select test.ok('C3: VAT ในออร์เดอร์ต่างจากใบเสนอ สร้างไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q5', 'OR-Q-5', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt3","items":[{"id":"qi3","unitPrice":500,"qty":1}],"vat":{"rate":7,"mode":"exclusive"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:order VAT differs%');
select test.ok('C3: ใบเสนอที่ลูกค้ายังไม่ยืนยัน แปลงเป็นออร์เดอร์ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q6', 'OR-Q-6', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"qt4","items":[{"id":"qi4","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:quote is not ready%');
select test.ok('C3: อ้างใบเสนอที่ไม่มีอยู่ในระบบไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values ('o_q7', 'OR-Q-7', 'c1', 'awaiting_payment', 'pickup', 'line', '{"quoteId":"no_such","items":[{"id":"qi5","unitPrice":500,"qty":1}],"vat":{"rate":0,"mode":"none"},"shippingFee":0,"payments":[],"adjustment":{"amount":0,"reason":""},"pointsUsed":null,"couponsUsed":[]}') $q$) like 'ERR:42501:quote not found%');
select test.ok('C3: เปลี่ยนลูกค้าของใบเสนอไม่ได้',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ update public.punpang_quotes set customer_id = 'c2' where id = 'qt3' $q$) like 'ERR:42501:quote customer or chat cannot%');

-- C4) ใบเสนอใหม่สร้างได้ทางเซิร์ฟเวอร์เท่านั้น (quote-create คิดราคาจากแคตาล็อก) · พนักงานที่มีสิทธิ์แชทก็ INSERT ตรง ๆ ไม่ได้
select test.ok('C4: พนักงานสร้างแถวใบเสนอตรง ๆ ไม่ได้ (ต้องผ่าน quote-create)',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ insert into public.punpang_quotes (id, code, chat_id, customer_id, status, data) values ('qt_direct', 'QT-DIRECT-1', 'ch1', 'c1', 'pending', '{"payload":{"items":[]}}') $q$) like 'ERR:42501:%');
-- C4) แก้สถานะของใบเสนอที่มีอยู่แล้วยังได้ (ตามสิทธิ์แชท และการล็อกราคาไม่กระทบสถานะ)
select test.ok('C4: พนักงานที่มีสิทธิ์แชทยังแก้สถานะใบเสนอที่มีอยู่ได้',
  test.as_staff('99999999-9999-9999-9999-999999999999',
    $q$ update public.punpang_quotes set status = status where id = 'qt3' $q$) = 'OK');
select 'ผ่านทั้งหมด' as security_tests;
