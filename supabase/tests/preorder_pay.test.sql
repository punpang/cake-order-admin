-- ทดสอบการชำระมัดจำ หมดเวลา ขยายเวลา และยกเลิกของออร์เดอร์สั่งล่วงหน้า (migration 20261127200000) · รันโดย supabase/tests/run.sh
-- P1 บันทึกการชำระบางส่วน · P2 ref ซ้ำไม่บันทึกซ้ำ · P3 ครบมัดจำ → payment_confirmed · P4 ยอดเกินบิลถูกปฏิเสธ
-- P5 ยังไม่ถึงกำหนดไม่หมดเวลา · P6 หมดเวลาคืนโควตาและแต้ม · P7 หมดเวลาซ้ำไม่มีผล · P8 ชำระหลังหมดเวลาเก็บได้ สถานะคงเดิม
-- P9 ขอขยายเวลาได้ครั้งเดียวและเฉพาะออร์เดอร์ที่หมดเวลา · P10 โควตาเต็ม → ขยายเวลาไม่ผ่านและแต้มไม่ถูกตัด
-- P11 ขยายเวลาสำเร็จ จองโควตาและตัดแต้มใหม่ · P12 วันที่ขยายต้องอยู่ในอนาคต · P13 คืนเงินเกินยอดที่รับไม่ได้
-- P14 ยกเลิกคืนแต้มและปล่อยโควตา ส่วนที่เหลือเป็นริบ · P15 ยกเลิกซ้ำไม่มีผล · P16 ยกเลิกออร์เดอร์ที่หมดเวลาไม่ปล่อยโควตาซ้ำ
-- P17 งานตามเวลาหมดเวลาทุกออร์เดอร์ที่ถึงกำหนด · P18 ออร์เดอร์ที่ยกเลิกแล้วรับการชำระไม่ได้ · P19 วิธีชำระที่ไม่รู้จักถูกปฏิเสธ

begin;

create function test.pp_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- แถวออร์เดอร์: 1 ชิ้นราคา 100 มัดจำ 50 · due = เวลากำหนดจ่าย (ISO)
create function test.pp_row(oid text, cid text, due text) returns jsonb language plpgsql as $$
declare
  d jsonb := jsonb_build_object('items', jsonb_build_array(jsonb_build_object('unitPrice', 100, 'qty', 1)), 'payments', '[]'::jsonb,
    'deposit', jsonb_build_object('percent', 50, 'amount', 50), 'payDueAt', due);
  t numeric;
begin
  t := round(public.punpang__bill_total(d || jsonb_build_object('fulfillment', 'pickup')), 2);
  return jsonb_build_object('id', oid, 'customer_id', cid, 'campaign_id', 'pp_camp', 'pickup_date', '2099-12-24', 'status', 'awaiting_payment',
    'fulfillment', 'pickup', 'data', d || jsonb_build_object('total', t));
end $$;

