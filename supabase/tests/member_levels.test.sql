-- ทดสอบระดับสมาชิก เฟส 1 (migration 20261122110000 และ 20261122110100)
-- รันโดย run.sh หลัง points_vat.test.sql · พนักงานส่งมอบ/ให้คะแนน = driver (22222222) · ถอนยอด/ตั้งโหมด = ผู้ดูแล (cccccccc)
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น mlv_ · ทำในธุรกรรมที่ย้อนกลับ
-- วันที่ 90/91/365/730 ใช้เหตุการณ์ย้อนหลังที่เขียนตรง ๆ (now() ของธุรกรรมคงที่ จึงย้อนวันจริงด้วยการส่งมอบไม่ได้)
-- วันที่ 0 = 2026-01-05 (เวลาไทย) · แต่ละข้อใช้ test.ok(ชื่อ, เงื่อนไข) · ไม่จริง = ล้มทันที

begin;

-- ---------- ตัวช่วย (pg_temp หายเมื่อจบธุรกรรม) ----------
create function pg_temp.mlv_d(n int) returns date language sql immutable as $$ select (date '2026-01-05' + n) $$;
create function pg_temp.mlv_at(d date, t time default '12:00') returns timestamptz language sql immutable
  as $$ select (d + t) at time zone 'Asia/Bangkok' $$;
create function pg_temp.mlv_ev(p_c text, p_o text, p_n int, p_amt numeric, p_rmin numeric default 140) returns void language sql as $$
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_c, p_o, 'spend', pg_temp.mlv_at(pg_temp.mlv_d(p_n)), pg_temp.mlv_d(p_n), p_amt, p_rmin, 1)
$$;
create function pg_temp.mlv_un(p_c text, p_o text, p_n int) returns void language sql as $$
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_c, p_o, 'undo', pg_temp.mlv_at(pg_temp.mlv_d(p_n)), pg_temp.mlv_d(p_n), 0, null, null)
$$;
create function pg_temp.mlv_fold(p_c text, p_n int) returns jsonb language sql as $$
  select public.punpang__member_fold(p_c, pg_temp.mlv_at(pg_temp.mlv_d(p_n), '23:00'))
$$;
create function pg_temp.mlv_bm(p_c text, p_n int, p_amt numeric, p_rmin numeric) returns numeric language sql as $$
  select public.punpang__member_bill_mult(public.punpang__member_fold(p_c, pg_temp.mlv_at(pg_temp.mlv_d(p_n), '00:01')), p_amt, p_rmin, public.punpang__member_cfg())
$$;
create function pg_temp.mlv_mode(m text) returns void language sql as $$
  insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels', jsonb_build_object('v',
    jsonb_build_object('levels', '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":1000,"mult":3},{"name":"LV3","min":3000,"mult":5},{"name":"LV4","min":7000,"mult":10}]'::jsonb) || jsonb_build_object('mode', m)))
  on conflict (collection, id) do update set data = excluded.data
$$;
-- เกณฑ์เฟส 1 (500/1,500/3,000 → ค่าเดิมของชุดนี้ 1,000/3,000/7,000) ใส่เป็นค่าพื้นฐานของทุกกรณี
-- เพราะค่าตั้งต้นตามสเปกเปลี่ยนแล้ว (ทดสอบค่าตั้งต้นใหม่ใน member_benefits.test.sql)
create function pg_temp.mlv_cfg(v jsonb) returns void language sql as $$
  insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels', jsonb_build_object('v',
    jsonb_build_object('levels', '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":1000,"mult":3},{"name":"LV3","min":3000,"mult":5},{"name":"LV4","min":7000,"mult":10}]'::jsonb) || v))
  on conflict (collection, id) do update set data = excluded.data
$$;

-- ---------- เตรียมข้อมูล ----------
insert into public.punpang_kv (collection, id, data) values
  ('config', 'loyalty', '{"v":{"earnPer":100,"spinPer":500,"pointExpireDays":365}}'),
  ('config', 'pointPromos', '{"v":[]}')
