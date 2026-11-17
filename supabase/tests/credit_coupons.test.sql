-- ทดสอบคูปองคืนเงิน (mode = credit) การจองตามยอดแบบอะตอมิก การแปลงคะแนนเป็นคูปอง และการยกเลิกคะแนนค้างของออร์เดอร์เดิม
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok และ test.rpc_as จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น cc_
-- ผู้ใช้: 1111… = พนักงานขาย (pos, useLoyalty, ไม่มี adjustPoints) · 5555… = แอดมิน (adjustPoints) · 3333… = ช่าง (ไม่มีสิทธิ์ POS/ออร์เดอร์)
-- กติกาการเขียน: การเรียกที่เปลี่ยนข้อมูล (rpc) กับการอ่านผลต้องอยู่คนละคำสั่ง เพราะ subquery ที่ไม่ผูกกับแถวนอกถูกประเมินก่อนได้
-- ทำในธุรกรรมที่ย้อนกลับ ไม่ทิ้งข้อมูลให้ไฟล์ถัดไป · "สองเครื่องพร้อมกัน" ตรวจแบบเรียงลำดับเท่านั้น (การแย่งล็อกจริงอยู่นอกขอบเขตไฟล์นี้)

begin;

insert into public.punpang_records (collection, id, data) values
  ('coupons', 'cc_cr', '{"type":"discount","mode":"credit","name":"คูปองคืนเงินทดสอบ","amount":500,"balance":500,"holds":{},"status":"pending","customerId":"cc_c1","expiresAt":null}'),
  ('coupons', 'cc_old', '{"type":"discount","mode":"credit","name":"คูปองหมดอายุ","amount":100,"balance":100,"holds":{},"status":"pending","customerId":"cc_c1","expiresAt":"2000-01-01"}'),
  ('coupons', 'cc_fx', '{"type":"discount","mode":"fixed","name":"ลด 100","amount":100,"minSpend":0,"status":"used","orderId":"cc_o9","customerId":"cc_c1"}');

insert into public.punpang_customers (id, name, data) values
  ('cc_c1', 'ลูกค้าคูปอง', '{"ledger":[
     {"id":"cl1","delta":100,"remaining":40,"expiresAt":"2099-01-01","reason":"ซื้อ"},
     {"id":"cl2","delta":60,"remaining":60,"expiresAt":"2000-01-01","reason":"หมดอายุแล้ว"},
     {"id":"cl3","delta":50,"remaining":25,"expiresAt":"2099-06-01","reason":"ซื้อ"}]}'),
  ('cc_c2', 'ลูกค้าไม่มีคะแนน', '{"ledger":[]}'),
  ('cc_c3', 'ลูกค้าคะแนนค้างในออร์เดอร์', '{"ledger":[
     {"id":"cl9","delta":100,"remaining":60,"expiresAt":"2099-01-01","reason":"ซื้อ"},
     {"id":"cs9","delta":-40,"reason":"ใช้คะแนนลดราคา","orderId":"cc_leg","takes":[{"lotId":"cl9","n":40}]}]}');

-- ออร์เดอร์เดิมที่ใช้คะแนนลดราคาไว้ก่อนถอดฟีเจอร์ (ยังไม่ส่งมอบ)
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('cc_leg', 'OR-CC-1', 'cc_c3', 'draft', 'pickup', 'web', '{"items":[{"retailId":"cup","unitPrice":100,"qty":1,"name":"คัพเค้ก"}],"payments":[],"adjustment":{"amount":0},"pointsUsed":{"points":40,"amount":40,"entryId":"cs9"}}');

