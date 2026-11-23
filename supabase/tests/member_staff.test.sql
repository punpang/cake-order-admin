-- ทดสอบฟังก์ชันฝั่งพนักงานของระดับสมาชิก (migration 20261122110200)
-- รันโดย run.sh หลัง member_levels.test.sql · ผู้จัดการ = cccc… (manage) · พนักงานขาย = dddd… (pos เท่านั้น) · ผู้ไม่มีสิทธิ์ = 9999…
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น msf_ · ทำในธุรกรรมที่ย้อนกลับ · ใช้วันที่ปัจจุบันของธุรกรรม (รายงานนับย้อนจากวันนี้)

begin;

-- ---------- ตัวช่วย (pg_temp หายเมื่อจบธุรกรรม) ----------
create function pg_temp.msf_today() returns date language sql stable as $$ select (now() at time zone 'Asia/Bangkok')::date $$;
create function pg_temp.msf_mode(m text) returns void language sql as $$
  insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels', jsonb_build_object('v', jsonb_build_object('mode', m)))
  on conflict (collection, id) do update set data = excluded.data
$$;
create function pg_temp.msf_card(p_c text) returns jsonb language sql as $$
  select test.rpc_as('dddddddd-0000-4000-8000-000000000004', format('select public.punpang_member_staff_card(%L)', p_c))
$$;
create function pg_temp.msf_quote(p_c text, p_base numeric, p_vat numeric default 7) returns jsonb language sql as $$
  select test.rpc_as('dddddddd-0000-4000-8000-000000000004', format('select public.punpang_member_quote(%L, %s, %s)', p_c, p_base, p_vat))
$$;
create function pg_temp.msf_report(p_days int default 30) returns jsonb language sql as $$
  select test.rpc_as('cccccccc-0000-4000-8000-000000000003', format('select public.punpang_member_report(%s, 0.4)', p_days))
$$;

-- ---------- เตรียมข้อมูล ----------
insert into public.punpang_kv (collection, id, data) values
  ('config', 'loyalty', '{"v":{"earnPer":100,"pointValue":0.1,"spinPer":500,"pointExpireDays":365}}'),
  ('config', 'pointPromos', '{"v":[]}')
on conflict (collection, id) do update set data = excluded.data;
delete from public.punpang_kv where collection = 'config' and id = 'memberLevels';

insert into auth.users (id, email) values
  ('cccccccc-0000-4000-8000-000000000003', 'msf-admin@example.test'),
  ('dddddddd-0000-4000-8000-000000000004', 'msf-pos@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms, active) values
  ('cccccccc-0000-4000-8000-000000000003', 'ผู้ดูแลทดสอบ msf', 'admin', array['manage'], true),
  ('dddddddd-0000-4000-8000-000000000004', 'พนักงานขายทดสอบ msf', 'sales', array['pos'], true)
on conflict do nothing;

insert into public.punpang_customers (id, name, data) values
  ('msf_new', 'สมาชิกทดสอบ msf ใหม่', '{"ledger":[],"spins":0}'),
  ('msf_lv2', 'สมาชิกทดสอบ msf LV2', '{"ledger":[],"spins":0}'),
  ('msf_del', 'สมาชิกทดสอบ msf ลบแล้ว', '{"ledger":[],"spins":0,"deleted":true}');

-- msf_lv2: ต่ออายุวันนี้ด้วยยอด 1000 (ถึงขั้น LV2 · ใช้สิทธิ์อยู่)
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult) values
  ('msf_lv2', 'msf_o1', 'spend', now(), pg_temp.msf_today(), 1000, 140, 1);

-- ---------- S) ป้ายระดับของพนักงาน ----------
select test.ok('S1 โหมดปิด (ค่าเริ่มต้น): ป้ายระดับไม่เปิด (enabled = false)',
  (pg_temp.msf_card('msf_lv2')->>'enabled')::boolean = false);

select pg_temp.msf_mode('shadow');
select test.ok('S2 โหมดทดลอง: พนักงานเห็นระดับ LV2 และตัวคูณ 3',
  (pg_temp.msf_card('msf_lv2')->>'enabled')::boolean
  and (pg_temp.msf_card('msf_lv2')->>'levelNo')::int = 2
  and (pg_temp.msf_card('msf_lv2')->>'mult')::numeric = 3
  and (pg_temp.msf_card('msf_lv2')->>'mode') = 'shadow');
