-- ทดสอบการใช้/คืนแต้มของสั่งล่วงหน้า (migration 20261127180000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- P1 แต้มไม่พอ → ไม่ตัด · P2 ตัดแล้วซ้ำ → ไม่ตัดอีก · P3 มูลค่าไม่ตรง → ปฏิเสธ · P4 คืนแล้วแต้มกลับ · P5 คืนซ้ำไม่มีผล
-- P6 FIFO: ตัดจากก้อนที่หมดอายุก่อน · P7 บทบาทแอปเรียกไม่ได้

begin;

insert into public.punpang_kv (collection, id, data) values ('config', 'loyalty', '{"v": {"pointValue": 2}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;

insert into public.punpang_customers (id, name, data) values ('pp1', 'ลูกค้าแต้ม', jsonb_build_object('ledger', jsonb_build_array(
  jsonb_build_object('id', 'L_late', 'at', '2026-01-01T00:00:00.000Z', 'delta', 50, 'remaining', 50, 'expiresAt', '2099-01-01'),
  jsonb_build_object('id', 'L_early', 'at', '2026-01-01T00:00:00.000Z', 'delta', 30, 'remaining', 30, 'expiresAt', '2098-01-01'))));

insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('pp_camp', 'closed', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120, '{"name":"แต้ม","dayCap":null,"items":[]}');
insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, customer_id, data)
  values ('pp_o1', 'pp_camp', 'PRE-241124-900201', 'awaiting_payment', '2099-12-24', 'pp1', '{}');

-- P1 แต้มไม่พอ (ขอ 200 มีแค่ 80)
select test.ok('P1 แต้มไม่พอ → insufficient และไม่ตัดแต้ม',
  (select (public.punpang_preorder_spend_points('pp_o1', 'pp1', 200, 400) ->> 'error')) = 'insufficient'
  and (select sum((x->>'remaining')::int) from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x) = 80);

-- P6 + P2 ตัด 40 แต้มแรก (แยกเป็นคนละคำสั่งกับการอ่านผล เพราะการอ่านในคำสั่งเดียวกันไม่เห็นการแก้ไขของฟังก์ชัน)
do $$
declare r jsonb; r2 jsonb; early int; late int; total int;
begin
  r := public.punpang_preorder_spend_points('pp_o1', 'pp1', 40, 80);
  select (x->>'remaining')::int into early from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x where x->>'id' = 'L_early';
  select (x->>'remaining')::int into late from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x where x->>'id' = 'L_late';
  perform test.ok('P6 FIFO: ตัด 40 แต้มจากก้อนที่หมดอายุก่อนก่อน (L_early หมด, L_late เหลือ 40)',
    (r->>'ok') = 'true' and early = 0 and late = 40);
  r2 := public.punpang_preorder_spend_points('pp_o1', 'pp1', 40, 80);
  select sum((x->>'remaining')::int) into total from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x;
  perform test.ok('P2 เรียกซ้ำกับออร์เดอร์เดิม → already และแต้มไม่ถูกตัดซ้ำ',
    (r2->>'already') = 'true' and total = 40);
end $$;

-- P3 มูลค่าไม่ตรงแต้ม × pointValue → ปฏิเสธ (ออร์เดอร์ใหม่)
select test.ok('P3 p_amount ไม่เท่ากับแต้ม × pointValue → amount_mismatch',
  (public.punpang_preorder_spend_points('pp_o2', 'pp1', 10, 999) ->> 'error') = 'amount_mismatch');

-- P4 + P5 คืนแต้มแล้วแต้มกลับเข้าก้อนเดิม · คืนซ้ำไม่มีผล
do $$
declare r jsonb; r2 jsonb; total int; refunded int;
begin
  r := public.punpang_preorder_return_points('pp_o1');
  select sum((x->>'remaining')::int), count(*) filter (where (x->>'refunded')::boolean)
    into total, refunded from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x;
  perform test.ok('P4 คืนแต้มออร์เดอร์ pp_o1: ยอดกลับเป็น 80 และรายการเดิมถูกทำเครื่องหมาย refunded',
    (r->>'ok') = 'true' and total = 80 and refunded = 1);
  r2 := public.punpang_preorder_return_points('pp_o1');
  select sum((x->>'remaining')::int) into total from jsonb_array_elements((select data->'ledger' from public.punpang_customers where id = 'pp1')) x;
  perform test.ok('P5 คืนซ้ำ → already และยอดไม่เปลี่ยน',
    (r2->>'already') = 'true' and total = 80);
end $$;

-- P7 บทบาทแอปเรียกไม่ได้
select test.ok('P7 authenticated เรียกใช้แต้มของสั่งล่วงหน้าไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000e1', $$select public.punpang_preorder_spend_points('pp_o3', 'pp1', 1, 2)$$), 10) = 'ERR:42501:');

rollback;
