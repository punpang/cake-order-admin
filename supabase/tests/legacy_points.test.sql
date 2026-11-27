-- ทดสอบการย้ายคะแนนจากระบบเดิม หลังปิดการย้ายแบบพนักงาน (migration 20261127440000)
-- การย้ายทำอัตโนมัติผ่าน trigger เท่านั้น · punpang_legacy_migrate คืน error 'disabled' ไม่แตะแต้มหรือยอดซื้อ
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
  ('lg_1', 'ลูกค้าย้าย 1', '0899100001', '{"ledger":[]}'::jsonb),
  ('lg_2', 'ลูกค้าย้าย 2', '0899100002', '{"ledger":[]}'::jsonb);

-- การย้ายแบบพนักงานถูกปิด: แม้แอดมินเรียก ก็ได้ 'disabled' และไม่มีการเปลี่ยนแปลงข้อมูล
select test.ok('L1 ย้ายแบบพนักงานถูกปิด: แอดมินได้ error disabled',
  (test.rpc_as('55555555-5555-5555-5555-555555555555', $q$ select public.punpang_legacy_migrate('lg_1', 10) $q$)->>'error') = 'disabled');

select test.ok('L2 ไม่มีแต้มเข้าสมุดแต้มของ lg_1 หลังเรียกฟังก์ชันที่ปิด',
  (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'lg_1') = 0);

select test.ok('L3 ไม่มีรายการยอดซื้อ (member event) ของ lg_1 หลังเรียกฟังก์ชันที่ปิด',
  (select count(*) from public.punpang_member_events where customer_id = 'lg_1') = 0);

-- การเรียกที่ไม่มีสิทธิ์ยังถูกปฏิเสธด้วย 42501 ก่อนถึงการตรวจอื่น
select test.ok('L4 ผู้ไม่มีสิทธิ์เรียกไม่ได้ (42501)',
  (test.rpc_as('99999999-9999-9999-9999-999999999999', $q$ select public.punpang_legacy_migrate('lg_2', 5) $q$)->>'exception') = '42501');

select test.ok('L5 lg_2 ยังไม่มีแต้มหลังเรียกที่ไม่มีสิทธิ์',
  (select coalesce(sum((e->>'delta')::int), 0) from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'lg_2') = 0);

rollback;
