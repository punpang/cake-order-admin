-- ทดสอบ RPC จอง/ปล่อยโควตาสั่งล่วงหน้า (migration 20261127110000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- แคมเปญทดสอบเปิดรับตลอดช่วง (2000–2099) เพื่อไม่ขึ้นกับวันที่รันจริง · ทดสอบแบบ superuser ยกเว้น Q7 (สิทธิ์เรียก RPC)

begin;

insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
values ('pq1', 'open', '2000-01-01', '2099-12-31', '2026-12-24', '2026-12-26', 50, 120,
  '{"name":"ทดสอบโควตา","dayCap":6,"items":[{"retailId":"A","dayCap":2},{"retailId":"B","dayCap":5}]}');

-- ตัวช่วย: ตัวนับจองของช่องหนึ่ง (0 เมื่อยังไม่มีแถว)
create or replace function pq_reserved(p_item text, p_day date) returns integer language sql as $$
  select coalesce((select reserved from public.punpang_preorder_slots
    where campaign_id = 'pq1' and pickup_date = p_day and item_id = p_item), 0)
$$;

-- Q1 จองถึงเพดานแล้วจองเกินไม่ได้ (เกินเพดานรายสินค้า)
select test.ok('Q1a จอง A×2 สำเร็จ',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":2}]'::jsonb) ->> 'ok') = 'true');
select test.ok('Q1b จอง A×1 อีกต้องได้ item_full และที่ว่างเหลือ 0',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'error') = 'item_full'
  and (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'left') = '0');

-- Q2 (Review Focus 1) คำขอหลายรายการที่สินค้าหนึ่งเกินเพดาน ต้องล้มทั้งคำขอ ตัวนับของรายการแรกต้องไม่เพิ่ม
select test.ok('Q2a คำขอ [A×1, B×9] ล้ม',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":1},{"itemId":"B","qty":9}]'::jsonb) ->> 'ok') = 'false');
select test.ok('Q2b ตัวนับ A ไม่เพิ่มจากคำขอที่ล้ม (ยังคงเป็น 2)',
  pq_reserved('A', '2026-12-24') = 2 and pq_reserved('B', '2026-12-24') = 0);

-- Q3 เพดานรวมต่อวัน: B×5 แล้ว A×2 รวมเป็น 7 > 6 → day_full พร้อมที่ว่างรวม 1
select test.ok('Q3a จอง B×5 สำเร็จ',
  (public.punpang_preorder_reserve('pq1', '2026-12-25', '[{"itemId":"B","qty":5}]'::jsonb) ->> 'ok') = 'true');
select test.ok('Q3b A×2 ต่อท้ายได้ day_full และที่ว่างรวมเหลือ 1',
  (public.punpang_preorder_reserve('pq1', '2026-12-25', '[{"itemId":"A","qty":2}]'::jsonb) ->> 'error') = 'day_full'
  and (public.punpang_preorder_reserve('pq1', '2026-12-25', '[{"itemId":"A","qty":2}]'::jsonb) ->> 'left') = '1');

-- Q4 (Review Focus 2) จำนวนไม่ถูกต้องและรายการซ้ำ
select test.ok('Q4a qty 0 / -1 / 1.5 / "2" → bad_qty',
  (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"A","qty":0}]'::jsonb) ->> 'error') = 'bad_qty'
  and (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"A","qty":-1}]'::jsonb) ->> 'error') = 'bad_qty'
  and (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"A","qty":1.5}]'::jsonb) ->> 'error') = 'bad_qty'
  and (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"A","qty":"2"}]'::jsonb) ->> 'error') = 'bad_qty');
select test.ok('Q4b itemId ซ้ำถูกรวม (A×1 + A×1 = A×2) และตรวจเพดานครบ',
  (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"A","qty":1},{"itemId":"A","qty":1}]'::jsonb) ->> 'ok') = 'true'
  and pq_reserved('A', '2026-12-26') = 2);

-- Q5 สินค้านอกแคมเปญ / วันรับนอกช่วง / แคมเปญไม่เปิดรับ
select test.ok('Q5a สินค้าไม่อยู่ในแคมเปญ → bad_item',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"Z","qty":1}]'::jsonb) ->> 'error') = 'bad_item');
select test.ok('Q5b วันรับนอกช่วง → bad_date',
  (public.punpang_preorder_reserve('pq1', '2026-12-27', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'error') = 'bad_date');
update public.punpang_preorder_campaigns set status = 'draft' where id = 'pq1';
select test.ok('Q5c แคมเปญร่าง → closed',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'error') = 'closed');
update public.punpang_preorder_campaigns set status = 'open' where id = 'pq1';
update public.punpang_preorder_campaigns set order_from = '2000-01-01', order_to = '2000-01-02' where id = 'pq1';
select test.ok('Q5d วันนี้พ้นช่วงรับสั่ง → outside_order_window',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'error') = 'outside_order_window');
select test.ok('Q9 p_enforce_window=false ข้ามการตรวจช่วงรับสั่ง แต่ยังตรวจวันรับและเพดาน',
  (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"B","qty":1}]'::jsonb, false) ->> 'ok') = 'true'
  and (public.punpang_preorder_reserve('pq1', '2026-12-27', '[{"itemId":"B","qty":1}]'::jsonb, false) ->> 'error') = 'bad_date');
update public.punpang_preorder_campaigns set order_from = '2000-01-01', order_to = '2099-12-31' where id = 'pq1';

-- Q6 (Review Focus 3) ปล่อยโควตาเกินที่จองไว้ ตัวนับต้องไม่ติดลบ และจองใหม่ได้หลังปล่อย
select test.ok('Q6a ปล่อย A×9 (จองไว้ 2) → ตัวนับเป็น 0 ไม่ติดลบ',
  (public.punpang_preorder_release('pq1', '2026-12-24', '[{"itemId":"A","qty":9}]'::jsonb) ->> 'ok') = 'true'
  and pq_reserved('A', '2026-12-24') = 0);
select test.ok('Q6b ปล่อยซ้ำอีกครั้งยังเป็น 0 และจองใหม่ได้เต็มเพดาน',
  (public.punpang_preorder_release('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb) ->> 'ok') = 'true'
  and (public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"A","qty":2}]'::jsonb) ->> 'ok') = 'true');

-- Q8 เพดาน null = ไม่จำกัด (ทั้งรายสินค้าและยอดรวม)
update public.punpang_preorder_campaigns
  set data = '{"name":"ไม่จำกัด","dayCap":null,"items":[{"retailId":"C","dayCap":null}]}' where id = 'pq1';
select test.ok('Q8 เพดานว่างจองได้ไม่จำกัด',
  (public.punpang_preorder_reserve('pq1', '2026-12-26', '[{"itemId":"C","qty":500}]'::jsonb) ->> 'ok') = 'true');

-- Q7 สิทธิ์: เรียก RPC จากผู้ใช้ทั่วไปและ anon ไม่ได้ (ฟังก์ชันจำกัดให้ service_role)
select test.ok('Q7a authenticated เรียก reserve ไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000aa',
    $$select public.punpang_preorder_reserve('pq1', '2026-12-24', '[{"itemId":"C","qty":1}]'::jsonb)$$), 10) = 'ERR:42501:');
select test.ok('Q7b anon เรียก release ไม่ได้',
  test.as_anon($$select public.punpang_preorder_release('pq1', '2026-12-24', '[{"itemId":"A","qty":1}]'::jsonb)$$) <> 'OK');

rollback;