insert into public.punpang_kv (collection, id, data) values ('config', 'loyalty', '{"v": {"pointValue": 1}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_items (id, kind, name, price, active, data) values ('pp_item', 'retail', 'สินค้าจ่าย', 100, true, '{}');
insert into public.punpang_customers (id, name, data) values
  ('pp_c1', 'ลูกค้าจ่าย 1', jsonb_build_object('ledger', jsonb_build_array(jsonb_build_object('id', 'PL1', 'at', '2026-01-01T00:00:00.000Z', 'delta', 100, 'remaining', 100, 'expiresAt', '2099-01-01')))),
  ('pp_c2', 'ลูกค้าจ่าย 2', '{}'::jsonb);
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('pp_camp', 'open', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120,
    '{"name":"จ่าย","dayCap":null,"items":[{"retailId":"pp_item","dayCap":10}]}');

-- ออร์เดอร์ตั้งต้น: A (เลยกำหนดแล้ว ใช้แต้ม 10) · B (ยังไม่ถึงกำหนด) · D และ E (เลยกำหนดแล้ว)
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_create(test.pp_row('pp_a', 'pp_c1', '2000-01-01T00:00:00Z'), '[{"itemId":"pp_item","qty":1}]'::jsonb, 10, 10);
  if (r->>'ok') is distinct from 'true' then raise exception 'setup A: %', r; end if;
  r := public.punpang_preorder_create(test.pp_row('pp_b', 'pp_c1', '2099-01-01T00:00:00Z'), '[{"itemId":"pp_item","qty":1}]'::jsonb, 0, 0);
  if (r->>'ok') is distinct from 'true' then raise exception 'setup B: %', r; end if;
  r := public.punpang_preorder_create(test.pp_row('pp_d', 'pp_c2', '2000-01-01T00:00:00Z'), '[{"itemId":"pp_item","qty":1}]'::jsonb, 0, 0);
  if (r->>'ok') is distinct from 'true' then raise exception 'setup D: %', r; end if;
  r := public.punpang_preorder_create(test.pp_row('pp_e', 'pp_c2', '2000-01-01T00:00:00Z'), '[{"itemId":"pp_item","qty":1}]'::jsonb, 0, 0);
  if (r->>'ok') is distinct from 'true' then raise exception 'setup E: %', r; end if;
end $$;

-- P1 บันทึกการชำระบางส่วน (เงินสด 20) → ยังรอมัดจำ
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_record_payment('pp_b', 20, 'cash', null);
  perform test.ok('P1 เงินสด 20 บาท (มัดจำ 50) → ยังรอมัดจำ และบันทึกยอดแล้ว',
    (r->>'ok') = 'true' and (r->>'status') = 'awaiting_payment' and (r->>'paid')::numeric = 20);
end $$;

-- P2 ref ซ้ำไม่บันทึกซ้ำ
do $$
declare r1 jsonb; r2 jsonb;
begin
  r1 := public.punpang_preorder_record_payment('pp_b', 10, 'qr', 'PPR1');
  r2 := public.punpang_preorder_record_payment('pp_b', 10, 'qr', 'PPR1');
  perform test.ok('P2 เรียกซ้ำด้วย ref เดิม → already และยอดไม่ถูกบันทึกซ้ำ',
    (r1->>'already') = 'false' and (r2->>'already') = 'true'
    and public.punpang_preorder_paid_total((select data from public.punpang_preorder_orders where id = 'pp_b')) = 30);
end $$;

-- P3 ยอดครบมัดจำ (50) → payment_confirmed
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_record_payment('pp_b', 20, 'cash', 'PPR2');
  perform test.ok('P3 ยอดรวมถึงมัดจำ 50 → payment_confirmed',
    (r->>'status') = 'payment_confirmed' and (select status from public.punpang_preorder_orders where id = 'pp_b') = 'payment_confirmed');
end $$;

-- P4 ยอดรวมเกินยอดบิล (50 + 60 > 100) → over_total และไม่บันทึก
select test.ok('P4 ยอดรวมเกินยอดบิลถูกปฏิเสธ',
  public.punpang_preorder_record_payment('pp_b', 60, 'cash', 'PPR3') = '{"error":"over_total"}'::jsonb
  and public.punpang_preorder_paid_total((select data from public.punpang_preorder_orders where id = 'pp_b')) = 50);

-- P5 ออร์เดอร์ที่ยังไม่ถึงกำหนดและยังรอชำระจะไม่หมดเวลา (สร้างแถวเพิ่มเฉพาะขั้นนี้)
insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, customer_id, data)
  values ('pp_f', 'pp_camp', 'PRE-241124-F00001', 'awaiting_payment', '2099-12-24', 'pp_c2',
    '{"payDueAt":"2099-01-01T00:00:00.000Z","lines":[{"itemId":"pp_item","qty":1}],"total":100,"deposit":{"percent":50,"amount":50}}'::jsonb);
select test.ok('P5 ยังไม่ถึงกำหนดจ่ายจึงไม่หมดเวลา',
  public.punpang_preorder_expire('pp_f') ->> 'reason' = 'not_due'
  and (select status from public.punpang_preorder_orders where id = 'pp_f') = 'awaiting_payment');

-- P6 หมดเวลา A: คืนแต้ม (ledger กลับเป็น 100) และปล่อยโควตา (4 → 3)
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_expire('pp_a');
  perform test.ok('P6 หมดเวลา: สถานะ expired คืนแต้ม 10 และปล่อยโควตาหนึ่งชิ้น',
    (r->>'expired') = 'true' and (r->>'points') = '10'
    and (select status from public.punpang_preorder_orders where id = 'pp_a') = 'expired'
    and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp_c1')) x) = 100
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 3);
end $$;

