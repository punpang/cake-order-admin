-- ทดสอบลุ้นโชค (สมาชิก) หลายโครงการ ระดับฐานข้อมูล: punpang_lucky_spin(โทเคน, สมาชิก, โครงการ) และการย้ายชุดเดิม
-- รันโดย run.sh หลัง migration ทุกไฟล์และ security.test.sql · แต่ละข้อใช้ lt.ok(ชื่อ, เงื่อนไข) · เงื่อนไขไม่เป็นจริง = ล้มทันที (psql จบด้วยรหัสผิดพลาด)
-- ข้อ I ทดสอบการย้ายชุดเดิมด้วยการรันไฟล์ migration ซ้ำกับข้อมูลเดิมที่จำลองไว้ (คำสั่งย้ายทำซ้ำได้)

create schema lt;

create function lt.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- เวลาแบบสตริง ISO (UTC มิลลิวินาที) เหมือนที่แอปเก็บ
create function lt.iso(off interval) returns text language sql stable as $$
  select to_char((now() + off) at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;

-- โครงการหนึ่งรายการ (ช่วงเวลาเทียบกับตอนนี้)
create function lt.proj(pid text, enabled boolean, from_off interval, to_off interval, prizes jsonb, coupon_days integer) returns jsonb language sql stable as $$
  select jsonb_build_object('id', pid, 'name', 'โครงการ ' || pid, 'enabled', enabled, 'kind', 'items', 'itemIds', jsonb_build_array('r1'),
    'everyBaht', null, 'from', lt.iso(from_off), 'to', lt.iso(to_off), 'couponDays', coupon_days, 'prizes', prizes)
$$;

-- ตั้งค่า shop.luckyDraw แบบหลายโครงการ
create function lt.cfg(projects jsonb) returns void language plpgsql as $$
begin
  insert into public.punpang_kv (collection, id, data) values ('config', 'shop', jsonb_build_object('v', jsonb_build_object('luckyDraw',
    jsonb_build_object('siteUrl', 'https://example.com', 'projects', projects))))
  on conflict (collection, id) do update set data = excluded.data;
end $$;

-- ชุดมาตรฐาน: p1 วนส่วนลด/คัพเค้ก (คูปอง 30 วัน) · p2 วนคะแนน/ไม่ได้รางวัล (คูปอง 14 วัน) · p3 วนส่วนลด (คูปอง 7 วัน) · p4 ไม่มีรายการรางวัล
-- p1_on/p1_to ใช้ทดสอบการปิดโครงการและการเลยเวลาสิ้นสุด
create function lt.std(p1_on boolean, p1_to interval) returns void language plpgsql as $$
declare pa jsonb := '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50},{"id":"pB","name":"คัพเค้ก 1 ชิ้น","kind":"reward","amount":0}]';
begin
  perform lt.cfg(jsonb_build_array(
    lt.proj('p1', p1_on, interval '-1 hour', p1_to, pa, 30),
    lt.proj('p2', true, interval '-1 hour', interval '1 day', '[{"id":"qX","name":"คะแนน 10","kind":"points","points":10},{"id":"qN","name":"ไม่ได้รางวัล","kind":"none"}]', 14),
    lt.proj('p3', true, interval '-1 hour', interval '1 day', pa, 7),
    lt.proj('p4', true, interval '-1 hour', interval '1 day', '[]', 30)));
end $$;

-- บิลหนึ่งใบ: จำนวนลุ้นเป็นรายโครงการ และประวัติการลุ้น
create function lt.token(h text, draws jsonb, exp_off interval, spins jsonb) returns void language plpgsql as $$
begin
  insert into public.punpang_records (collection, id, data) values ('luckyTokens', 'lk_' || h, jsonb_build_object(
    'tokenHash', h, 'draws', draws, 'spinCount', jsonb_array_length(spins), 'spins', spins, 'expiresAt', lt.iso(exp_off)));
end $$;

create function lt.spin(h text, c text, p text) returns jsonb language sql as $$
  select public.punpang_lucky_spin(h, c, p)
$$;

-- สมาชิกทดสอบ: lc1 ปกติ · lc2 ถูกลบแล้ว · คะแนนหมดอายุ 365 วัน
insert into public.punpang_customers (id, name, phone, data) values
  ('lc1', 'สมาชิกทดสอบ', '0810000001', '{"ledger":[],"spins":0}'),
  ('lc2', 'ถูกลบแล้ว', '0810000002', '{"ledger":[],"deleted":true}')
on conflict (id) do nothing;
insert into public.punpang_kv (collection, id, data) values ('config', 'loyalty', '{"v": {"pointExpireDays": 365}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;

create temp table lt_res (k text primary key, r jsonb);

-- ---------- A) โครงการ p1 วนตามลำดับ: A → B → A → B → A → B → ครบ 6 ครั้งของบิล ----------
select lt.std(true, interval '1 day');
select lt.token('hA1', '{"p1": 6}'::jsonb, interval '1 day', '[]'::jsonb);
insert into lt_res values ('a1', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a2', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a3', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a4', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a5', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a6', lt.spin('hA1', 'lc1', 'p1'));
insert into lt_res values ('a7', lt.spin('hA1', 'lc1', 'p1'));

select lt.ok('A1 ลุ้นครั้งที่ 1 ได้รายการแรกของโครงการ (ส่วนลด 50)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 'a1') = 'pA');
select lt.ok('A2 ส่วนลดเป็นคูปองของสมาชิก: ประเภทส่วนลด 50 บาท สถานะรอใช้ แหล่ง lucky',
  (select r->'coupon'->>'type' || '|' || (r->'coupon'->>'amount') || '|' || (r->'coupon'->>'source') || '|' || (r->'coupon'->>'status') || '|' || (r->'coupon'->>'customerId')
     from lt_res where k = 'a1') = 'discount|50|lucky|pending|lc1');
select lt.ok('A3 คูปองมีอายุตามอายุคูปองของโครงการ (30 วัน)',
  (select r->'coupon'->>'expiresAt' from lt_res where k = 'a1') = to_char(public.punpang__pts_today()::date + 30, 'YYYY-MM-DD'));
select lt.ok('A4 ลุ้นครั้งที่ 1 เหลือ 5 ใบของบิล',
  (select (r->>'remaining')::integer from lt_res where k = 'a1') = 5);
select lt.ok('A5 ลุ้นครั้งที่ 2 ได้รายการที่สองของโครงการ (คัพเค้ก) เป็นคูปองของรับที่ร้าน',
  (select r->'spin'->'prize'->>'id' || '|' || (r->'coupon'->>'type') from lt_res where k = 'a2') = 'pB|reward');
select lt.ok('A6 ลุ้นครั้งที่ 3–6 วนต่อตามลำดับ (A → B → A → B)',
  (select string_agg(r->'spin'->'prize'->>'id', ',' order by k) from lt_res where k in ('a3', 'a4', 'a5', 'a6')) = 'pA,pB,pA,pB');
select lt.ok('A7 ลุ้นครบจำนวนของบิลแล้ว ครั้งที่ 7 ทำไม่ได้ (done) และเหลือ 0 ใบ',
  (select r->>'error' from lt_res where k = 'a7') = 'done'
  and (select (r->>'remaining')::integer from lt_res where k = 'a6') = 0);
select lt.ok('A8 บิล hA1 บันทึกการลุ้นครบ 6 ครั้ง และทุกครั้งระบุโครงการ p1',
  (select jsonb_array_length(data->'spins') = 6 and not exists (select 1 from jsonb_array_elements(data->'spins') s where s->>'projectId' <> 'p1')
     from public.punpang_records where id = 'lk_hA1'));

-- ---------- B) หลายโครงการในบิลเดียว: นับและวนแยกกัน ----------
-- บิล hB1 ลุ้นโครงการ p1 ได้ 1 ครั้ง และโครงการ p2 ได้ 2 ครั้ง
select lt.token('hB1', '{"p1": 1, "p2": 2}'::jsonb, interval '1 day', '[]'::jsonb);
insert into lt_res values ('b1', lt.spin('hB1', 'lc1', 'p2'));
insert into lt_res values ('b2', lt.spin('hB1', 'lc1', 'p1'));
insert into lt_res values ('b3', lt.spin('hB1', 'lc1', 'p2'));
insert into lt_res values ('b4', lt.spin('hB1', 'lc1', 'p2'));
insert into lt_res values ('b5', lt.spin('hB1', 'lc1', 'p1'));

select lt.ok('B1 โครงการ p2 ครั้งแรกได้รายการแรกของ p2 (คะแนนสะสม) และเหลือ 1 ใบของโครงการ p2',
  (select r->'spin'->'prize'->>'id' || '|' || (r->>'remaining') from lt_res where k = 'b1') = 'qX|1'
  and (select r->'coupon' from lt_res where k = 'b1') = 'null'::jsonb);
select lt.ok('B2 คะแนนสะสมเข้าสมุดคะแนนเป็นก้อนใหม่ 10 คะแนน คงเหลือ 10 หมดอายุตามอายุคะแนนของร้าน (365 วัน)',
  (select jsonb_array_length(data->'ledger') || '|' || (data->'ledger'->0->>'delta') || '|' || (data->'ledger'->0->>'remaining') || '|' || (data->'ledger'->0->>'expiresAt') || '|' || (data->'ledger'->0->>'reason')
     from public.punpang_customers where id = 'lc1')
  = '1|10|10|' || to_char(public.punpang__pts_today()::date + 365, 'YYYY-MM-DD') || '|ลุ้นโชค: คะแนน 10');
select lt.ok('B3 โครงการ p1 นับเฉพาะการลุ้นของ p1 (6 ครั้ง) → ครั้งนี้ได้รายการแรก (ไม่นับคะแนนของ p2)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 'b2') = 'pA');
select lt.ok('B4 บิล hB1 ลุ้น p1 ครบ 1 ใบแล้ว เหลือ 0',
  (select (r->>'remaining')::integer from lt_res where k = 'b2') = 0);
select lt.ok('B5 โครงการ p2 ครั้งที่สองได้ "ไม่ได้รางวัล" (ไม่มีคูปอง ไม่มีคะแนนเพิ่ม สมุดยังมี 1 ก้อน)',
  (select r->'spin'->'prize'->>'kind' from lt_res where k = 'b3') = 'none'
  and (select r->'coupon' from lt_res where k = 'b3') = 'null'::jsonb
  and (select jsonb_array_length(data->'ledger') from public.punpang_customers where id = 'lc1') = 1);
select lt.ok('B6 โครงการที่ครบจำนวนแล้ว (p2 ครั้งที่ 3 และ p1 ครั้งที่ 2) → done',
  (select r->>'error' from lt_res where k = 'b4') = 'done'
  and (select r->>'error' from lt_res where k = 'b5') = 'done');

-- ---------- E) นับรวมทุกบิลของโครงการเดียวกัน ----------
-- p1 ลุ้นไปแล้ว 7 ครั้ง (hA1 6 ครั้ง + hB1 1 ครั้ง) → ครั้งนี้ต้องได้รายการที่สอง
select lt.token('hE1', '{"p1": 2}'::jsonb, interval '1 day', '[]'::jsonb);
insert into lt_res values ('e1', lt.spin('hE1', 'lc1', 'p1'));
insert into lt_res values ('e2', lt.spin('hE1', 'lc1', 'p1'));
select lt.ok('E1 บิลอื่นของโครงการเดียวกันนับรวม (7 ครั้งก่อนหน้า) → ได้รายการที่สอง (คัพเค้ก)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 'e1') = 'pB');
select lt.ok('E2 ครั้งถัดไปวนกลับเป็นรายการแรก และบิลหมดสิทธิ์ของโครงการนี้',
  (select r->'spin'->'prize'->>'id' || '|' || (r->>'remaining') from lt_res where k = 'e2') = 'pA|0');

-- ---------- P) คูปองใช้อายุของโครงการนั้น (p3 = 7 วัน) ----------
select lt.token('hP3', '{"p3": 1}'::jsonb, interval '1 day', '[]'::jsonb);
insert into lt_res values ('p3', lt.spin('hP3', 'lc1', 'p3'));
select lt.ok('P1 โครงการ p3 ได้รายการแรก (ส่วนลด 50) และคูปองมีอายุ 7 วันตามโครงการ',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 'p3') = 'pA'
  and (select r->'coupon'->>'expiresAt' from lt_res where k = 'p3') = to_char(public.punpang__pts_today()::date + 7, 'YYYY-MM-DD'));

-- ---------- F) โครงการที่ไม่มีรายการรางวัล (กันระบบค้าง) ----------
select lt.token('hF1', '{"p4": 1}'::jsonb, interval '1 day', '[]'::jsonb);
insert into lt_res values ('f1', lt.spin('hF1', 'lc1', 'p4'));
select lt.ok('F1 ไม่มีรายการรางวัล → ไม่มีรางวัลและไม่มีคูปอง แต่ไม่ค้าง',
  (select (r->'spin'->'prize') = 'null'::jsonb and (r->'coupon') = 'null'::jsonb and (r->>'ok') = 'true' from lt_res where k = 'f1')
  and (select jsonb_array_length(data->'ledger') from public.punpang_customers where id = 'lc1') = 1);