select test.ok('S3 ป้ายระดับไม่มียอดสะสมหรือสมุดแต้ม (ไม่มีคีย์ cum / ledger / base)',
  not (pg_temp.msf_card('msf_lv2') ? 'cum')
  and not (pg_temp.msf_card('msf_lv2') ? 'ledger')
  and not (pg_temp.msf_card('msf_lv2') ? 'base'));
select test.ok('S4 ผู้ไม่ใช่พนักงาน (9999…) เรียกป้ายระดับไม่ได้ (42501)',
  (test.rpc_as('99999999-9999-4999-8999-999999999999', $q$ select public.punpang_member_staff_card('msf_lv2') $q$)->>'exception') = '42501');
select test.ok('S5 ลูกค้าที่ลบแล้วหรือไม่มีในระบบ: ป้ายระดับไม่เปิด',
  (pg_temp.msf_card('msf_del')->>'enabled')::boolean = false
  and (pg_temp.msf_card('msf_none')->>'enabled')::boolean = false);

-- ---------- Q) ตัวอย่างตัวคูณก่อนชำระ (พนักงานขาย) ----------
select test.ok('Q1 โหมดทดลอง: ตัวอย่างตัวคูณ applied=false และ mult=1 (ไม่คูณจริง)',
  (pg_temp.msf_quote('msf_lv2', 100)->>'applied')::boolean = false
  and (pg_temp.msf_quote('msf_lv2', 100)->>'mult')::numeric = 1);

select pg_temp.msf_mode('live');
select test.ok('Q2 โหมดใช้จริง: ลูกค้า LV2 บิล 100 บาท ได้ตัวคูณ 3',
  (pg_temp.msf_quote('msf_lv2', 100)->>'applied')::boolean
  and (pg_temp.msf_quote('msf_lv2', 100)->>'mult')::numeric = 3);
select test.ok('Q3 โหมดใช้จริง: ลูกค้าใหม่ (ยังไม่มียอด) ได้ตัวคูณ 1',
  (pg_temp.msf_quote('msf_new', 100)->>'mult')::numeric = 1);
select test.ok('Q4 ยอดติดลบ = ข้อมูลไม่ถูกต้อง (invalid)',
  (pg_temp.msf_quote('msf_lv2', -1)->>'error') = 'invalid');
select test.ok('Q5 ลูกค้าที่ลบแล้ว: applied=false และ mult=1',
  (pg_temp.msf_quote('msf_del', 100)->>'applied')::boolean = false
  and (pg_temp.msf_quote('msf_del', 100)->>'mult')::numeric = 1);

-- ---------- R) รายงาน (ผู้จัดการเท่านั้น) ----------
select test.ok('R1 พนักงานขาย (pos) เรียกรายงานไม่ได้ (42501)',
  (test.rpc_as('dddddddd-0000-4000-8000-000000000004', $q$ select public.punpang_member_report(30, 0.4) $q$)->>'exception') = '42501');

create temp table msf_snap (k text primary key, j jsonb);
insert into msf_snap values ('before', pg_temp.msf_report(30));
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult) values
  ('msf_new', 'msf_o2', 'spend', now(), pg_temp.msf_today(), 500, 140, 1),
  ('msf_lv2', 'msf_o3', 'spend', now(), pg_temp.msf_today(), 100, 140, 3);
insert into msf_snap values ('after', pg_temp.msf_report(30));

select test.ok('R2 ยอดฐานเพิ่ม 600 บาท และแต้มเพิ่ม 2 แต้ม (ผลต่างก่อนกับหลังบันทึก)',
  (select (a.j->'total'->>'base')::numeric - (b.j->'total'->>'base')::numeric from msf_snap a, msf_snap b where a.k = 'after' and b.k = 'before') = 600
  and (select (a.j->'total'->>'extraPoints')::numeric - (b.j->'total'->>'extraPoints')::numeric from msf_snap a, msf_snap b where a.k = 'after' and b.k = 'before') = 2);