-- P7 หมดเวลาซ้ำไม่มีผล (ไม่ปล่อยโควตาซ้ำ)
select test.ok('P7 หมดเวลาซ้ำไม่มีผลและโควตาไม่ลดซ้ำ',
  public.punpang_preorder_expire('pp_a') ->> 'expired' = 'false'
  and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 3);

-- P8 ชำระหลังหมดเวลาเก็บได้ แต่สถานะยังเป็น expired จนกว่าร้านจะอนุมัติขยายเวลา
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_record_payment('pp_a', 5, 'cash', 'PPA1');
  perform test.ok('P8 ชำระหลังหมดเวลา: บันทึกยอดแล้ว สถานะยัง expired',
    (r->>'status') = 'expired'
    and public.punpang_preorder_paid_total((select data from public.punpang_preorder_orders where id = 'pp_a')) = 5);
end $$;

-- P9 ขอขยายเวลาได้เฉพาะออร์เดอร์ที่หมดเวลา และไม่ซ้ำเมื่อมีคำขอค้าง
do $$
declare r1 jsonb; r2 jsonb; r3 jsonb;
begin
  r1 := public.punpang_preorder_request_extension('pp_a');
  r2 := public.punpang_preorder_request_extension('pp_a');
  r3 := public.punpang_preorder_request_extension('pp_b');
  perform test.ok('P9 ขอขยายได้ครั้งเดียว: คำขอที่สองเป็น already และออร์เดอร์ที่ยังไม่หมดเวลาขอไม่ได้',
    (r1->>'already') = 'false' and (r2->>'already') = 'true' and (r3->>'error') = 'bad_status');
end $$;

-- P10 โควตาเต็ม: ขยายเวลาไม่ผ่าน และแต้มกับสถานะไม่เปลี่ยน
do $b$
begin
  update public.punpang_preorder_slots set reserved = 10 where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24';
  perform test.ok('P10 โควตาเต็ม → raise quota_full และไม่ตัดแต้ม (แต้มยังเป็น 100 และสถานะ expired)',
    left(test.pp_try($$select public.punpang_preorder_extend('pp_a', '2099-06-01T00:00:00Z'::timestamptz)$$), 30) like 'ERR:P0001:quota_full%'
    and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp_c1')) x) = 100
    and (select status from public.punpang_preorder_orders where id = 'pp_a') = 'expired');
  update public.punpang_preorder_slots set reserved = 3 where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24';
end $b$;

-- P11 ขยายเวลาสำเร็จ: จองโควตากลับ (3 → 4) ตัดแต้มใหม่ 10 และสถานะเป็นรอชำระ (ยอดยังไม่ครบมัดจำ)
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_extend('pp_a', '2099-06-01T00:00:00Z'::timestamptz);
  perform test.ok('P11 ขยายเวลาสำเร็จ: จองโควตากลับ ตัดแต้มใหม่ และคำขอถูกอนุมัติ',
    (r->>'ok') = 'true' and (r->>'status') = 'awaiting_payment'
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 4
    and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp_c1')) x) = 90
    and (select data->'extensionRequest'->>'status' from public.punpang_preorder_orders where id = 'pp_a') = 'approved'
    and (select data->>'payDueAt' from public.punpang_preorder_orders where id = 'pp_a') like '2099-06-01T%');
end $$;

-- P12 วันที่ขยายต้องอยู่ในอนาคต
select test.ok('P12 วันที่ขยายในอดีตถูกปฏิเสธ',
  public.punpang_preorder_extend('pp_a', '2000-01-01T00:00:00Z'::timestamptz) = '{"error":"bad_due"}'::jsonb);

-- P13 คืนเงินเกินยอดที่รับไม่ได้ (รับ 50)
select test.ok('P13 ยกเลิกคืนเกินยอดที่รับ (50) ถูกปฏิเสธ',
  public.punpang_preorder_cancel('pp_b', '[{"amount":60,"method":"cash"}]'::jsonb) = '{"error":"bad_refund"}'::jsonb
  and (select status from public.punpang_preorder_orders where id = 'pp_b') = 'payment_confirmed');

