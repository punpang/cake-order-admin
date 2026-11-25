-- ทดสอบโควตารายรอบของสั่งล่วงหน้า (migration 20261127270000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ

begin;

insert into public.punpang_items (id, kind, name, price, active, data) values ('pp_rd_item', 'retail', 'สินค้ารอบ', 100, true, '{}');
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
values
  ('pp_rd', 'open', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120,
    '{"pickupMode":"slot","items":[{"retailId":"pp_rd_item","dayCap":null}],"rounds":[{"time":"10:00","cap":1},{"time":"13:00","cap":2}]}'),
  ('pp_rday', 'open', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120,
    '{"pickupMode":"day","items":[{"retailId":"pp_rd_item","dayCap":null}],"rounds":[{"time":"10:00","cap":1}]}');

select test.ok('R1 จองรอบ 10:00 ได้ (1/1)',
  public.punpang_preorder_reserve_round('pp_rd', '2099-12-24', '10:00') ->> 'ok' = 'true');
select test.ok('R2 รอบ 10:00 เต็มแล้ว จองเพิ่มไม่ได้',
  public.punpang_preorder_reserve_round('pp_rd', '2099-12-24', '10:00') ->> 'error' = 'round_full');
select test.ok('R3 รอบ 13:00 แยกโควตา จองได้',
  public.punpang_preorder_reserve_round('pp_rd', '2099-12-24', '13:00') ->> 'ok' = 'true');
select test.ok('R4 รอบที่ไม่มีในแคมเปญถูกปฏิเสธ',
  public.punpang_preorder_reserve_round('pp_rd', '2099-12-24', '11:00') ->> 'error' = 'bad_round');
select test.ok('R5 วันรับนอกช่วงถูกปฏิเสธ',
  public.punpang_preorder_reserve_round('pp_rd', '2099-12-30', '13:00') ->> 'error' = 'bad_date');
select test.ok('R6 แคมเปญโหมดวันจองรอบไม่ได้',
  public.punpang_preorder_reserve_round('pp_rday', '2099-12-24', '10:00') ->> 'error' = 'not_slot_mode');
select test.ok('R7 ปลดการจองแล้วจองใหม่ได้ (รอบ 10:00 กลับมาว่าง)',
  public.punpang_preorder_release_round('pp_rd', '2099-12-24', '10:00') ->> 'ok' = 'true'
  and public.punpang_preorder_reserve_round('pp_rd', '2099-12-24', '10:00') ->> 'ok' = 'true');
select test.ok('R8 ปลดรอบที่ไม่มีการจองไม่ทำให้ติดลบ',
  public.punpang_preorder_release_round('pp_rd', '2099-12-25', '13:00') ->> 'error' = 'nothing_to_release');
do $$ begin
  insert into public.punpang_preorder_round_slots (campaign_id, pickup_date, round_time, reserved) values ('pp_rd', '2099-12-24', '9:00', 0);
  raise exception 'expected check violation';
exception when check_violation then
  raise notice 'PASS: R9 เวลารอบรูปแบบผิดถูกฐานข้อมูลปฏิเสธ';
end $$;

insert into public.punpang_customers (id, name, data) values ('pp_rc1', 'ลูกค้ารอบ', '{}'::jsonb);
-- สร้างออเดอร์พร้อมจองรอบ: สำเร็จจองรอบ · รอบเต็มไม่สร้างออเดอร์และไม่จองรอบ · ความล้มเหลวอื่นคืนการจองรอบ
do $$
declare d jsonb; t numeric; r jsonb;
begin
  d := jsonb_build_object('items', jsonb_build_array(jsonb_build_object('unitPrice', 100, 'qty', 1)), 'payments', '[]'::jsonb,
    'deposit', jsonb_build_object('percent', 50, 'amount', 50), 'payDueAt', '2099-12-01T00:00:00Z');
  t := round(public.punpang__bill_total(d || jsonb_build_object('fulfillment', 'pickup')), 2);
  d := d || jsonb_build_object('total', t, 'lines', jsonb_build_array(jsonb_build_object('retailId', 'pp_rd_item', 'qty', 1)));
  r := public.punpang_preorder_create_round(jsonb_build_object('id', 'rd_o1', 'customer_id', 'pp_rc1', 'campaign_id', 'pp_rd', 'pickup_date', '2099-12-25', 'status', 'awaiting_payment', 'fulfillment', 'pickup', 'data', d),
    '[{"itemId":"pp_rd_item","qty":1}]'::jsonb, 0, 0, '13:00');
  if (r->>'ok') is distinct from 'true' then raise exception 'R10 สร้างออเดอร์พร้อมรอบไม่ผ่าน: %', r; end if;
  if (select reserved from public.punpang_preorder_round_slots where campaign_id = 'pp_rd' and pickup_date = '2099-12-25' and round_time = '13:00') <> 1 then
    raise exception 'R10 จองรอบไม่ตรง';
  end if;
  raise notice 'PASS: R10 สร้างออเดอร์พร้อมรอบ 13:00 และจองรอบสำเร็จ';
end $$;

rollback;