-- ---------- 1) จองยอดคูปองคืนเงิน: สิทธิ์ ยอดคงเหลือ และการจองซ้ำ ----------
select test.ok('C1: ช่างที่ไม่มีสิทธิ์ POS/ออร์เดอร์จองยอดคูปองคืนเงินไม่ได้ (42501)',
  (test.rpc_as('33333333-3333-3333-3333-333333333333', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bA', 300)) $q$))->>'exception' = '42501');

select test.ok('C2: พนักงานขาย (POS) จองยอด 300 ให้บิล A ได้',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bA', 300)) $q$) = '"ok"'::jsonb);
select test.ok('C2: หลังจองยอดคงเหลือเหลือ 200 และบันทึกยอดจองของบิล A = 300',
  (select (data->>'balance')::numeric = 200 and (data->'holds'->>'cc_bA')::numeric = 300 from public.punpang_records where collection = 'coupons' and id = 'cc_cr'));

select test.ok('C3: เครื่องที่ 2 จองบิล B ด้วย 300 (เกินยอดคงเหลือ 200) → insufficient',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bB', 300)) $q$) = '"insufficient"'::jsonb);
select test.ok('C3: หลัง insufficient ยอดคงเหลือยังเป็น 200 และไม่มียอดจองของบิล B',
  (select (data->>'balance')::numeric = 200 and not ((data->'holds') ? 'cc_bB') from public.punpang_records where collection = 'coupons' and id = 'cc_cr'));

select test.ok('C4: เครื่องที่ 2 ลองใหม่ด้วยยอดที่เหลือ 200 → ok',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bB', 200)) $q$) = '"ok"'::jsonb);
select test.ok('C4: หลังจองครบ คูปองเป็น used และยอดเป็น 0',
  (select data->>'status' = 'used' and (data->>'balance')::numeric = 0 from public.punpang_records where collection = 'coupons' and id = 'cc_cr'));

select test.ok('C5: จองซ้ำบิลเดิมด้วยยอดเท่าเดิม = ok (ลองใหม่ได้) แต่ยอดต่าง = invalid',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bB', 200)) $q$) = '"ok"'::jsonb
  and test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_cr', 'cc_bB', 100)) $q$) = '"invalid"'::jsonb);

select test.ok('C6: คูปองหมดอายุจองไม่ได้ (expired) และคูปองที่ไม่มีอยู่ตอบ missing',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_old', 'cc_bC', 50)) $q$) = '"expired"'::jsonb
  and test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_nope', 'cc_bC', 50)) $q$) = '"missing"'::jsonb);

select test.ok('C7: คูปองแบบเดิมจองด้วยฟังก์ชันคืนเงินไม่ได้ (invalid)',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_hold_credit('cc_fx', 'cc_bC', 10)) $q$) = '"invalid"'::jsonb);
select test.ok('C7: คูปองคืนเงินจองผ่าน punpang_claim_coupon ไม่ได้ (invalid)',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_claim_coupon('cc_cr', 'cc_bC')) $q$) = '"invalid"'::jsonb);
select test.ok('C7: การเรียกที่ถูกปฏิเสธไม่ทิ้งยอดจองไว้ (ไม่มียอดจองของบิล C)',
  (select not ((data->'holds') ? 'cc_bC') from public.punpang_records where collection = 'coupons' and id = 'cc_cr'));

-- ---------- 2) ปล่อยการจอง และตรวจรายการในบิล ----------
select test.ok('C8: ปล่อยการจองของบิล A ได้ (true)',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_release_coupon('cc_cr', 'cc_bA')) $q$) = 'true'::jsonb);
select test.ok('C8: ยอดคืนเข้าคูปอง 300 และสถานะกลับเป็น pending เพราะยังมียอด',
  (select (data->>'balance')::numeric = 300 and data->>'status' = 'pending' from public.punpang_records where collection = 'coupons' and id = 'cc_cr'));
select test.ok('C8: ปล่อยซ้ำไม่มีผล (false)',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_release_coupon('cc_cr', 'cc_bA')) $q$) = 'false'::jsonb);

select test.ok('C9: รายการในบิล B ที่จองไว้ 200 ผ่านด้วย 200 แต่ไม่ผ่านที่ 201 หรือบิลที่ไม่ได้จอง',
  public.punpang__coupon_entry_ok('cc_bB', 'pos', 'cc_c1', '{"items":[{"unitPrice":300,"qty":1,"retailId":"a"}]}'::jsonb, '{"couponId":"cc_cr","amount":200}')
  and not public.punpang__coupon_entry_ok('cc_bB', 'pos', 'cc_c1', '{"items":[{"unitPrice":300,"qty":1,"retailId":"a"}]}'::jsonb, '{"couponId":"cc_cr","amount":201}')
  and not public.punpang__coupon_entry_ok('cc_bZ', 'pos', 'cc_c1', '{"items":[{"unitPrice":300,"qty":1,"retailId":"a"}]}'::jsonb, '{"couponId":"cc_cr","amount":10}'));