-- P14 ยกเลิก B คืน 30 ริบ 20: สถานะยกเลิก ปล่อยโควตา (4 → 3)
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_cancel('pp_b', '[{"amount":20,"method":"cash"},{"amount":10,"method":"bank"}]'::jsonb);
  perform test.ok('P14 ยกเลิกคืน 30 ริบ 20 และปล่อยโควตา',
    (r->>'refund')::numeric = 30 and (r->>'forfeited')::numeric = 20 and (r->>'released') = 'true'
    and (select status from public.punpang_preorder_orders where id = 'pp_b') = 'cancelled'
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 3);
end $$;

-- P15 ยกเลิกซ้ำไม่มีผล
select test.ok('P15 ยกเลิกซ้ำเป็น already และโควตาไม่ลดซ้ำ',
  public.punpang_preorder_cancel('pp_b', '[]'::jsonb) ->> 'already' = 'true'
  and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 3);

-- P16 ออร์เดอร์ D หมดเวลาแล้วยกเลิก: ปล่อยโควตาครั้งเดียวเท่านั้น (ตอนหมดเวลา)
do $$
declare r jsonb;
begin
  perform public.punpang_preorder_expire('pp_d');
  r := public.punpang_preorder_cancel('pp_d', '[]'::jsonb);
  perform test.ok('P16 ยกเลิกออร์เดอร์ที่หมดเวลาแล้วไม่ปล่อยโควตาซ้ำ',
    (r->>'released') = 'false'
    and (select reserved from public.punpang_preorder_slots where campaign_id = 'pp_camp' and item_id = 'pp_item' and pickup_date = '2099-12-24') = 2);
end $$;

-- P17 งานตามเวลาหมดเวลาทุกออร์เดอร์ที่ถึงกำหนด (E) และไม่แตะออร์เดอร์ที่ยังไม่ถึงกำหนด (A ขยายไปปี 2099)
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_expire_due(now());
  perform test.ok('P17 งานตามเวลาหมดเวลา E และไม่แตะ A ที่ขยายไปปี 2099',
    (r->>'expired')::int >= 1
    and (select status from public.punpang_preorder_orders where id = 'pp_e') = 'expired'
    and (select status from public.punpang_preorder_orders where id = 'pp_a') = 'awaiting_payment');
end $$;

-- P18 ออร์เดอร์ที่ยกเลิกแล้วรับการชำระไม่ได้
select test.ok('P18 ชำระให้ออร์เดอร์ที่ยกเลิกแล้วไม่ได้ (bad_status)',
  public.punpang_preorder_record_payment('pp_b', 1, 'cash', 'PPR9') = '{"error":"bad_status"}'::jsonb);

-- P19 วิธีชำระที่ไม่รู้จักถูกปฏิเสธ
select test.ok('P19 วิธีชำระที่ไม่รู้จักถูกปฏิเสธ (bad_method)',
  public.punpang_preorder_record_payment('pp_a', 1, 'card', null) = '{"error":"bad_method"}'::jsonb);

-- P20 คำขอ QR ของออร์เดอร์ F (ยังไม่จ่าย): บันทึกเป็นรายการ reported และยังไม่นับเป็นยอดชำระ
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_request_qr('pp_f', 30, 'PRE202611240001ABCDE');
  perform test.ok('P20 คำขอ QR 30 บาท บันทึกเป็น reported และยอดชำระยังเป็น 0',
    (r->>'ok') = 'true'
    and public.punpang_preorder_paid_total((select data from public.punpang_preorder_orders where id = 'pp_f')) = 0);
end $$;

-- P21 qrRef ซ้ำ → ref_taken · รูปแบบผิด → bad_ref · ยอดเกินยอดคงค้าง → over_total
select test.ok('P21 ตรวจรหัสและยอดคำขอ QR: ซ้ำ ผิดรูปแบบ และเกินยอด',
  public.punpang_preorder_request_qr('pp_f', 30, 'PRE202611240001ABCDE') = '{"error":"ref_taken"}'::jsonb
  and public.punpang_preorder_request_qr('pp_f', 30, 'PREabc') = '{"error":"bad_ref"}'::jsonb
  and public.punpang_preorder_request_qr('pp_f', 101, 'PRE202611240009ABCDE') = '{"error":"over_total"}'::jsonb);