on conflict (collection, id) do update set data = excluded.data;
delete from public.punpang_kv where collection = 'config' and id = 'memberLevels';

insert into auth.users (id, email) values ('cccccccc-0000-4000-8000-000000000003', 'mlv-admin@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms, active) values
  ('cccccccc-0000-4000-8000-000000000003', 'ผู้ดูแลทดสอบสมาชิก', 'admin', array['manage'], true)
on conflict do nothing;

insert into public.punpang_customers (id, name, data) values
  ('mlv_a1', 'สมาชิกทดสอบ A1', '{"ledger":[],"spins":0}'),
  ('mlv_b2', 'สมาชิกทดสอบ B2', '{"ledger":[],"spins":0}'),
  ('mlv_c999', 'ทดสอบ 999', '{"ledger":[],"spins":0}'),
  ('mlv_c1000', 'ทดสอบ 1000', '{"ledger":[],"spins":0}'),
  ('mlv_c2999', 'ทดสอบ 2999', '{"ledger":[],"spins":0}'),
  ('mlv_c3000', 'ทดสอบ 3000', '{"ledger":[],"spins":0}'),
  ('mlv_c6999', 'ทดสอบ 6999', '{"ledger":[],"spins":0}'),
  ('mlv_c7000', 'ทดสอบ 7000', '{"ledger":[],"spins":0}'),
  ('mlv_c139', 'ทดสอบ ยอด 139', '{"ledger":[],"spins":0}'),
  ('mlv_c140', 'ทดสอบ ยอด 140', '{"ledger":[],"spins":0}'),
  ('mlv_c149', 'ทดสอบ ยอด 149', '{"ledger":[],"spins":0}'),
  ('mlv_c150', 'ทดสอบ ยอด 150', '{"ledger":[],"spins":0}'),
  ('mlv_cyc', 'ทดสอบ วงจรวัน', '{"ledger":[],"spins":0}'),
  ('mlv_r365', 'ทดสอบ ต่ออายุวันครบ', '{"ledger":[],"spins":0}'),
  ('mlv_d365', 'ทดสอบ ไม่ต่ออายุวันครบ', '{"ledger":[],"spins":0}'),
  ('mlv_ren300', 'ทดสอบ ต่ออายุระหว่างทาง', '{"ledger":[],"spins":0}'),
  ('mlv_undo', 'ทดสอบ ถอนยอด', '{"ledger":[],"spins":0}'),
  ('mlv_dd', 'ทดสอบ ลดขั้นวันครบกำหนด', '{"ledger":[],"spins":0}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('mlv_o_big', 'OR-MLV-1', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":1070,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv1","status":"confirmed","amount":1070}],"adjustment":{"amount":0}}'),
  ('mlv_o_s1', 'OR-MLV-2', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv2","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('mlv_o_s2', 'OR-MLV-3', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv3","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('mlv_o_s3', 'OR-MLV-4', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv4","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('mlv_o_s4', 'OR-MLV-5', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv5","status":"confirmed","amount":107}],"adjustment":{"amount":0}}'),
  ('mlv_o_m1', 'OR-MLV-6', 'mlv_a1', 'delivered', 'pickup', 'web', '{"items":[{"unitPrice":107,"qty":1}],"vat":{"rate":7,"mode":"inclusive"},"payments":[{"id":"mv6","status":"confirmed","amount":107}],"adjustment":{"amount":0}}');

-- ---------- A) ตั้งค่า: ค่าไม่ครบหรือไม่ถูกต้อง = ปิดระบบ ----------
select test.ok('A1 ไม่มีการตั้งค่า = โหมดปิด และมีระดับตั้งต้น 4 ขั้น',
  public.punpang__member_cfg()->>'mode' = 'off' and jsonb_array_length(public.punpang__member_cfg()->'levels') = 4);
select pg_temp.mlv_mode('turbo');
select test.ok('A2 โหมดที่ไม่รู้จัก (turbo) = ปิด', public.punpang__member_cfg()->>'mode' = 'off');
select pg_temp.mlv_cfg('{"mode":"live","levels":[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":500,"mult":3},{"name":"LV3","min":400,"mult":5}]}'::jsonb);
select test.ok('A3 เกณฑ์ยอดสะสมไม่เพิ่มขึ้นตามขั้น = ปิด', public.punpang__member_cfg()->>'mode' = 'off');
select pg_temp.mlv_cfg('{"mode":"live","levels":[{"name":"LV1","min":10,"mult":1}]}'::jsonb);
select test.ok('A4 ขั้นแรกไม่เริ่มที่ 0 = ปิด', public.punpang__member_cfg()->>'mode' = 'off');
select pg_temp.mlv_cfg('{"mode":"live","renewGross":"150"}'::jsonb);
select test.ok('A5 ค่าตัวเลขที่เป็นข้อความ = ปิด', public.punpang__member_cfg()->>'mode' = 'off');
select pg_temp.mlv_cfg('{"mode":"live","downgradeDays":90}'::jsonb);
select test.ok('A6 ลดขั้น (90 วัน) ต้องหลังช่วงใช้งาน (90 วัน) = ปิด', public.punpang__member_cfg()->>'mode' = 'off');
select pg_temp.mlv_cfg('{"mode":"live"}'::jsonb);
select test.ok('A7 ตั้งค่าถูกต้อง (โหมดใช้จริง) ใช้ค่าตั้งต้นของระดับ',
  public.punpang__member_cfg()->>'mode' = 'live' and jsonb_array_length(public.punpang__member_cfg()->'levels') = 4);

-- ---------- B) เกณฑ์ต่ออายุของบิล (ก่อน VAT) ----------
select test.ok('B1 VAT 7% = 140 (150 หารด้วย 1.07 แล้วปัดลง)',
  public.punpang__member_renew_min('{"vat":{"rate":7,"mode":"inclusive"}}'::jsonb, public.punpang__member_cfg()) = 140);
select test.ok('B2 VAT 0% = 150',
  public.punpang__member_renew_min('{"vat":{"rate":0,"mode":"inclusive"}}'::jsonb, public.punpang__member_cfg()) = 150);
select test.ok('B3 ไม่มี VAT = 150', public.punpang__member_renew_min('{}'::jsonb, public.punpang__member_cfg()) = 150);
select test.ok('B4 VAT 10% = 136', public.punpang__member_renew_min('{"vat":{"rate":10,"mode":"inclusive"}}'::jsonb, public.punpang__member_cfg()) = 136);
select test.ok('B5 อัตรา VAT ไม่ใช่ตัวเลข = ถือเป็น 0 (150)',
  public.punpang__member_renew_min('{"vat":{"rate":"abc"}}'::jsonb, public.punpang__member_cfg()) = 150);

-- ---------- C) ระดับและวงจร (เหตุการณ์สังเคราะห์ย้อนหลัง) ----------
select pg_temp.mlv_mode('live');
-- ขั้นตามยอดสะสม (ตัวอย่างละ 1 บิลในวันที่ 0)
select pg_temp.mlv_ev('mlv_c999', 'e_c999', 0, 999);
select pg_temp.mlv_ev('mlv_c1000', 'e_c1000', 0, 1000);
select pg_temp.mlv_ev('mlv_c2999', 'e_c2999', 0, 2999);
select pg_temp.mlv_ev('mlv_c3000', 'e_c3000', 0, 3000);
select pg_temp.mlv_ev('mlv_c6999', 'e_c6999', 0, 6999);
select pg_temp.mlv_ev('mlv_c7000', 'e_c7000', 0, 7000);
-- ยอดรายวัน 139 กับ 140 (เกณฑ์ 140): บิลแรกวันที่ 0 แล้วบิลวันที่ 100
select pg_temp.mlv_ev('mlv_c139', 'e_c139a', 0, 500);
select pg_temp.mlv_ev('mlv_c139', 'e_c139b', 100, 139);
select pg_temp.mlv_ev('mlv_c140', 'e_c140a', 0, 500);
select pg_temp.mlv_ev('mlv_c140', 'e_c140b', 100, 140);
-- ยอดรายวัน 149 กับ 150 (เกณฑ์ 150 เมื่อไม่มี VAT)
select pg_temp.mlv_ev('mlv_c149', 'e_c149a', 0, 500, 150);
select pg_temp.mlv_ev('mlv_c149', 'e_c149b', 100, 149, 150);
select pg_temp.mlv_ev('mlv_c150', 'e_c150a', 0, 500, 150);
select pg_temp.mlv_ev('mlv_c150', 'e_c150b', 100, 150, 150);
-- วงจร: ระดับ 3 ตั้งแต่วันที่ 0 ไม่มีการต่ออายุอีก
select pg_temp.mlv_ev('mlv_cyc', 'e_cyc', 0, 3000);
-- วันครบ 365 วัน: มีการต่ออายุในวันนั้น (150) / ไม่มี (139)
select pg_temp.mlv_ev('mlv_r365', 'e_r365a', 0, 1000);
select pg_temp.mlv_ev('mlv_r365', 'e_r365b', 365, 150);
select pg_temp.mlv_ev('mlv_d365', 'e_d365a', 0, 1000);
select pg_temp.mlv_ev('mlv_d365', 'e_d365b', 365, 139);
-- ต่ออายุระหว่างทาง (วันที่ 300) เลื่อนวันลดขั้น
select pg_temp.mlv_ev('mlv_ren300', 'e_ren_a', 0, 3000);
select pg_temp.mlv_ev('mlv_ren300', 'e_ren_b', 300, 150);
-- ถอนยอดและส่งมอบซ้ำ
select pg_temp.mlv_ev('mlv_undo', 'e_un1', 0, 1000);
select pg_temp.mlv_ev('mlv_undo', 'e_un2', 0, 150);

select test.ok('C1 ขั้นตามยอดสะสม: 999 LV1 · 1000 LV2 · 2999 LV2 · 3000 LV3 · 6999 LV3 · 7000 LV4',
  (pg_temp.mlv_fold('mlv_c999', 0)->>'level')::int = 1 and (pg_temp.mlv_fold('mlv_c1000', 0)->>'level')::int = 2
  and (pg_temp.mlv_fold('mlv_c2999', 0)->>'level')::int = 2 and (pg_temp.mlv_fold('mlv_c3000', 0)->>'level')::int = 3
  and (pg_temp.mlv_fold('mlv_c6999', 0)->>'level')::int = 3 and (pg_temp.mlv_fold('mlv_c7000', 0)->>'level')::int = 4);
select test.ok('C2a ยอดรายวัน 139 (ไม่ถึง 140) ไม่ต่ออายุ: วันที่ 100 ยังวันแรก และพักสิทธิ์',
  pg_temp.mlv_fold('mlv_c139', 100)->>'renewAt' = pg_temp.mlv_d(0)::text and pg_temp.mlv_fold('mlv_c139', 100)->>'status' = 'paused');
select test.ok('C2b ยอดรายวัน 140 (ถึงเกณฑ์) ต่ออายุวันที่ 100 และใช้งานได้',
  pg_temp.mlv_fold('mlv_c140', 100)->>'renewAt' = pg_temp.mlv_d(100)::text and pg_temp.mlv_fold('mlv_c140', 100)->>'status' = 'active');
select test.ok('C3 เกณฑ์ 150 (ไม่มี VAT): 149 ไม่ต่ออายุ · 150 ต่ออายุ',
  pg_temp.mlv_fold('mlv_c149', 100)->>'renewAt' = pg_temp.mlv_d(0)::text and pg_temp.mlv_fold('mlv_c150', 100)->>'renewAt' = pg_temp.mlv_d(100)::text);
select test.ok('C4a วันที่ 90 ยังใช้งานได้ (Active)', pg_temp.mlv_fold('mlv_cyc', 90)->>'status' = 'active');
select test.ok('C4b วันที่ 91 พักสิทธิ์ และอยู่ช่วงวันทอง', pg_temp.mlv_fold('mlv_cyc', 91)->>'status' = 'paused'
  and (pg_temp.mlv_fold('mlv_cyc', 91)->>'golden')::boolean);
select test.ok('C4c ช่วงวันทองถึงวันที่ 104 · วันที่ 105 พ้นช่วงวันทอง',
  (pg_temp.mlv_fold('mlv_cyc', 104)->>'golden')::boolean and not (pg_temp.mlv_fold('mlv_cyc', 105)->>'golden')::boolean);
select test.ok('C4d วันที่ 364 ยังระดับ 3 (พักสิทธิ์)',
  (pg_temp.mlv_fold('mlv_cyc', 364)->>'level')::int = 3 and pg_temp.mlv_fold('mlv_cyc', 364)->>'status' = 'paused');
select test.ok('C4e วันที่ 365 ลดเป็นระดับ 2 ยอดสะสมเป็นเกณฑ์ใหม่ 1000 และลดครั้งถัดไปวันที่ 730',
  (pg_temp.mlv_fold('mlv_cyc', 365)->>'level')::int = 2 and (pg_temp.mlv_fold('mlv_cyc', 365)->>'cum')::numeric = 1000
  and pg_temp.mlv_fold('mlv_cyc', 365)->>'downgradeAt' = pg_temp.mlv_d(730)::text);
select test.ok('C4f วันที่ 730 ลดถึงระดับ 1', (pg_temp.mlv_fold('mlv_cyc', 730)->>'level')::int = 1);
select test.ok('C4g ตัวคูณของบิล: วันทองบิลต่ออายุ 200 ได้เต็ม · บิลไม่ถึงเกณฑ์ได้ 1 · วันที่ 105 บิล 200 ได้ 1 · บิล 500 ได้เต็ม · Active ได้เต็มทุกบิล',
  pg_temp.mlv_bm('mlv_cyc', 91, 200, 140) = 5 and pg_temp.mlv_bm('mlv_cyc', 91, 139, 140) = 1
  and pg_temp.mlv_bm('mlv_cyc', 105, 200, 140) = 1 and pg_temp.mlv_bm('mlv_cyc', 105, 500, 140) = 5
  and pg_temp.mlv_bm('mlv_cyc', 50, 10, 140) = 5);
select test.ok('C5a ต่ออายุในวันครบ 365 วัน (ยอด 150) ไม่ลดขั้น และวันต่ออายุเป็นวันนั้น',
  (pg_temp.mlv_fold('mlv_r365', 365)->>'level')::int = 2 and pg_temp.mlv_fold('mlv_r365', 365)->>'renewAt' = pg_temp.mlv_d(365)::text);
select test.ok('C5b ไม่ต่ออายุในวันครบ 365 วัน (ยอด 139) ลดเป็นระดับ 1 และวันต่ออายุยังเป็นวันเดิม',
  (pg_temp.mlv_fold('mlv_d365', 365)->>'level')::int = 1 and pg_temp.mlv_fold('mlv_d365', 365)->>'renewAt' = pg_temp.mlv_d(0)::text);
select test.ok('C6 ต่ออายุวันที่ 300 เลื่อนการลดขั้น: วันที่ 600 ยังระดับ 3 · วันที่ 665 เหลือ 2 · วันที่ 1030 เหลือ 1',
  (pg_temp.mlv_fold('mlv_ren300', 600)->>'level')::int = 3 and (pg_temp.mlv_fold('mlv_ren300', 665)->>'level')::int = 2
  and (pg_temp.mlv_fold('mlv_ren300', 1030)->>'level')::int = 1);
select pg_temp.mlv_un('mlv_undo', 'e_un2', 0);
select test.ok('C7a ถอนยอดรายการ 150 แล้ว ยอดสะสมเหลือ 1000 (ยังระดับ 2)',
  (pg_temp.mlv_fold('mlv_undo', 0)->>'cum')::numeric = 1000 and (pg_temp.mlv_fold('mlv_undo', 0)->>'level')::int = 2);
select pg_temp.mlv_ev('mlv_undo', 'e_un2', 0, 150);
select test.ok('C7b ส่งมอบซ้ำหลังถอนเป็นรายการใหม่ นับเพิ่มอีกครั้ง ยอดสะสม 1150',
  (pg_temp.mlv_fold('mlv_undo', 0)->>'cum')::numeric = 1150);

-- ลดขั้นวันครบ 365 วัน: บิลต่ออายุในวันนั้นใช้ตัวคูณของระดับก่อนลด (ไม่ใช่ระดับหลังลด)
select pg_temp.mlv_ev('mlv_dd', 'e_dd_a', 0, 3000);
select test.ok('C8a วันครบ 365 วันไม่ต่ออายุ ระดับลดเป็น 2 (ตามเดิม)',
  (pg_temp.mlv_fold('mlv_dd', 365)->>'level')::int = 2);
select test.ok('C8b บิล 600 ต่ออายุในวันครบกำหนด (ถึง bigBill) ได้ตัวคูณระดับก่อนลด = 5',
  pg_temp.mlv_bm('mlv_dd', 365, 600, 140) = 5);
select test.ok('C8c บิล 150 ต่ออายุในวันครบกำหนด แต่ไม่ถึง bigBill และไม่อยู่วันทอง ได้ 1',
  pg_temp.mlv_bm('mlv_dd', 365, 150, 140) = 1);
select test.ok('C8d บิล 139 (ไม่ถึงเกณฑ์ต่ออายุ) ในวันครบกำหนด ได้ 1',
  pg_temp.mlv_bm('mlv_dd', 365, 139, 140) = 1);
select pg_temp.mlv_ev('mlv_dd', 'e_dd_b', 365, 600);
select test.ok('C8e หลังบิล 600 ต่ออายุในวันนั้น ระดับยังเป็น 3 และวันต่ออายุเป็นวันนั้น',
  (pg_temp.mlv_fold('mlv_dd', 365)->>'level')::int = 3 and pg_temp.mlv_fold('mlv_dd', 365)->>'renewAt' = pg_temp.mlv_d(365)::text);

-- ---------- D) การส่งมอบจริง (RPC): ตัวคูณ เพดานแต้ม การถอน การย้ายผู้ซื้อ การลบ โหมดทดลอง ----------
select test.ok('D1 บิลแรก 1000 (ยังไม่มียอด ตัวคูณ 1) ให้ 10 แต้มได้',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_big', 10, 0, 0, 1000) $q$)->>'ok')::boolean);
select test.ok('D2 บิล 100 ตอนเป็นระดับ 2 (Active ตัวคูณ 3) ให้ 3 แต้มได้',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s1', 3, 0, 0, 100) $q$)->>'ok')::boolean);
select test.ok('D3 ขอ 4 แต้มเกินเพดานตัวคูณ 3 = ปฏิเสธ (invalid)',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s2', 4, 0, 0, 100) $q$)->>'error') = 'invalid');
select test.ok('D4 ขอ 3 แต้ม (ไม่เกินเพดาน) ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s2', 3, 0, 0, 100) $q$)->>'ok')::boolean);
select test.ok('D5 ส่งซ้ำออร์เดอร์เดิม = already_awarded และไม่เพิ่มยอดซ้ำ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s1', 3, 0, 0, 100) $q$)->>'error') = 'already_awarded'
  and (select count(*) from public.punpang_member_events where order_id = 'mlv_o_s1' and kind = 'spend') = 1);
