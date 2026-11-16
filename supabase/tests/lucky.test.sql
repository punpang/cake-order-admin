-- ทดสอบลุ้นโชค (สมาชิก) ระดับฐานข้อมูล: punpang_lucky_spin · รันโดย run.sh หลัง migration ทุกไฟล์และ security.test.sql
-- แต่ละข้อใช้ lt.ok(ชื่อ, เงื่อนไข) · เงื่อนไขไม่เป็นจริง = ล้มทันที (psql จบด้วยรหัสผิดพลาด)

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

-- ตั้งค่า shop.luckyDraw (ช่วงเวลาเทียบกับตอนนี้)
create function lt.cfg(enabled boolean, from_off interval, to_off interval, prizes jsonb) returns void language plpgsql as $$
begin
  insert into public.punpang_kv (collection, id, data) values ('config', 'shop', jsonb_build_object('v', jsonb_build_object('luckyDraw', jsonb_build_object(
    'enabled', enabled, 'from', lt.iso(from_off), 'to', lt.iso(to_off), 'couponDays', 30, 'perBaht', 100,
    'itemIds', jsonb_build_array('r1'), 'prizes', prizes))))
  on conflict (collection, id) do update set data = excluded.data;
end $$;

-- บิลหนึ่งใบ (โทเคนที่เก็บเป็น hash) จำนวนลุ้น และประวัติการลุ้น
create function lt.token(h text, draws integer, exp_off interval, spins jsonb) returns void language plpgsql as $$
begin
  insert into public.punpang_records (collection, id, data) values ('luckyTokens', 'lk_' || h, jsonb_build_object(
    'tokenHash', h, 'draws', draws, 'spinCount', jsonb_array_length(spins), 'spins', spins, 'expiresAt', lt.iso(exp_off)));
end $$;

create function lt.spin(h text, c text) returns jsonb language sql as $$
  select public.punpang_lucky_spin(h, c)
$$;

-- สมาชิกทดสอบ: lc1 ปกติ · lc2 ถูกลบแล้ว
insert into public.punpang_customers (id, name, phone, data) values
  ('lc1', 'สมาชิกทดสอบ', '0810000001', '{"ledger":[],"spins":0}'),
  ('lc2', 'ถูกลบแล้ว', '0810000002', '{"ledger":[],"deleted":true}')
on conflict (id) do nothing;

create temp table lt_res (k text primary key, r jsonb);

-- ---------- A) ออกตามลำดับ + จำนวนต่อรางวัล ----------
select lt.cfg(true, interval '-1 hour', interval '1 day',
  '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":1},
    {"id":"pB","name":"คัพเค้ก 1 ชิ้น","kind":"reward","amount":0,"quota":2}]'::jsonb);
select lt.token('hT1', 4, interval '1 day', '[]'::jsonb);
insert into lt_res values ('s1', lt.spin('hT1', 'lc1'));
insert into lt_res values ('s2', lt.spin('hT1', 'lc1'));
insert into lt_res values ('s3', lt.spin('hT1', 'lc1'));
insert into lt_res values ('s4', lt.spin('hT1', 'lc1'));
insert into lt_res values ('s5', lt.spin('hT1', 'lc1'));

select lt.ok('A1 ลุ้นครั้งที่ 1 ได้รางวัลลำดับแรกที่ยังเหลือ (ส่วนลด 50)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 's1') = 'pA');
select lt.ok('A2 ส่วนลดเป็นคูปองของสมาชิก: ประเภทส่วนลด 50 บาท สถานะรอใช้ แหล่ง lucky',
  (select r->'coupon'->>'type' || '|' || (r->'coupon'->>'amount') || '|' || (r->'coupon'->>'source') || '|' || (r->'coupon'->>'status') || '|' || (r->'coupon'->>'customerId')
     from lt_res where k = 's1') = 'discount|50|lucky|pending|lc1');
select lt.ok('A3 คูปองมีอายุตามอายุของกิจกรรม (30 วัน)',
  (select r->'coupon'->>'expiresAt' from lt_res where k = 's1') = to_char(public.punpang__pts_today()::date + 30, 'YYYY-MM-DD'));
select lt.ok('A4 ลุ้นครั้งที่ 2: ส่วนลดหมดจำนวนแล้ว จึงได้ลำดับถัดไป (คัพเค้ก)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 's2') = 'pB');
select lt.ok('A5 ของรางวัลได้คูปองประเภทของรางวัล (รับที่ร้าน)',
  (select r->'coupon'->>'type' from lt_res where k = 's2') = 'reward');
select lt.ok('A6 ลุ้นครั้งที่ 3: คัพเค้กยังเหลือ 1 ใบ จึงได้อีก',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 's3') = 'pB');
select lt.ok('A7 ลุ้นครั้งที่ 4: ครบทุกรางวัลแล้ว = ไม่ได้รางวัล ไม่มีคูปอง',
  (select (r->'spin'->'prize') = 'null'::jsonb and (r->'coupon') = 'null'::jsonb from lt_res where k = 's4'));
select lt.ok('A8 ลุ้นครบจำนวนของบิลแล้ว ครั้งที่ 5 ทำไม่ได้ (done)',
  (select r->>'error' from lt_res where k = 's5') = 'done');
select lt.ok('A9 บิล hT1 บันทึกการลุ้นครบ 4 ครั้ง',
  (select jsonb_array_length(data->'spins') from public.punpang_records where id = 'lk_hT1') = 4);

-- ---------- B) นับเฉพาะการลุ้นในช่วงเปิดลุ้น (ชุด) และข้ามรางวัลที่จำนวนเป็น 0 ----------
select lt.cfg(true, interval '-1 hour', interval '1 day',
  '[{"id":"pZ","name":"ยังไม่เปิด","kind":"reward","amount":0,"quota":0},
    {"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":2}]'::jsonb);
