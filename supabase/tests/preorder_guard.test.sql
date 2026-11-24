-- ทดสอบกติกาแคมเปญสั่งล่วงหน้าที่ฐานข้อมูลบังคับ (migration 20261127130000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- G1–G9: เปิดรับต้องมีสินค้าที่ถูกต้อง · G10–G14: แก้โครงสร้างไม่ได้เมื่อเปิดรับหรือมีการจองแล้ว

begin;

insert into auth.users (id, email) values ('d7000000-0000-4000-8000-000000000011', 'pg_mgr@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d7000000-0000-4000-8000-000000000011', 'ผู้จัดการสั่งล่วงหน้า', 'admin', '{managePreorder}');

-- สินค้าทดสอบ: ใช้ได้ 1 รายการ และรายการที่ผิดกติกาทีละข้อ
insert into public.punpang_items (id, kind, name, price, active, data) values
  ('gx1', 'retail', 'ใช้ได้', 100, true, '{}'),
  ('gx2', 'retail', 'ปิดขาย', 100, false, '{}'),
  ('gx3', 'retail', 'กำหนดราคาเอง', 0, true, '{"openPrice":true}'),
  ('gx4', 'retail', 'มีตัวเลือก', 100, true, '{"modifierIds":["m1"]}'),
  ('gx5', 'cake', 'ไม่ใช่สินค้าหน้าร้าน', 100, true, '{}');

create function test.pgd_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- ตัวช่วย: แคมเปญทดสอบ 1 รายการ (ทำโดยระบบ ไม่ผ่านสิทธิ์พนักงาน)
create function test.pgd_camp(cid text, st text, items jsonb) returns text language sql as $$
  select test.pgd_try(format(
    'insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
     values (%L, %L, ''2000-01-01'', ''2099-12-31'', ''2099-12-24'', ''2099-12-26'', 50, 120, %L)',
    cid, st, jsonb_build_object('name', cid, 'dayCap', null, 'items', items)))
$$;

-- G1–G6: เปิดรับ (สร้างเป็นเปิดรับ) ต้องมีสินค้าที่ถูกต้อง
select test.ok('G1 เปิดรับแต่ไม่มีสินค้า → campaign_no_items (23514)',
  test.pgd_camp('pg_g1', 'open', '[]'::jsonb) like 'ERR:23514:campaign_no_items%');
select test.ok('G2 สินค้าไม่มีในคลัง → campaign_bad_item',
  test.pgd_camp('pg_g2', 'open', '[{"retailId":"ghost","dayCap":null}]'::jsonb) like 'ERR:23514:campaign_bad_item%');
select test.ok('G3 สินค้าปิดขาย → campaign_bad_item',
  test.pgd_camp('pg_g3', 'open', '[{"retailId":"gx2","dayCap":null}]'::jsonb) like 'ERR:23514:campaign_bad_item%');
select test.ok('G4 สินค้ากำหนดราคาเอง → campaign_bad_item',
  test.pgd_camp('pg_g4', 'open', '[{"retailId":"gx3","dayCap":null}]'::jsonb) like 'ERR:23514:campaign_bad_item%');
select test.ok('G5 สินค้ามีตัวเลือก → campaign_bad_item',
  test.pgd_camp('pg_g5', 'open', '[{"retailId":"gx4","dayCap":null}]'::jsonb) like 'ERR:23514:campaign_bad_item%');
select test.ok('G6 ไม่ใช่สินค้าหน้าร้าน (kind ≠ retail) → campaign_bad_item',
  test.pgd_camp('pg_g6', 'open', '[{"retailId":"gx5","dayCap":null}]'::jsonb) like 'ERR:23514:campaign_bad_item%');
-- G7 ร่างไม่บังคับสินค้า · G8 เปิดรับด้วยสินค้าที่ถูกต้องได้
select test.ok('G7 ร่างที่ยังไม่มีสินค้าบันทึกได้',
  test.pgd_camp('pg_g7', 'draft', '[]'::jsonb) = 'OK');
select test.ok('G8 เปิดรับด้วยสินค้าที่ถูกต้องได้',
  test.pgd_camp('pg_g8', 'open', '[{"retailId":"gx1","dayCap":null}]'::jsonb) = 'OK');

-- G9 เปลี่ยนจากร่างเป็นเปิดรับ ต้องผ่านด่านเดียวกัน
select test.ok('G9 ร่างที่ไม่มีสินค้า เปลี่ยนเป็นเปิดรับไม่ได้',
  test.pgd_try($$update public.punpang_preorder_campaigns set status = 'open' where id = 'pg_g7'$$) like 'ERR:23514:campaign_no_items%');

-- G10 เปิดรับแล้ว แก้เวลารับสินค้าไม่ได้ (ผ่านสิทธิ์พนักงานจริง)
select test.ok('G10 พนักงานแก้วันรับของแคมเปญที่เปิดรับไม่ได้ (23514)',
  left(test.as_staff('d7000000-0000-4000-8000-000000000011',
    $$update public.punpang_preorder_campaigns set pickup_to = '2100-01-31' where id = 'pg_g8'$$), 10) = 'ERR:23514:');
-- G11 แก้ชื่อของแคมเปญที่เปิดรับได้
select test.ok('G11 แก้ชื่อแคมเปญที่เปิดรับได้',
  test.as_staff('d7000000-0000-4000-8000-000000000011',
    $$update public.punpang_preorder_campaigns set data = jsonb_set(data, '{name}', '"ใหม่"') where id = 'pg_g8'$$) = 'OK');

-- G12 ปิดรับแล้ว แต่มีโควตาจองอยู่ → แก้เพดานไม่ได้
select test.pgd_camp('pg_g12', 'closed', '[{"retailId":"gx1","dayCap":null}]'::jsonb);
insert into public.punpang_preorder_slots (campaign_id, pickup_date, item_id, reserved)
  values ('pg_g12', '2099-12-24', 'gx1', 1);
select test.ok('G12 ปิดรับที่มีโควตาจองแล้ว แก้เพดานไม่ได้',
  test.pgd_try($$update public.punpang_preorder_campaigns set data = jsonb_set(data, '{dayCap}', '5') where id = 'pg_g12'$$) like 'ERR:23514:campaign_locked%');

-- G13 ปิดรับแล้ว แต่มีออร์เดอร์ → แก้วันรับไม่ได้
select test.pgd_camp('pg_g13', 'closed', '[{"retailId":"gx1","dayCap":null}]'::jsonb);
insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date)
  values ('po_pg13', 'pg_g13', 'PRE-241124-900013', 'awaiting_payment', '2099-12-24');
select test.ok('G13 ปิดรับที่มีออร์เดอร์แล้ว แก้วันรับไม่ได้',
  test.pgd_try($$update public.punpang_preorder_campaigns set pickup_to = '2099-12-31' where id = 'pg_g13'$$) like 'ERR:23514:campaign_locked%');

-- G14 ปิดรับและยังไม่มีการจอง แก้โครงสร้างได้ · ปิดรับแล้วเปิดกลับได้ถ้าสินค้ายังถูกต้อง
select test.pgd_camp('pg_g14', 'closed', '[{"retailId":"gx1","dayCap":null}]'::jsonb);
select test.ok('G14a ยังไม่มีการจอง แก้เพดานได้',
  test.pgd_try($$update public.punpang_preorder_campaigns set data = jsonb_set(data, '{dayCap}', '5') where id = 'pg_g14'$$) = 'OK');
select test.ok('G14b เปิดรับกลับด้วยสินค้าที่ถูกต้องได้',
  test.pgd_try($$update public.punpang_preorder_campaigns set status = 'open' where id = 'pg_g14'$$) = 'OK');

rollback;