select test.ok('D6 บันทึกยอดสมาชิกครบ 3 บิล และตัวคูณที่บันทึกของบิล s1 เป็น 3',
  (select count(*) from public.punpang_member_events where customer_id = 'mlv_a1' and kind = 'spend') = 3
  and (select mult from public.punpang_member_events where order_id = 'mlv_o_s1' and kind = 'spend') = 3);
select test.ok('D7a ผู้ดูแลถอนการให้แต้มของ s2 ได้',
  (test.rpc_as('cccccccc-0000-4000-8000-000000000003', $q$ select public.punpang_undo_award('mlv_o_s2') $q$)->>'ok')::boolean);
select test.ok('D7b การถอนถูกบันทึก 1 รายการ และยอดสะสมเหลือ 1100 (ตัด s2)',
  (select count(*) from public.punpang_member_events where customer_id = 'mlv_a1' and kind = 'undo') = 1
  and (public.punpang__member_fold('mlv_a1', now())->>'cum')::numeric = 1100);
select test.ok('D8a ส่งมอบ s2 ใหม่หลังถอน (3 แต้ม) ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s2', 3, 0, 0, 100) $q$)->>'ok')::boolean);
select test.ok('D8b ยอดสะสม 1200 และ s2 มีรายการสองครั้ง (ก่อนถอนและหลังส่งมอบใหม่)',
  (public.punpang__member_fold('mlv_a1', now())->>'cum')::numeric = 1200
  and (select count(*) from public.punpang_member_events where order_id = 'mlv_o_s2' and kind = 'spend') = 2);
