-- ทดสอบลูกค้าสร้างคูปองลดเป็นบาทจากคะแนน (punpang_cust_make_coupon) ที่เซิร์ฟเวอร์
-- รันโดย supabase/tests/run.sh หลัง coupon_modes/lucky (ใช้ test.ok จาก security.test.sql)
-- ทำในธุรกรรมที่ย้อนกลับ · ใช้ลูกค้า c1 และค่าตั้งคะแนน loyalty (ค่าเดิมคืนตอน rollback)

begin;
insert into public.punpang_kv (collection, id, data) values
  ('config', 'loyalty', '{"v": {"pointValue": 1, "couponExpireDays": 30}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;
update public.punpang_customers set data = jsonb_set(data, '{ledger}',
  '[{"id":"pclot","delta":200,"remaining":200,"at":"2026-11-01T00:00:00.000Z"}]'::jsonb) where id = 'c1';

create temp table pc_res (k text primary key, r jsonb);
insert into pc_res values ('ok50', public.punpang_cust_make_coupon('c1', 50));
insert into pc_res values ('bal', public.punpang_cust_make_coupon('c1', 50));
select test.ok('P1: สร้างคูปอง 50 บาทสำเร็จ และคะแนนคงเหลือ 150 (200 − 50)',
  (select (r->>'ok') = 'true' and (r->>'balance')::int = 150 from pc_res where k = 'ok50'));
select test.ok('P2: คูปองมีฟิลด์ถูกต้อง: fixed, amount 50, source points_coupon, points 50, pending',
  (select (r->'coupon'->>'mode') = 'fixed' and (r->'coupon'->>'amount')::numeric = 50
          and (r->'coupon'->>'source') = 'points_coupon' and (r->'coupon'->>'points')::int = 50
          and (r->'coupon'->>'status') = 'pending' and (r->'coupon'->>'type') = 'discount' from pc_res where k = 'ok50'));
select test.ok('P3: หมดอายุ = วันนี้ + 15 วัน (วันที่แบบเดิม)',
  (select (r->'coupon'->>'expiresAt') = to_char(public.punpang__pts_today()::date + 15, 'YYYY-MM-DD') from pc_res where k = 'ok50'));
select test.ok('P4: ledger ลดจริง: คะแนนคงเหลือ 100 หลังสร้างสองรอบ (200 − 50 − 50)',
  (select coalesce(sum((e->>'remaining')::int), 0) = 100 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'c1'));

insert into pc_res values ('not10', public.punpang_cust_make_coupon('c1', 15));
insert into pc_res values ('nul', public.punpang_cust_make_coupon('c1', null));
insert into pc_res values ('nocust', public.punpang_cust_make_coupon('nope', 50));
select test.ok('P5: มูลค่าไม่ใช่ทวีคูณ 10 หรือว่าง → invalid',
  (select (r->>'error') = 'invalid' from pc_res where k = 'not10')
  and (select (r->>'error') = 'invalid' from pc_res where k = 'nul'));
select test.ok('P6: ลูกค้าไม่มี → no_customer',
  (select (r->>'error') = 'no_customer' from pc_res where k = 'nocust'));

update public.punpang_kv set data = '{"v": {"pointValue": 3}}'::jsonb where collection = 'config' and id = 'loyalty';
insert into pc_res values ('div10', public.punpang_cust_make_coupon('c1', 10));
select test.ok('P7: pointValue 3: มูลค่า 10 บาทไม่ลงตัว → not_divisible และ ledger ไม่เปลี่ยน',
  (select (r->>'error') = 'not_divisible' from pc_res where k = 'div10')
  and (select coalesce(sum((e->>'remaining')::int), 0) = 100 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'c1'));
insert into pc_res values ('div30', public.punpang_cust_make_coupon('c1', 30));
select test.ok('P8: pointValue 3: มูลค่า 30 บาทลงตัว (10 คะแนน) → สำเร็จ',
  (select (r->>'ok') = 'true' and (r->'coupon'->>'points')::int = 10 from pc_res where k = 'div30'));

update public.punpang_customers set data = jsonb_set(data, '{ledger}',
  '[{"id":"pclow","delta":5,"remaining":5,"at":"2026-11-01T00:00:00.000Z"}]'::jsonb) where id = 'c1';
insert into pc_res values ('low', public.punpang_cust_make_coupon('c1', 30));
select test.ok('P9: คะแนนไม่พอ → insufficient',
  (select (r->>'error') = 'insufficient' from pc_res where k = 'low'));

select test.ok('P10: anon และ authenticated เรียกฟังก์ชันนี้ตรง ๆ ไม่ได้',
  not has_function_privilege('anon', 'public.punpang_cust_make_coupon(text,numeric)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.punpang_cust_make_coupon(text,numeric)', 'EXECUTE'));
rollback;