-- ลุ้นเก่าก่อนช่วงเปิดลุ้น 2 วันของ pA ต้องไม่นับเข้าช่วงนี้
select lt.token('hOld', 1, interval '1 day',
  jsonb_build_array(jsonb_build_object('at', lt.iso(interval '-2 days'), 'customerId', 'lc1',
    'prize', jsonb_build_object('id', 'pA', 'name', 'ส่วนลด 50 บาท', 'kind', 'discount', 'amount', 50))));
select lt.token('hT3', 1, interval '1 day', '[]'::jsonb);
insert into lt_res values ('b1', lt.spin('hT3', 'lc1'));
select lt.ok('B1 นับเฉพาะช่วงนี้: ส่วนลด (pA) ยังเหลือ จึงได้ pA ข้ามรางวัลที่จำนวน 0 (pZ)',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 'b1') = 'pA');

-- ---------- C) ปิด / ยังไม่ถึง / เลยช่วงแล้ว ----------
select lt.token('hT5', 3, interval '1 day', '[]'::jsonb);
select lt.cfg(false, interval '-1 hour', interval '1 day', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":9}]'::jsonb);
select lt.ok('C1 ปิดการลุ้นอยู่ → closed', (select lt.spin('hT5', 'lc1')->>'error') = 'closed');
select lt.cfg(true, interval '1 hour', interval '2 hours', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":9}]'::jsonb);
select lt.ok('C2 ยังไม่ถึงช่วงเปิดลุ้น → closed', (select lt.spin('hT5', 'lc1')->>'error') = 'closed');
select lt.cfg(true, interval '-2 hours', interval '-1 minute', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":9}]'::jsonb);
select lt.ok('C3 เลยช่วงเปิดลุ้นแล้ว → closed', (select lt.spin('hT5', 'lc1')->>'error') = 'closed');
select lt.cfg(true, interval '-1 hour', interval '1 day', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50,"quota":9}]'::jsonb);

-- ---------- D) โทเคนหมดเวลา / ไม่มีในระบบ / สมาชิกถูกลบ ----------
select lt.token('hExp', 2, interval '-1 minute', '[]'::jsonb);
select lt.ok('D1 โทเคนหมดเวลาแล้ว → expired', (select lt.spin('hExp', 'lc1')->>'error') = 'expired');
select lt.ok('D2 โทเคนที่ไม่มีในระบบ → not_found', (select lt.spin('nope', 'lc1')->>'error') = 'not_found');
select lt.ok('D3 สมาชิกที่ถูกลบแล้วลุ้นไม่ได้ → no_customer', (select lt.spin('hT5', 'lc2')->>'error') = 'no_customer');

-- ---------- E) นับรวมทุกบิลในช่วงเดียวกัน ----------
insert into lt_res values ('s6', lt.spin('hT5', 'lc1'));
select lt.ok('E1 บิลอื่นในช่วงเดียวกันนับรวม: pA ใช้ไป 2 จาก 9 จึงยังได้ pA',
  (select r->'spin'->'prize'->>'id' from lt_res where k = 's6') = 'pA');

-- ---------- F) สิทธิ์การเรียก: เฉพาะ service_role (Edge Function) ----------
select lt.ok('F1 ผู้ไม่ได้ล็อกอิน (anon) เรียกลุ้นไม่ได้',
  not has_function_privilege('anon', 'public.punpang_lucky_spin(text,text)', 'EXECUTE'));
select lt.ok('F2 ผู้ล็อกอินฝั่งแอป (authenticated) เรียกลุ้นไม่ได้',
  not has_function_privilege('authenticated', 'public.punpang_lucky_spin(text,text)', 'EXECUTE'));
select lt.ok('F3 service_role เรียกลุ้นได้',
  has_function_privilege('service_role', 'public.punpang_lucky_spin(text,text)', 'EXECUTE'));

select 'ผ่านทั้งหมด' as lucky_tests;