update public.punpang_orders set customer_id = 'mlv_b2' where id = 'mlv_o_s1';
select test.ok('D9 โอนผู้ซื้อ s1 ไป B2: A1 เหลือ 1100 · B2 ได้ 100 และเป็นระดับ 1',
  (public.punpang__member_fold('mlv_a1', now())->>'cum')::numeric = 1100
  and (public.punpang__member_fold('mlv_b2', now())->>'cum')::numeric = 100
  and (public.punpang__member_fold('mlv_b2', now())->>'level')::int = 1);
select test.ok('D10 บัตรระดับ (โหมดใช้จริง) ของ A1: ระดับ 2 ตัวคูณ 3 Active และมีคีย์ยอดสะสม cum กับ nextMin',
  (public.punpang_member_card('mlv_a1')->>'enabled')::boolean
  and (public.punpang_member_card('mlv_a1')->>'levelNo')::int = 2
  and (public.punpang_member_card('mlv_a1')->>'mult')::numeric = 3
  and public.punpang_member_card('mlv_a1')->>'status' = 'active'
  and (public.punpang_member_card('mlv_a1') ? 'cum')
  and (public.punpang_member_card('mlv_a1') ? 'nextMin'));
select test.ok('D10b บัตรระดับไม่มีค่าที่ต้องซื้อเพิ่ม (toNext) เพื่อไม่ให้คำนวณยอดสะสมย้อนกลับ',
  not (public.punpang_member_card('mlv_a1') ? 'toNext'));
