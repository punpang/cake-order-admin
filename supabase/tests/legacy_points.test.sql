-- ทดสอบการย้ายคะแนนจากระบบเดิม (migration 20261127400000): แต้ม = เดิม × 2 × ตัวคูณสูงสุด · ระดับสูงสุดจากยอดสะสม = เกณฑ์ + 1
-- รันโดย run.sh หลัง member_levels.test.sql · ข้อมูลทดสอบใช้รหัส lg_ · ทำในธุรกรรมที่ย้อนกลับ
-- แต่ละข้อใช้ test.ok(ชื่อ, เงื่อนไข) · ไม่จริง = ล้มทันที

begin;

create or replace function test.ok(name text, cond boolean) returns void language plpgsql as $$
begin
  if cond is not true then raise exception 'FAIL: %', name; end if;
  raise notice 'PASS: %', name;
end $$;

-- ตั้งค่าระดับสมาชิกแบบใช้จริง (เหมือนค่าร้านปัจจุบัน): LV4 = 5,000 บาท · ×5
insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels', jsonb_build_object('v', jsonb_build_object(
  'mode', 'live',
  'levels', '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":500,"mult":2},{"name":"LV3","min":2500,"mult":3},{"name":"LV4","min":5000,"mult":5}]'::jsonb,
  'renewGross', 150, 'inactiveDays', 90, 'goldenDays', 14, 'downgradeDays', 365, 'bigBill', 500,
  'cakeItemIds', '[]'::jsonb, 'cakeCategories', '[]'::jsonb)))
on conflict (collection, id) do update set data = excluded.data;

insert into public.punpang_customers (id, name, phone, data) values
  ('lg_1', 'ลูกค้าย้าย 1', '0810000001', '{"ledger":[]}'::jsonb),
  ('lg_2', 'ลูกค้าย้าย 2', '0810000002', '{"ledger":[]}'::jsonb);

-- แอดมิน (มีสิทธิ์ปรับคะแนน) ย้ายแต้ม 10 → 100 แต้ม และได้ระดับสูงสุด
select test.ok('L1 ย้ายสำเร็จ: 10 แต้มเดิม ได้ 100 แต้ม',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_legacy_migrate('lg_1', 10) $q$)->>'points')::int = 100);

select test.ok('L2 แต้มในสมุดแต้มของลูกค้ารวมเป็น 100',
  (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'lg_1') = 100);

select test.ok('L3 ได้ระดับสูงสุด (LV4) จากยอดสะสมที่ใส่ไว้',
  public.punpang__member_fold('lg_1', now())->>'levelName' = 'LV4');

-- ย้ายซ้ำไม่ได้
select test.ok('L4 ย้ายซ้ำถูกปฏิเสธ (already_migrated)',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_legacy_migrate('lg_1', 10) $q$)->>'error') = 'already_migrated');

-- ค่าไม่ถูกต้อง
select test.ok('L5 แต้มเดิมเป็น 0 ถูกปฏิเสธ (invalid)',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_legacy_migrate('lg_2', 0) $q$)->>'error') = 'invalid');

select test.ok('L6 ลูกค้าที่ไม่มีอยู่ถูกปฏิเสธ (no_customer)',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_legacy_migrate('lg_none', 5) $q$)->>'error') = 'no_customer');

-- ผู้ที่ไม่มีสิทธิ์ย้ายไม่ได้
select test.ok('L7 ผู้ไม่มีสิทธิ์ย้ายคะแนนไม่ได้ (42501)',
  test.rpc_as('99999999-9999-9999-9999-999999999999', $q$ select public.punpang_legacy_migrate('lg_2', 5) $q$) like 'ERR:42501:%');

select test.ok('L8 ลูกค้า lg_2 ยังไม่ถูกย้าย (ไม่มีแต้ม)',
  (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'lg_2') = 0);

rollback;