-- ---------- C) โครงการปิด / เลยเวลาสิ้นสุด → closed ----------
select lt.token('hC1', '{"p1": 3}'::jsonb, interval '1 day', '[]'::jsonb);
select lt.std(false, interval '1 day');
select lt.ok('C1 โครงการปิดอยู่ → closed', (select lt.spin('hC1', 'lc1', 'p1')->>'error') = 'closed');
select lt.std(true, interval '-1 minute');
select lt.ok('C2 เลยเวลาสิ้นสุดของโครงการแล้ว → closed', (select lt.spin('hC1', 'lc1', 'p1')->>'error') = 'closed');
select lt.std(true, interval '1 day');

-- ---------- D) โทเคนหมดเวลา / ไม่มีในระบบ / สมาชิกถูกลบ / โครงการไม่มี / บิลไม่มีสิทธิ์โครงการนั้น ----------
select lt.token('hExp', '{"p1": 2}'::jsonb, interval '-1 minute', '[]'::jsonb);
select lt.ok('D1 โทเคนหมดเวลาแล้ว → expired', (select lt.spin('hExp', 'lc1', 'p1')->>'error') = 'expired');
select lt.ok('D2 โทเคนที่ไม่มีในระบบ → not_found', (select lt.spin('nope', 'lc1', 'p1')->>'error') = 'not_found');
select lt.ok('D3 สมาชิกที่ถูกลบแล้วลุ้นไม่ได้ → no_customer', (select lt.spin('hC1', 'lc2', 'p1')->>'error') = 'no_customer');
select lt.ok('D4 โครงการที่ไม่มีในการตั้งค่า → no_project', (select lt.spin('hC1', 'lc1', 'zzz')->>'error') = 'no_project');
select lt.ok('D5 บิลที่ไม่มีสิทธิ์ของโครงการนี้ → no_draw', (select lt.spin('hB1', 'lc1', 'p3')->>'error') = 'no_draw');
delete from public.punpang_kv where collection = 'config' and id = 'shop';
select lt.ok('D6 ไม่มีการตั้งค่าลุ้นโชค → config_missing', (select lt.spin('hC1', 'lc1', 'p1')->>'error') = 'config_missing');