-- P22 ยืนยันด้วยยอดไม่ตรง → amount_mismatch และรายการยังเป็น reported
select test.ok('P22 ยอดจากถุงเงินไม่ตรงกับคำขอ → ไม่ยืนยัน',
  public.punpang_preorder_confirm_qr('PRE202611240001ABCDE', 25) = '{"error":"amount_mismatch"}'::jsonb
  and (select x->>'status' from public.punpang_preorder_orders po, jsonb_array_elements(po.data->'payments') x where po.id = 'pp_f' and x->>'qrRef' = 'PRE202611240001ABCDE') = 'reported');

-- P23 ยอดตรง → ยืนยันงวดนี้ ยอดชำระ 30 และยังรอมัดจำ
do $$
declare r jsonb;
begin
  r := public.punpang_preorder_confirm_qr('PRE202611240001ABCDE', 30, 'BANKREF1');
  perform test.ok('P23 ยอดตรง → ยืนยันงวด ยอดชำระ 30 และยังรอมัดจำ',
    (r->>'status') = 'awaiting_payment' and (r->>'paid')::numeric = 30
    and (select x->>'bankRef' from public.punpang_preorder_orders po, jsonb_array_elements(po.data->'payments') x where po.id = 'pp_f' and x->>'qrRef' = 'PRE202611240001ABCDE') = 'BANKREF1');
end $$;

-- P24 คำขอที่สองครบมัดจำ → payment_confirmed · การยืนยันซ้ำไม่มีผล
do $$
declare r jsonb;
begin
  perform public.punpang_preorder_request_qr('pp_f', 40, 'PRE202611240002ABCDE');
  r := public.punpang_preorder_confirm_qr('PRE202611240002ABCDE', 40, 'BANKREF2');
  perform test.ok('P24 ยอดรวมถึงมัดจำ 50 จาก QR → payment_confirmed',
    (r->>'status') = 'payment_confirmed' and (r->>'paid')::numeric = 70
    and (select status from public.punpang_preorder_orders where id = 'pp_f') = 'payment_confirmed');
end $$;

-- P25 รหัสที่ไม่เคยขอ → not_found · รายการที่ยืนยันแล้วยืนยันซ้ำไม่ได้ (not_reported)
select test.ok('P25 ยืนยันรหัสที่ไม่มีและยืนยันซ้ำ → ไม่มีผล',
  public.punpang_preorder_confirm_qr('PRE202611240777ABCDE', 10) = '{"error":"not_found"}'::jsonb
  and public.punpang_preorder_confirm_qr('PRE202611240002ABCDE', 40) = '{"error":"not_reported"}'::jsonb);

-- P26 คำขอ QR ที่ยังไม่ยืนยันไม่นับเป็นยอดชำระ (ยอดยังเป็น 70)
select test.ok('P26 คำขอ QR ที่ยังค้างไม่นับเป็นยอดชำระ',
  public.punpang_preorder_request_qr('pp_f', 5, 'PRE202611240003ABCDE') ->> 'ok' = 'true'
  and public.punpang_preorder_paid_total((select data from public.punpang_preorder_orders where id = 'pp_f')) = 70);

-- P27 งานตามเวลา (3D): ถ้ามีส่วน pg_cron ต้องมีงาน punpang-preorder-expire เพียงงานเดียว (ถ้าไม่มี pg_cron ในฐานทดสอบ ข้ามการตรวจ)
-- นับงาน punpang-preorder-expire ผ่าน execute (ฐานทดสอบอาจไม่มีตาราง cron.job)
create function test.pp_cron_jobs() returns int language plpgsql as $$
declare n int;
begin
  if to_regclass('cron.job') is null then return 1; end if;
  execute 'select count(*)::int from cron.job where jobname = ''punpang-preorder-expire''' into n;
  return n;
end $$;
select test.ok('P27 งานตามเวลาหมดเวลาจ่ายถูกตั้งไว้ (หรือไม่มี pg_cron ในฐานทดสอบ)', test.pp_cron_jobs() = 1);

rollback;
