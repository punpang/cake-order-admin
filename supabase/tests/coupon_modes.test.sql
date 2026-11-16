-- ทดสอบคูปองซื้อครบ/ซื้อสินค้า (ส่วนลด %) ที่เซิร์ฟเวอร์ และการแลกของที่คัดลอกฟิลด์คูปองไปยังแถวคูปองของลูกค้า
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok และ test.as_staff จากไฟล์นั้น)
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น cm_ และ o_cm · การแลกของทดสอบทำในธุรกรรมที่ย้อนกลับ ไม่ทิ้งข้อมูลให้ lucky.test.sql

-- คูปองของลูกค้า c1 ที่จองไว้กับออร์เดอร์ o_cm แล้ว
insert into public.punpang_records (collection, id, data) values
  ('coupons', 'cm_spend', '{"type":"discount","status":"used","orderId":"o_cm","customerId":"c1","name":"ซื้อครบ 500","mode":"spend","pct":10,"cap":100,"amount":100,"minSpend":500}'),
  ('coupons', 'cm_prod', '{"type":"discount","status":"used","orderId":"o_cm","customerId":"c1","name":"คัพเค้ก 20%","mode":"product","pct":20,"cap":60,"amount":60,"productId":"cup","productName":"คัพเค้ก"}'),
  ('coupons', 'cm_fixed', '{"type":"discount","status":"used","orderId":"o_cm","customerId":"c1","name":"ลด 50","amount":50,"minSpend":0}'),
  ('coupons', 'cm_bad', '{"type":"discount","status":"used","orderId":"o_cm","customerId":"c1","name":"ประเภทไม่รู้จัก","mode":"weird","pct":10,"cap":10,"amount":10}'),
  ('coupons', 'cm_zero', '{"type":"discount","status":"used","orderId":"o_cm","customerId":"c1","name":"เปอร์เซ็นต์ 0","mode":"spend","pct":0,"cap":100,"amount":100,"minSpend":500}');

-- ออร์เดอร์ร่าง: คัพเค้ก 150 × 2 + สินค้าอื่น 600 = ยอดสินค้า 900
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('o_cm', 'OR-CM-1', 'c1', 'draft', 'pickup', 'web', '{"items":[{"id":"cm1","retailId":"cup","unitPrice":150,"qty":2,"name":"คัพเค้ก"},{"id":"cm2","retailId":"other","unitPrice":600,"qty":1,"name":"อื่น"}],"payments":[],"adjustment":{"amount":0}}');

-- ยอดสินค้าแต่ละแบบที่ใช้ตรวจ
create function test.cm_d(kind text) returns jsonb language sql immutable as $$
  select case kind
    when 'main' then '{"items":[{"retailId":"cup","unitPrice":150,"qty":2},{"retailId":"other","unitPrice":600,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb
    when 'big' then '{"items":[{"retailId":"other","unitPrice":2000,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb
    when 'small' then '{"items":[{"retailId":"cup","unitPrice":150,"qty":1},{"retailId":"other","unitPrice":300,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb
    when 'nocup' then '{"items":[{"retailId":"other","unitPrice":600,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb
    when 'gift' then '{"items":[{"retailId":"cup","unitPrice":0,"qty":1,"promoGift":true},{"retailId":"other","unitPrice":600,"qty":1}],"payments":[],"adjustment":{"amount":0}}'::jsonb
  end
$$;
create function test.cm_entry(kind text, cid text, amt text) returns boolean language sql stable as $$
  select public.punpang__coupon_entry_ok('o_cm', 'web', 'c1', test.cm_d(kind), jsonb_build_object('couponId', cid, 'amount', amt))
$$;

select test.ok('M1: ซื้อครบ 500 ลด 10% สูงสุด 100 · ยอด 900 ลดได้ 90 บาท (ผ่าน)', test.cm_entry('main', 'cm_spend', '90'));
select test.ok('M1: ลด 91 บาท (เกิน 10% ของยอดสินค้า) ไม่ผ่าน', not test.cm_entry('main', 'cm_spend', '91'));
select test.ok('M1: ลด 100 (ถึงเพดาน แต่เกิน 10% ของยอดสินค้า 900) ไม่ผ่าน', not test.cm_entry('main', 'cm_spend', '100'));
select test.ok('M2: ยอดสินค้า 2,000 ลดได้เพดาน 100 บาท (ผ่าน) แต่ 101 ไม่ผ่าน', test.cm_entry('big', 'cm_spend', '100') and not test.cm_entry('big', 'cm_spend', '101'));
select test.ok('M3: ยอดสินค้า 450 ไม่ถึงขั้นต่ำ 500 ของคูปองซื้อครบ', not test.cm_entry('small', 'cm_spend', '40'));
select test.ok('M4: ซื้อคัพเค้ก ลด 20% สูงสุด 60 · คัพเค้ก 300 ลด 60 (ผ่าน) และ 61 ไม่ผ่าน', test.cm_entry('main', 'cm_prod', '60') and not test.cm_entry('main', 'cm_prod', '61'));
select test.ok('M4: ไม่มีคัพเค้กในออร์เดอร์ ใช้คูปองซื้อสินค้าไม่ได้', not test.cm_entry('nocup', 'cm_prod', '10'));
select test.ok('M4: คัพเค้กที่เป็นของแถมไม่นับเป็นสินค้าที่ซื้อ', not test.cm_entry('gift', 'cm_prod', '10'));
select test.ok('M5: คูปองลดเป็นบาทแบบเดิมยังผ่านตามเพดาน 50 (51 ไม่ผ่าน)', test.cm_entry('main', 'cm_fixed', '50') and not test.cm_entry('main', 'cm_fixed', '51'));
select test.ok('M6: ประเภทคูปองที่ไม่รู้จัก หรือเปอร์เซ็นต์เป็น 0 ไม่ผ่าน', not test.cm_entry('main', 'cm_bad', '1') and not test.cm_entry('main', 'cm_zero', '1'));