-- ---------- I) การย้ายชุดเดิม: ชุดเดิม (มี perBaht) → โครงการแรก legacy · บิลเดิม (draws เป็นตัวเลข) → draws/spins ของโครงการ legacy ----------
insert into public.punpang_kv (collection, id, data) values ('config', 'shop', jsonb_build_object('v', jsonb_build_object('luckyDraw', jsonb_build_object(
  'enabled', true, 'from', lt.iso(interval '-1 hour'), 'to', lt.iso(interval '1 day'), 'siteUrl', 'https://example.com', 'couponDays', 14,
  'perBaht', 100, 'itemIds', jsonb_build_array('r1'),
  'prizes', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50},{"id":"pB","name":"คัพเค้ก 1 ชิ้น","kind":"reward","amount":0}]'::jsonb))))
on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_records (collection, id, data) values ('luckyTokens', 'lk_hLegacy', jsonb_build_object(
  'tokenHash', 'hLegacy', 'draws', 2, 'spinCount', 1, 'expiresAt', lt.iso(interval '1 day'),
  'spins', jsonb_build_array(jsonb_build_object('at', lt.iso(interval '-30 minutes'), 'customerId', 'lc1',
    'prize', jsonb_build_object('id', 'pA', 'name', 'ส่วนลด 50 บาท', 'kind', 'discount', 'amount', 50), 'couponId', null, 'couponExpiresAt', null))));

\i supabase/migrations/20261116090000_punpang_lucky_projects.sql

select lt.ok('I1 ชุดเดิมกลายเป็นโครงการแรก id legacy แบบซื้อสินค้าที่เลือก อายุคูปองและรายการรางวัลเดิม',
  (select (data->'v'->'luckyDraw'->'projects'->0->>'id') || '|' || (data->'v'->'luckyDraw'->'projects'->0->>'kind') || '|'
          || (data->'v'->'luckyDraw'->'projects'->0->>'couponDays') || '|' || jsonb_array_length(data->'v'->'luckyDraw'->'projects'->0->'prizes')
     from public.punpang_kv where collection = 'config' and id = 'shop') = 'legacy|items|14|2');
select lt.ok('I2 ค่า ทุกกี่บาท (perBaht) ไม่อยู่ในรูปแบบใหม่',
  (select (data->'v'->'luckyDraw'->>'perBaht') is null from public.punpang_kv where collection = 'config' and id = 'shop'));
select lt.ok('I3 บิลเดิม draws กลายเป็นรายโครงการ { legacy: 2 } และการลุ้นเดิมระบุโครงการ legacy',
  (select (data->'draws') = '{"legacy": 2}'::jsonb and (data->'spins'->0->>'projectId') = 'legacy'
     from public.punpang_records where id = 'lk_hLegacy'));
insert into lt_res values ('i1', lt.spin('hLegacy', 'lc1', 'legacy'));
select lt.ok('I4 ลุ้นบิลเดิมต่อได้ในโครงการ legacy: การลุ้นเดิม 1 ครั้งนับเป็นตำแหน่ง → ได้รายการที่สอง และเหลือ 0',
  (select r->'spin'->'prize'->>'id' || '|' || (r->>'remaining') from lt_res where k = 'i1') = 'pB|0');

-- I5) ชุดเดิมที่ยังไม่เคยตั้งค่า (ค่าเริ่มต้น ปิดอยู่ ไม่มีรางวัลและสินค้า) → ไม่สร้างโครงการ และไม่มีคีย์เดิม
update public.punpang_kv set data = jsonb_build_object('v', jsonb_build_object('luckyDraw', jsonb_build_object(
  'enabled', false, 'from', '', 'to', '', 'siteUrl', 'https://example.com', 'couponDays', 30, 'perBaht', 100,
  'itemIds', '[]'::jsonb, 'prizes', '[]'::jsonb)))
where collection = 'config' and id = 'shop';
\i supabase/migrations/20261116090000_punpang_lucky_projects.sql
select lt.ok('I5 ชุดเดิมที่ยังไม่เคยตั้งค่าไม่สร้างโครงการ (projects ว่าง) และไม่มีคีย์เดิม',
  (select (jsonb_array_length(data->'v'->'luckyDraw'->'projects') = 0) and ((data->'v'->'luckyDraw'->>'perBaht') is null)
     from public.punpang_kv where collection = 'config' and id = 'shop'));

-- ---------- G) สิทธิ์การเรียก: เฉพาะ service_role (Edge Function) ----------
select lt.ok('G1 ผู้ไม่ได้ล็อกอิน (anon) เรียกลุ้นไม่ได้',
  not has_function_privilege('anon', 'public.punpang_lucky_spin(text,text,text)', 'EXECUTE'));
select lt.ok('G2 ผู้ล็อกอินฝั่งแอป (authenticated) เรียกลุ้นไม่ได้',
  not has_function_privilege('authenticated', 'public.punpang_lucky_spin(text,text,text)', 'EXECUTE'));
select lt.ok('G3 service_role เรียกลุ้นได้',
  has_function_privilege('service_role', 'public.punpang_lucky_spin(text,text,text)', 'EXECUTE'));
select lt.ok('G4 ไม่มีลายเซ็นเดิม (2 พารามิเตอร์) เหลืออยู่',
  not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
               where n.nspname = 'public' and p.proname = 'punpang_lucky_spin' and p.pronargs = 2));

select 'ผ่านทั้งหมด' as lucky_tests;