update public.punpang_customers set data = data || '{"deleted": true}'::jsonb where id = 'mlv_b2';
select test.ok('D11 ลบข้อมูลลูกค้า (PDPA) B2 = ยอดสมาชิกของ B2 ถูกลบ และของ A1 ไม่ถูกแตะ',
  (select count(*) from public.punpang_member_events where customer_id = 'mlv_b2') = 0
  and (select count(*) from public.punpang_member_events where customer_id = 'mlv_a1') > 0);

select pg_temp.mlv_mode('shadow');
select test.ok('D12a โหมดทดลอง: ส่งมอบ s3 (1 แต้ม) ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_s3', 1, 0, 0, 100) $q$)->>'ok')::boolean);
select test.ok('D12b โหมดทดลอง: บันทึกยอดของ s3 พร้อมตัวคูณ 3 (แต้มจริงไม่ถูกคูณ)',
  (select mult from public.punpang_member_events where order_id = 'mlv_o_s3' and kind = 'spend') = 3);
select test.ok('D13 โหมดทดลอง: ขอ 4 แต้มยังถูกปฏิเสธตามเพดานเดิม (1 แต้มต่อ 100 บาท)',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_m1', 4, 0, 0, 100) $q$)->>'error') = 'invalid');
select test.ok('D13b โหมดทดลอง: ตัวอย่างตัวคูณ applied=false แต่แสดงตัวคูณ 3',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_member_preview('mlv_o_s4', 100) $q$)->>'applied')::boolean = false
  and (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_member_preview('mlv_o_s4', 100) $q$)->>'mult')::numeric = 3);

