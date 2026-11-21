-- ทดสอบโหมดทดสอบ (schema punpang_test บนฐานข้อมูลเดียวกัน): โครงสร้างตรงกับต้นฉบับ · ไม่มีการอ้างอิง public ค้างในสำเนา ·
-- ข้อมูลทดสอบไม่ปนข้อมูลจริง · ตารางข้อมูลร่วมเขียนไม่ได้ · ฟังก์ชันในโหมดทดสอบไม่แตะข้อมูลจริง · รันซ้ำได้
-- รันโดย run.sh หลัง migration ทุกไฟล์ · แต่ละข้อใช้ mt.ok(ชื่อ, เงื่อนไข) · ไม่จริง = ล้มทันที

create schema mt;

create function mt.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- ---------- A) โครงสร้าง ----------
select mt.ok('A1 ตารางธุรกิจทุกตาราง (24) มีสำเนาเป็นตารางใน punpang_test',
  (select count(*) from information_schema.tables where table_schema = 'punpang_test' and table_type = 'BASE TABLE') = 24);
select mt.ok('A2 ตารางข้อมูลร่วม (15 · รวมบันทึกข้อผิดพลาด) เป็น view ใน punpang_test',
  (select count(*) from information_schema.views where table_schema = 'punpang_test') = 15);
select mt.ok('A3 คอลัมน์ของทุกตารางธุรกิจเท่ากับต้นฉบับ',
  not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name in (select table_name from information_schema.tables where table_schema = 'punpang_test' and table_type = 'BASE TABLE')
       and not exists (select 1 from information_schema.columns t
                        where t.table_schema = 'punpang_test' and t.table_name = c.table_name and t.column_name = c.column_name and t.data_type = c.data_type)));
select mt.ok('A4 นโยบาย RLS ของทุกตารางธุรกิจเท่ากับต้นฉบับ',
  (select count(*) from pg_policies where schemaname = 'punpang_test') = (
     select count(*) from pg_policies where schemaname = 'public' and tablename in (
       select table_name from information_schema.tables where table_schema = 'punpang_test' and table_type = 'BASE TABLE')));
select mt.ok('A5 ทริกเกอร์ของทุกตารางธุรกิจเท่ากับต้นฉบับ',
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'punpang_test' and not t.tgisinternal and c.relname <> 'punpang_test')
  = (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and not t.tgisinternal and c.relname in (
        select table_name from information_schema.tables where table_schema = 'punpang_test' and table_type = 'BASE TABLE'))
     + (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'punpang_test' and not t.tgisinternal and c.relname in (
           select table_name from information_schema.views where table_schema = 'punpang_test')));
-- ฟังก์ชันของ public ที่อ้างตารางที่ถูกลบแล้ว (punpang_points) ไม่ถูกคัดลอก (ดูหมายเหตุในไฟล์ migration)
select mt.ok('A6 ฟังก์ชันของสำเนาเท่ากับของ public ลบฟังก์ชันที่อ้างตารางที่ถูกลบ 7 ตัว',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'punpang_test' and p.proname not in ('punpang_test_sync', 'punpang_test_readonly', 'punpang_test_shift', 'punpang_test_seed'))
  = (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind in ('f', 'p')
        and p.proname not in ('punpang__pts_take', 'punpang__pts_balance', 'punpang__pts_giveback',
                              'punpang_points_earn', 'punpang_points_spend', 'punpang_points_cut', 'punpang_points_refund')
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')));

-- ---------- B) ไม่มีการอ้างอิง public ค้างในสำเนา (กันการแตะข้อมูลจริง) ----------
-- ตรวจทีละฟังก์ชัน (เลี่ยงให้ตัววางแผนคำสั่งเรียก pg_get_functiondef กับ aggregate ของ pg_catalog)
do $$
declare r record; bad integer := 0;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'punpang_test' and p.prokind in ('f', 'p')
              and p.proname not in ('punpang_test_sync', 'punpang_test_readonly') loop
    if pg_get_functiondef(r.oid) ~ '\mpublic\.' then bad := bad + 1; end if;
  end loop;
  perform mt.ok('B1 ฟังก์ชันในโหมดทดสอบไม่อ้างอิง public', bad = 0);
end $$;
select mt.ok('B2 นโยบาย RLS ในโหมดทดสอบไม่อ้างอิง public',
  not exists (select 1 from pg_policies where schemaname = 'punpang_test'
               and (coalesce(qual, '') ~ '\mpublic\.' or coalesce(with_check, '') ~ '\mpublic\.')));
select mt.ok('B3 ทริกเกอร์ในโหมดทดสอบไม่อ้างอิง public',
  not exists (select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'punpang_test' and not t.tgisinternal and pg_get_triggerdef(t.oid) ~ '\mpublic\.'));
select mt.ok('B4 ค่าเริ่มต้นและ CHECK ในโหมดทดสอบไม่อ้างอิง public',
  not exists (select 1 from pg_attrdef d join pg_class c on c.oid = d.adrelid join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'punpang_test' and pg_get_expr(d.adbin, d.adrelid) ~ '\mpublic\.')
  and not exists (select 1 from pg_constraint k join pg_namespace n on n.oid = k.connamespace
               where n.nspname = 'punpang_test' and pg_get_constraintdef(k.oid) ~ '\mpublic\.'));