select test.ok('M7: พนักงานใส่คูปองซื้อครบที่ลดถูกต้อง (90) ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cm_spend","name":"ซื้อครบ 500","amount":90}]'::jsonb) where id = 'o_cm' $q$) = 'OK');
select test.ok('M7: พนักงานใส่ส่วนลดซื้อครบเกินเปอร์เซ็นต์ (100) ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cm_spend","name":"ซื้อครบ 500","amount":100}]'::jsonb) where id = 'o_cm' $q$) like 'ERR:42501:coupon is not claimed%');
select test.ok('M7: เปลี่ยนเป็นคูปองซื้อคัพเค้กที่ลดถูกต้อง (60) ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{couponsUsed}', '[{"couponId":"cm_prod","name":"คัพเค้ก 20%","amount":60}]'::jsonb) where id = 'o_cm' $q$) = 'OK');

-- แลกของ: แถวคูปองที่ลูกค้าได้รับคัดลอกประเภท เปอร์เซ็นต์ เพดาน และสินค้าจากของแลก (ย้อนกลับเมื่อจบ)
begin;
insert into public.punpang_kv (collection, id, data) values
  ('config', 'loyalty', '{"v": {"couponExpireDays": 30}}'::jsonb),
  ('config', 'rewards', '{"v": [
    {"id":"rw_pct","name":"ซื้อครบ 500 ลด 10%","kind":"coupon","mode":"spend","points":50,"minSpend":500,"pct":10,"cap":100,"amount":100,"validDays":30,"active":true},
    {"id":"rw_prod","name":"คัพเค้ก 20%","kind":"coupon","mode":"product","points":40,"productId":"cup","productName":"คัพเค้ก","pct":20,"cap":60,"amount":60,"validDays":30,"active":true},
    {"id":"rw_fix","name":"ลด 50","kind":"coupon","mode":"fixed","points":30,"amount":50,"minSpend":200,"active":true}]}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data; -- ค่าเดิมกลับคืนตอน rollback
update public.punpang_customers set data = '{"ledger":[{"id":"cmlot","delta":500,"remaining":500,"at":"2026-11-01T00:00:00.000Z"}],"spins":0}'::jsonb where id = 'c1';
create temp table cm_res (k text primary key, r jsonb);
insert into cm_res values
  ('pct', public.punpang_cust_redeem('c1', 'rw_pct')),
  ('prod', public.punpang_cust_redeem('c1', 'rw_prod')),
  ('fix', public.punpang_cust_redeem('c1', 'rw_fix'));

select test.ok('R1: แลกคูปองซื้อครบ: แถวคูปองมี mode spend, pct 10, cap 100, minSpend 500',
  (select (r->'coupon'->>'mode') = 'spend' and (r->'coupon'->>'pct')::numeric = 10 and (r->'coupon'->>'cap')::numeric = 100
          and (r->'coupon'->>'minSpend')::numeric = 500 and (r->'coupon'->>'amount')::numeric = 100 from cm_res where k = 'pct'));
select test.ok('R2: แลกคูปองซื้อสินค้า: มี productId cup และ productName และ minSpend เป็น 0',
  (select (r->'coupon'->>'mode') = 'product' and (r->'coupon'->>'productId') = 'cup' and (r->'coupon'->>'productName') = 'คัพเค้ก'
          and (r->'coupon'->>'minSpend')::numeric = 0 from cm_res where k = 'prod'));
select test.ok('R3: แลกคูปองลดเป็นบาทแบบเดิม: mode fixed, amount 50, minSpend 200',
  (select (r->'coupon'->>'mode') = 'fixed' and (r->'coupon'->>'amount')::numeric = 50 and (r->'coupon'->>'minSpend')::numeric = 200 from cm_res where k = 'fix'));
select test.ok('R4: แลกทั้งสามครั้งสำเร็จ และคะแนนคงเหลือ 380 (500 − 50 − 40 − 30)',
  (select (r->>'ok') = 'true' and (r->>'balance')::int = 380 from cm_res where k = 'fix'));
rollback;