select pg_temp.mlv_mode('off');
select test.ok('D14a โหมดปิด: ขอ 2 แต้มเกินเพดานเดิม (1 แต้ม) = ปฏิเสธ',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_m1', 2, 0, 0, 100) $q$)->>'error') = 'invalid');
select test.ok('D14b โหมดปิด: ส่งมอบ m1 (1 แต้ม) ผ่าน',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_award_order('mlv_o_m1', 1, 0, 0, 100) $q$)->>'ok')::boolean);
select test.ok('D14c โหมดปิด: ไม่บันทึกยอดสมาชิกของ m1',
  (select count(*) from public.punpang_member_events where order_id = 'mlv_o_m1') = 0);
select test.ok('D14d โหมดปิด: ตัวอย่างตัวคูณเป็น 1 และ applied=false',
  (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_member_preview('mlv_o_s4', 100) $q$)->>'mult')::numeric = 1
  and (test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_member_preview('mlv_o_s4', 100) $q$)->>'applied')::boolean = false);

-- ---------- E) สิทธิ์การเข้าถึง และการกันแก้ไขยอดสมาชิก ----------
select test.ok('E1 บัตรระดับเรียกได้เฉพาะ service_role (authenticated และ anon เรียกไม่ได้)',
  has_function_privilege('service_role', 'public.punpang_member_card(text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.punpang_member_card(text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.punpang_member_card(text)', 'EXECUTE'));