-- ---------- C) สิทธิ์การเข้าถึง ----------
select mt.ok('C1 anon เข้า schema punpang_test ไม่ได้',
  not has_schema_privilege('anon', 'punpang_test', 'USAGE'));
select mt.ok('C2 authenticated เข้า schema punpang_test ได้',
  has_schema_privilege('authenticated', 'punpang_test', 'USAGE'));
select mt.ok('C3 anon เรียกลุ้นของโหมดทดสอบไม่ได้',
  not has_function_privilege('anon', 'punpang_test.punpang_lucky_spin(text,text,text)', 'EXECUTE'));
select mt.ok('C4 service_role เรียกลุ้นของโหมดทดสอบได้',
  has_function_privilege('service_role', 'punpang_test.punpang_lucky_spin(text,text,text)', 'EXECUTE'));

-- ---------- D) ข้อมูลแยกจากข้อมูลจริง ----------
insert into public.punpang_records (collection, id, data) values ('bell', 'live_r1', '{"live":true}') on conflict do nothing;
do $$
declare live_before bigint; test_before bigint;
begin
  select count(*) into live_before from public.punpang_records;
  select count(*) into test_before from punpang_test.punpang_records;
  insert into punpang_test.punpang_records (collection, id, data) values ('bell', 'test_r1', '{"test":true}');
  perform mt.ok('D1 ข้อมูลทดสอบเพิ่มในสำเนาเท่านั้น (ข้อมูลจริงไม่เปลี่ยน)',
    (select count(*) from public.punpang_records) = live_before
    and (select count(*) from punpang_test.punpang_records) = test_before + 1
    and not exists (select 1 from public.punpang_records where id = 'test_r1'));
end $$;
select mt.ok('D2 ข้อมูลจริงที่มีอยู่ไม่ปรากฏในสำเนา',
  not exists (select 1 from punpang_test.punpang_records where id = 'live_r1'));

-- ---------- E) ตารางข้อมูลร่วม: อ่านได้ เขียนไม่ได้ ----------
select mt.ok('E1 อ่านข้อมูลร่วมจากโหมดทดสอบได้ (การตั้งค่าร้านใช้ร่วมกัน)',
  (select count(*) from punpang_test.punpang_kv) >= 0);
do $$
declare caught text := '';
begin
  begin
    insert into punpang_test.punpang_kv (collection, id, data) values ('config', 'test_try', '{}');
  exception when others then caught := sqlstate;
  end;
  perform mt.ok('E2 เขียนการตั้งค่าร้านจากโหมดทดสอบไม่ได้ (ปฏิเสธด้วย 42501)', caught = '42501');
end $$;
select mt.ok('E3 ทุก view ของข้อมูลร่วมมีทริกเกอร์ปฏิเสธการเขียน (15 รายการ)',
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'punpang_test' and t.tgname = 'punpang_test_readonly') = 15);
select mt.ok('E4 ข้อมูลร่วมในฐานจริงไม่ถูกแตะ (ไม่มีแถว test_try)',
  not exists (select 1 from public.punpang_kv where id = 'test_try'));