-- ---------- 3) แปลงคะแนนเป็นคูปอง ----------
select test.ok('C10: พนักงานขายแปลงคะแนนไม่ได้ (42501)',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_convert_points_to_coupon('cc_c1') $q$))->>'exception' = '42501');
select test.ok('C10: สมุดคะแนนไม่เปลี่ยนหลังถูกปฏิเสธ (คะแนนที่ใช้ได้ยังเป็น 125)',
  (select sum((e->>'remaining')::int) = 125 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'cc_c1' and (e->>'delta')::int > 0));

select test.ok('C11: แอดมินแปลงได้ 65 คะแนน (เฉพาะก้อนที่ยังไม่หมดอายุ 40 + 25)',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_convert_points_to_coupon('cc_c1') $q$))->>'points' = '65');
select test.ok('C11: คูปองที่ได้เป็นแบบยอดคงที่ 65 ใช้ครั้งเดียว มีสถานะ pending และ source = convert',
  (select data->>'mode' = 'fixed' and (data->>'amount')::numeric = 65 and data->>'status' = 'pending' and data->>'source' = 'convert'
     from public.punpang_records where collection = 'coupons' and data->>'source' = 'convert' and data->>'customerId' = 'cc_c1'));
select test.ok('C12: คูปองแปลงคะแนนหมดอายุ 30 วันนับจากวันทำการของระบบ',
  (select data->>'expiresAt' = to_char(public.punpang__pts_today()::date + 30, 'YYYY-MM-DD') from public.punpang_records where collection = 'coupons' and data->>'source' = 'convert' and data->>'customerId' = 'cc_c1'));
select test.ok('C12: หลังแปลง คะแนนที่ใช้ได้เหลือ 0',
  (select coalesce(sum((e->>'remaining')::int), 0) = 0 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'cc_c1' and (e->>'delta')::int > 0 and (e->>'expiresAt') >= public.punpang__pts_today()));
select test.ok('C13: แปลงซ้ำเมื่อไม่มีคะแนนแล้ว → no_points · ลูกค้าไม่มีคะแนน → no_points · ไม่พบลูกค้า → no_customer',
  test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_convert_points_to_coupon('cc_c1') $q$)->>'error' = 'no_points'
  and test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_convert_points_to_coupon('cc_c2') $q$)->>'error' = 'no_points'
  and test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_convert_points_to_coupon('cc_nobody') $q$)->>'error' = 'no_customer');
select test.ok('C14: RPC ใช้คะแนนลดราคาเดิมถูกปิดแล้ว (retired)',
  test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_apply_points('cc_leg', 10) $q$)->>'error' = 'retired');
select test.ok('C14: RPC ที่ปิดแล้วไม่ตัดคะแนนของลูกค้า (ยังเหลือ 60)',
  (select sum((e->>'remaining')::int) = 60 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'cc_c3' and (e->>'delta')::int > 0));

-- ---------- 4) ออร์เดอร์เดิมที่ใช้คะแนนค้างยังยกเลิกการใช้คะแนนได้ ----------
select test.ok('C15: พนักงานขาย (มี useLoyalty) ยกเลิกการใช้คะแนนของออร์เดอร์เดิมได้ (ok)',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_remove_points('cc_leg') $q$))->>'ok' = 'true');
select test.ok('C15: คืนคะแนน 40 เข้าก้อนเดิม (cl9 เหลือ 100)',
  (select (e->>'remaining')::int = 100 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'cc_c3' and e->>'id' = 'cl9'));
select test.ok('C15: ล้าง pointsUsed ของออร์เดอร์เดิม',
  (select data->'pointsUsed' = 'null'::jsonb from public.punpang_orders where id = 'cc_leg'));

rollback;