select test.ok('E2 ตัวอย่างตัวคูณเรียกได้เฉพาะผู้ล็อกอิน (anon เรียกไม่ได้)',
  has_function_privilege('authenticated', 'public.punpang_member_preview(text,numeric)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.punpang_member_preview(text,numeric)', 'EXECUTE'));
select test.ok('E3 ตารางยอดสมาชิกไม่เปิดให้ anon หรือ authenticated อ่านตรง',
  not has_table_privilege('anon', 'public.punpang_member_events', 'SELECT')
  and not has_table_privilege('authenticated', 'public.punpang_member_events', 'SELECT'));
do $$
declare caught text := '';
begin
  begin
    update public.punpang_member_events set amount = 1 where customer_id = 'mlv_c999';
  exception when others then caught := sqlstate;
  end;
  perform test.ok('E4 แก้บันทึกยอดสมาชิกไม่ได้ (ปฏิเสธ 42501)', caught = '42501');
end $$;
do $$
declare caught text := '';
begin
  begin
    delete from public.punpang_member_events where customer_id = 'mlv_c999';
  exception when others then caught := sqlstate;
  end;
  perform test.ok('E5 ลบบันทึกยอดสมาชิกไม่ได้ นอกจากการลบข้อมูลลูกค้า (ปฏิเสธ 42501)', caught = '42501');
end $$;

rollback;
select 'ผ่านทั้งหมด' as member_levels_tests;