-- ---------- F) ฟังก์ชันของโหมดทดสอบใช้สำเนา ไม่แตะของจริง ----------
-- พนักงานทดสอบ (ผู้ใช้จำลอง) สำหรับเรียกฟังก์ชันที่ตรวจสิทธิ์พนักงาน
insert into auth.users (id, email) values ('aaaaaaaa-0000-4000-8000-000000000001', 'mt-admin@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms, active) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'ทดสอบโหมด', 'admin', array['manage', 'pos', 'useLoyalty', 'adjustPoints'], true)
on conflict do nothing;
do $$
declare live_counters_before bigint;
begin
  select count(*) into live_counters_before from public.punpang_counters;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  execute 'set local role authenticated';
  perform punpang_test.punpang_alloc_numbers('OR', '261116', 2);
  execute 'reset role';
  perform mt.ok('F2 ตัวนับของโหมดทดสอบเพิ่มในสำเนา และตัวนับจริงไม่เปลี่ยน',
    (select count(*) from public.punpang_counters) = live_counters_before
    and (select count(*) from punpang_test.punpang_counters where prefix = 'OR' and day = '261116') = 1);
end $$;

-- การลุ้นในโหมดทดสอบ: โทเคนและสมาชิกของสำเนา · การตั้งค่าลุ้นอ่านจากข้อมูลร่วม (เขียนจากโหมดทดสอบไม่ได้)
insert into public.punpang_kv (collection, id, data) values ('config', 'shop', jsonb_build_object('v', jsonb_build_object('luckyDraw',
  jsonb_build_object('siteUrl', 'https://example.com', 'projects', jsonb_build_array(jsonb_build_object(
    'id', 'pjT', 'name', 'ทดสอบ', 'enabled', true, 'kind', 'items', 'itemIds', jsonb_build_array('r1'),
    'everyBaht', null, 'from', to_char(now() - interval '1 hour', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'to', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'couponDays', 30,
    'prizes', '[{"id":"pA","name":"ส่วนลด 50 บาท","kind":"discount","amount":50}]'::jsonb))))))
on conflict (collection, id) do update set data = excluded.data;
insert into punpang_test.punpang_customers (id, name, phone, data) values ('tc1', 'ทดสอบ', '0800000001', '{"ledger":[],"spins":0}');
insert into punpang_test.punpang_records (collection, id, data) values ('luckyTokens', 'lk_test', jsonb_build_object(
  'tokenHash', 'hTEST', 'draws', jsonb_build_object('pjT', 1), 'spinCount', 0, 'spins', '[]'::jsonb,
  'expiresAt', to_char(now() + interval '1 day', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
do $$
declare live_tokens_before bigint; live_coupons_before bigint; res jsonb;
begin
  select count(*) into live_tokens_before from public.punpang_records where collection = 'luckyTokens';
  select count(*) into live_coupons_before from public.punpang_records where collection = 'coupons';
  res := punpang_test.punpang_lucky_spin('hTEST', 'tc1', 'pjT');
  perform mt.ok('F3 การลุ้นในโหมดทดสอบสำเร็จและได้รางวัลจากการตั้งค่าร้าน',
    (res->>'ok') = 'true' and (res->'spin'->'prize'->>'id') = 'pA');
  perform mt.ok('F4 คูปองและประวัติการลุ้นเกิดในสำเนาเท่านั้น (ข้อมูลจริงไม่เปลี่ยน)',
    (select count(*) from public.punpang_records where collection = 'luckyTokens') = live_tokens_before
    and (select count(*) from public.punpang_records where collection = 'coupons') = live_coupons_before
    and (select count(*) from punpang_test.punpang_records where collection = 'coupons') >= 1
    and (select jsonb_array_length(data->'spins') from punpang_test.punpang_records where id = 'lk_test') = 1);
end $$;

-- ---------- G) การตรวจโครงสร้างซ้ำได้ และกันการเพิ่มตารางที่ยังไม่จัดประเภท ----------
select punpang_test.punpang_test_sync();
select mt.ok('G1 รัน sync ซ้ำได้โดยข้อมูลทดสอบยังอยู่',
  (select count(*) from punpang_test.punpang_records where id = 'test_r1') = 1);
create table public.punpang_unclassified_probe (id int);
do $$
declare caught text := '';
begin
  begin
    perform punpang_test.punpang_test_sync();
  exception when others then caught := sqlerrm;
  end;
  perform mt.ok('G2 ตารางใหม่ที่ยังไม่จัดประเภททำให้ sync ล้ม (ให้จัดประเภทก่อน)', caught like '%ยังไม่ได้จัดประเภท%');
end $$;
drop table public.punpang_unclassified_probe;

-- ---------- H) ปุ่มล้างข้อมูลทดสอบ: ล้างเฉพาะสำเนา แล้วใส่ชุดตัวอย่าง ----------
do $$
declare live_before bigint; live_orders_before bigint;
begin
  select count(*) into live_before from public.punpang_records;
  select count(*) into live_orders_before from public.punpang_orders;
  perform set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-4000-8000-000000000001', true);
  execute 'set local role authenticated';
  perform punpang_test.punpang_reset_test_data();
  execute 'reset role';
  perform mt.ok('H1 ล้างข้อมูลทดสอบ: ไม่มีบันทึกทั่วไปค้าง และข้อมูลจริงไม่เปลี่ยน',
    (select count(*) from punpang_test.punpang_records) = 0 and (select count(*) from public.punpang_records) = live_before);
  perform mt.ok('H2 หลังล้างใส่ชุดตัวอย่าง: มีลูกค้า ออร์เดอร์ ตัวนับ ทุกเลขขึ้นต้น TEST- และออร์เดอร์จริงไม่เปลี่ยน',
    (select count(*) from punpang_test.punpang_customers) > 0
    and (select count(*) from punpang_test.punpang_orders) > 0
    and (select count(*) from punpang_test.punpang_counters) > 0
    and not exists (select 1 from punpang_test.punpang_orders where code not like 'TEST-%')
    and (select count(*) from public.punpang_orders) = live_orders_before);
  perform mt.ok('H3 เลื่อนวันที่และเลขเอกสารของชุดตัวอย่างถูกต้องข้ามเดือน',
    punpang_test.punpang_test_shift('{"at":"2026-11-29T10:00:00.000Z","d":"2026-11-16","code":"TEST-OR-291126-000001","pay":["TEST-PAY-161126-00002"],"n":5}'::jsonb, 3)
    = '{"at":"2026-12-02T10:00:00.000Z","d":"2026-11-19","code":"TEST-OR-021226-000001","pay":["TEST-PAY-191126-00002"],"n":5}'::jsonb);
  perform mt.ok('H4 หลังล้างมีแถวสถานะปิดงวดบัญชี (แอปโหลดบัญชีได้)',
    (select count(*) from punpang_test.punpang_acct_state where id = 1) = 1);
end $$;

select 'ผ่านทั้งหมด' as mirror_tests;