select test.ok('R2b จัดกลุ่มตามระดับปัจจุบัน: LV1 มี 1 คน (msf_new) และ LV2 มี 1 คน (msf_lv2)',
  (select (j->'levels'->0->>'members')::int = 1 and (j->'levels'->1->>'members')::int = 1 from msf_snap where k = 'after'));
select test.ok('R3 รายงานมี 4 ระดับตามค่าเริ่มต้น',
  (select jsonb_array_length(j->'levels') = 4 from msf_snap where k = 'after'));
select test.ok('R4 ต้นทุนรวม (%) ตรงกับสูตร แต้มเพิ่ม × มูลค่าแต้ม × อัตราแลกคืน ÷ ยอดฐาน × 100 (ต่างไม่เกิน 0.02)',
  (select abs((j->'total'->>'costPct')::numeric
            - (j->'total'->>'extraPoints')::numeric * (j->>'pointValue')::numeric * (j->>'redeem')::numeric / (j->'total'->>'base')::numeric * 100) <= 0.02
     from msf_snap where k = 'after'));
select test.ok('R4b ต้นทุนสูตรเต็มรวม = (แต้มเพิ่ม + แต้มปกติ) × มูลค่าแต้ม × อัตราแลกคืน ÷ ยอดฐาน × 100 (ต่างไม่เกิน 0.02)',
  (select abs((j->'total'->>'fullCostPct')::numeric
            - ((j->'total'->>'extraPoints')::numeric + (j->'total'->>'base')::numeric / (j->>'earnPer')::numeric)
              * (j->>'pointValue')::numeric * (j->>'redeem')::numeric / (j->'total'->>'base')::numeric * 100) <= 0.02
     from msf_snap where k = 'after'));
select test.ok('R5 จำนวนวันไม่ถูกต้อง (0) = invalid',
  (pg_temp.msf_report(0)->>'error') = 'invalid');

-- ---------- P) ความคืบหน้าขั้นถัดไปบนป้ายระดับ (migration 20261123100000) ----------
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult) values
  ('msf_lv2', 'msf_o4', 'spend', now(), pg_temp.msf_today(), 1000, 140, 1);
insert into public.punpang_customers (id, name, data) values ('msf_top', 'สมาชิกทดสอบ msf LV4', '{"ledger":[],"spins":0}');
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult) values
  ('msf_top', 'msf_o5', 'spend', now(), pg_temp.msf_today(), 7000, 140, 1);

select test.ok('P1 LV2 ยอดสะสม 2100: ขั้นถัดไป LV3 · ต้องซื้ออีก 900 · ความคืบหน้า 55%',
  (pg_temp.msf_card('msf_lv2')->>'nextName') = 'LV3'
  and (pg_temp.msf_card('msf_lv2')->>'toNext')::numeric = 900
  and (pg_temp.msf_card('msf_lv2')->>'pct')::int = 55);
select test.ok('P2 LV1 ยอดสะสม 500: ขั้นถัดไป LV2 · ต้องซื้ออีก 500 · ความคืบหน้า 50%',
  (pg_temp.msf_card('msf_new')->>'nextName') = 'LV2'
  and (pg_temp.msf_card('msf_new')->>'toNext')::numeric = 500
  and (pg_temp.msf_card('msf_new')->>'pct')::int = 50);
select test.ok('P3 ระดับสูงสุด LV4: ไม่มีขั้นถัดไป (nextName/toNext เป็น null) และความคืบหน้า 100%',
  (pg_temp.msf_card('msf_top')->>'levelNo')::int = 4
  and (pg_temp.msf_card('msf_top')->>'nextName') is null
  and (pg_temp.msf_card('msf_top')->>'toNext') is null
  and (pg_temp.msf_card('msf_top')->>'pct')::int = 100);
select test.ok('P4 ป้ายระดับที่มีความคืบหน้ายังไม่มียอดสะสม (ไม่มีคีย์ cum)',
  not (pg_temp.msf_card('msf_lv2') ? 'cum') and not (pg_temp.msf_card('msf_top') ? 'cum'));
select pg_temp.msf_mode('off');
select test.ok('P5 โหมดปิด: ไม่ส่งความคืบหน้า (enabled = false และไม่มีคีย์ nextName)',
  (pg_temp.msf_card('msf_lv2')->>'enabled')::boolean = false
  and not (pg_temp.msf_card('msf_lv2') ? 'nextName'));

rollback;
