-- ทดสอบการสร้างและยกเลิกออร์เดอร์สั่งล่วงหน้าในธุรกรรมเดียว (migration 20261127190000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- C1 โควตาเต็มทำให้ไม่มีออร์เดอร์และแต้มไม่ถูกตัด · C2 ยอดไม่ตรงถูกปฏิเสธ · C3 สร้างสำเร็จ ได้เลข PRE · C4 เรียกซ้ำ idempotent
-- C5 เพดานค้างจ่าย · C6 ยกเลิกคืนโควตาและแต้ม · C7 บทบาทแอปเรียกไม่ได้

begin;

create function test.pgd_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

insert into public.punpang_kv (collection, id, data) values ('config', 'loyalty', '{"v": {"pointValue": 1}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_customers (id, name, data) values ('cr1', 'ลูกค้าสร้างออร์เดอร์', jsonb_build_object('ledger', jsonb_build_array(
  jsonb_build_object('id', 'CL1', 'at', '2026-01-01T00:00:00.000Z', 'delta', 100, 'remaining', 100, 'expiresAt', '2099-01-01'))));
insert into public.punpang_items (id, kind, name, price, active, data) values ('gr1', 'retail', 'สินค้าสร้าง', 100, true, '{}');
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('cr_camp', 'open', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120,
    '{"name":"สร้าง","dayCap":null,"items":[{"retailId":"gr1","dayCap":10}]}');

-- ตัวช่วย: แถวออร์เดอร์ที่มียอดตรงกับการคิดในฐานข้อมูล (1 ชิ้น ราคา 100)
create function test.cr_row(oid text, cid text, qty int, total_override numeric default null) returns jsonb language plpgsql as $$
declare d jsonb := jsonb_build_object('items', jsonb_build_array(jsonb_build_object('unitPrice', 100, 'qty', qty)), 'payments', '[]'::jsonb);
        t numeric;
begin
  t := round(public.punpang__bill_total(d || jsonb_build_object('fulfillment', 'pickup')), 2);
  return jsonb_build_object('id', oid, 'customer_id', cid, 'campaign_id', 'cr_camp', 'pickup_date', '2099-12-24', 'status', 'awaiting_payment',
    'fulfillment', 'pickup', 'data', d || jsonb_build_object('total', coalesce(total_override, t)));
end $$;

-- C1 เกินโควตา (เพดานรายสินค้า 10 ขอ 11) → reserve_failed และไม่มีออร์เดอร์/แต้มไม่ถูกตัด
select test.ok('C1 โควตาไม่พอ → raise reserve_failed และไม่สร้างออร์เดอร์ ไม่ตัดแต้ม',
  left(test.pgd_try($$select public.punpang_preorder_create(test.cr_row('cr_o0', 'cr1', 11), '[{"itemId":"gr1","qty":11}]'::jsonb, 10, 10)$$), 30) like 'ERR:P0001:reserve_failed%'
  and not exists (select 1 from public.punpang_preorder_orders where id = 'cr_o0')
  and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'cr1')) x) = 100);

-- C2 ยอดที่ส่งมาไม่ตรง → total_mismatch และไม่จองโควตา
select test.ok('C2 ยอดไม่ตรงการคิดในฐานข้อมูล → total_mismatch และไม่จองโควตา',
  left(test.pgd_try($$select public.punpang_preorder_create(test.cr_row('cr_o1', 'cr1', 1, 999), '[{"itemId":"gr1","qty":1}]'::jsonb, 0, 0)$$), 30) like 'ERR:P0001:total_mismatch%'
  and (select reserved from public.punpang_preorder_slots where campaign_id = 'cr_camp' and item_id = 'gr1' and pickup_date = '2099-12-24') is null);

-- C3 สร้างสำเร็จ: ได้เลข PRE-ddmmyy-xxxxxx จองโควตา และตัดแต้ม
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_create(test.cr_row('cr_o2', 'cr1', 1), '[{"itemId":"gr1","qty":1}]'::jsonb, 10, 10);
  perform test.ok('C3 สร้างสำเร็จ: ได้เลข PRE และจองโควตา 1 ชิ้น และตัดแต้ม 10',
    (r->>'ok') = 'true' and (r->>'code') like 'PRE-%-______'
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'cr_camp' and item_id = 'gr1' and pickup_date = '2099-12-24') = 1
    and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'cr1')) x) = 90);
end $$;

-- C4 เรียกซ้ำด้วยรหัสออร์เดอร์เดิม → already ไม่จองเพิ่ม ไม่ตัดแต้มซ้ำ
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_create(test.cr_row('cr_o2', 'cr1', 1), '[{"itemId":"gr1","qty":1}]'::jsonb, 10, 10);
  perform test.ok('C4 เรียกซ้ำ → already และไม่จองเพิ่ม/ไม่ตัดแต้มซ้ำ',
    (r->>'already') = 'true'
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'cr_camp' and item_id = 'gr1' and pickup_date = '2099-12-24') = 1
    and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'cr1')) x) = 90);
end $$;

-- C5 เพดานออร์เดอร์ค้างจ่ายต่อเบอร์ = 3: ออร์เดอร์ที่ 3 ค้างอยู่แล้ว (cr_o2 + 2 รายการ) → ออร์เดอร์ใหม่ถูกปฏิเสธ
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb;
begin
  r1 := public.punpang_preorder_create(test.cr_row('cr_o3', 'cr1', 1), '[{"itemId":"gr1","qty":1}]'::jsonb, 0, 0);
  r2 := public.punpang_preorder_create(test.cr_row('cr_o4', 'cr1', 1), '[{"itemId":"gr1","qty":1}]'::jsonb, 0, 0);
  r3 := public.punpang_preorder_create(test.cr_row('cr_o5', 'cr1', 1), '[{"itemId":"gr1","qty":1}]'::jsonb, 0, 0);
  perform test.ok('C5 ออร์เดอร์ค้างจ่ายครบ 3 แล้วรายการถัดไปถูกปฏิเสธ (too_many_open)',
    (r1->>'ok') = 'true' and (r2->>'ok') = 'true' and (r3->>'error') = 'too_many_open');
end $$;

-- C6 ยกเลิกคืนโควตาและแต้ม และยกเลิกซ้ำไม่มีผล
do $$
declare r jsonb; r2 jsonb;
begin
  r := public.punpang_preorder_cancel_release('cr_o2');
  perform test.ok('C6a ยกเลิกคืนโควตาของออร์เดอร์นั้น และคืนแต้ม 10',
    (r->>'ok') = 'true' and (r->>'points') = '10'
    and (select status from public.punpang_preorder_orders where id = 'cr_o2') = 'cancelled');
  r2 := public.punpang_preorder_cancel_release('cr_o2');
  perform test.ok('C6b ยกเลิกซ้ำ → already',
    (r2->>'already') = 'true');
end $$;

-- C7 บทบาทแอปเรียกไม่ได้
select test.ok('C7 authenticated เรียกสร้างออร์เดอร์สั่งล่วงหน้าไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000f1', $$select public.punpang_preorder_create('{}'::jsonb, '[]'::jsonb, 0, 0)$$), 10) = 'ERR:42501:');

rollback;
