-- ทดสอบการล้างคะแนนค้างของออร์เดอร์ (migration 20261120200000): ล้างได้ทางเดียวคือ punpang_remove_points
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok, test.as_staff, test.rpc_as จากไฟล์นั้น) · ข้อมูลทดสอบใช้รหัสขึ้นต้น pcg_ · ทำในธุรกรรมที่ย้อนกลับ
-- ผู้ใช้: 1111… = พนักงานขาย (useLoyalty) · 5555… = แอดมิน · 3333… = ช่าง (ไม่มีสิทธิ์คะแนน)

begin;

-- ลองคำสั่งของเซิร์ฟเวอร์ (role postgres): คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>'
create function test.pcg_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

insert into public.punpang_customers (id, name, data) values
  ('pcg_c1', 'ลูกค้าคะแนนค้าง', '{"ledger":[
     {"id":"pcg_l1","delta":100,"remaining":60,"expiresAt":"2099-01-01","reason":"ซื้อ"},
     {"id":"pcg_s1","delta":-40,"reason":"ใช้คะแนนลดราคา","orderId":"pcg_o1","takes":[{"lotId":"pcg_l1","n":40}]}]}');

insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('pcg_o1', 'OR-PCG-1', 'pcg_c1', 'draft', 'pickup', 'web', '{"items":[{"retailId":"cup","unitPrice":100,"qty":1,"name":"คัพเค้ก"}],"payments":[],"adjustment":{"amount":0},"pointsUsed":{"points":40,"amount":40,"entryId":"pcg_s1"}}'),
  ('pcg_o2', 'OR-PCG-2', 'pcg_c1', 'draft', 'pickup', 'web', '{"items":[{"retailId":"cup","unitPrice":100,"qty":1,"name":"คัพเค้ก"}],"payments":[],"adjustment":{"amount":0}}');

-- PC1: แก้ pointsUsed ตรง ๆ ให้เป็นค่าว่างไม่ได้ แม้พนักงานขายจะมีสิทธิ์ useLoyalty
select test.ok('PC1: พนักงานขาย (มี useLoyalty) ล้าง pointsUsed ตรง ๆ ไม่ได้',
  test.as_staff('11111111-1111-1111-1111-111111111111',
    $q$ update public.punpang_orders set data = data || '{"pointsUsed":null}'::jsonb where id = 'pcg_o1' $q$) like 'ERR:42501:points can only be removed through the server%');

-- PC2: แอดมินก็ล้างตรง ๆ ไม่ได้ (ด่านไม่ยกเว้นตามสิทธิ์)
select test.ok('PC2: แอดมินล้าง pointsUsed ตรง ๆ ไม่ได้',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = data || '{"pointsUsed":null}'::jsonb where id = 'pcg_o1' $q$) like 'ERR:42501:points can only be removed through the server%');
-- ช่างมองไม่เห็นออร์เดอร์นี้ (อาจถูกปฏิเสธหรือไม่กระทบแถว) จึงไม่ตรวจข้อความผลลัพธ์ · ผลจริงดูจากสถานะของออร์เดอร์ในข้อ PC4
do $$ begin perform test.as_staff('33333333-3333-3333-3333-333333333333',
  $q$ update public.punpang_orders set data = data || '{"pointsUsed":null}'::jsonb where id = 'pcg_o1' $q$); end $$;

-- PC3: ฝั่งเซิร์ฟเวอร์ (role postgres) ก็ล้างตรง ๆ ไม่ได้ · ทางเดียวคือ RPC
select test.ok('PC3: เซิร์ฟเวอร์ล้าง pointsUsed ตรง ๆ ไม่ได้ (42501)',
  test.pcg_try($q$ update public.punpang_orders set data = data || '{"pointsUsed":null}'::jsonb where id = 'pcg_o1' $q$) like 'ERR:42501:%');

-- PC4: ความพยายามที่ถูกบล็อกไม่มีผล: คะแนนยังอยู่ในออร์เดอร์ และสมุดยังไม่คืน
select test.ok('PC4: หลังถูกบล็อก pointsUsed ของออร์เดอร์ยังอยู่',
  (select data->'pointsUsed' is not null and data->'pointsUsed' <> 'null'::jsonb from public.punpang_orders where id = 'pcg_o1'));
select test.ok('PC4: หลังถูกบล็อก สมุดยังไม่คืน (คะแนนที่ยังไม่คืนเหลือ 60)',
  (select sum((e->>'remaining')::int) = 60 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'pcg_c1' and (e->>'delta')::int > 0));

-- PC5: ล้างผ่าน punpang_remove_points ได้ · คืน 40 เข้าก้อนเดิม · ล้าง pointsUsed
select test.ok('PC5: พนักงานขายล้างผ่าน punpang_remove_points ได้ (ok)',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select public.punpang_remove_points('pcg_o1') $q$))->>'ok' = 'true');
select test.ok('PC5: คืนคะแนน 40 เข้าก้อนเดิม (pcg_l1 กลับเป็น 100)',
  (select (e->>'remaining')::int = 100 from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') e where c.id = 'pcg_c1' and e->>'id' = 'pcg_l1'));
select test.ok('PC5: pointsUsed ของออร์เดอร์ถูกล้างแล้ว',
  (select data->'pointsUsed' = 'null'::jsonb from public.punpang_orders where id = 'pcg_o1'));

-- PC6: งานอื่นของออร์เดอร์ยังแก้ได้ตามเดิม (ทั้งออร์เดอร์ที่ไม่มีคะแนนและที่ล้างคะแนนแล้ว)
select test.ok('PC6: แอดมินแก้ข้อมูลอื่นของออร์เดอร์ที่ไม่มีคะแนนได้',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{memo}', '"ทดสอบ"') where id = 'pcg_o2' $q$) = 'OK');
select test.ok('PC6: แอดมินแก้ข้อมูลอื่นของออร์เดอร์ที่ล้างคะแนนแล้วได้',
  test.as_staff('55555555-5555-5555-5555-555555555555',
    $q$ update public.punpang_orders set data = jsonb_set(data, '{memo}', '"ทดสอบ2"') where id = 'pcg_o1' $q$) = 'OK');

rollback;
