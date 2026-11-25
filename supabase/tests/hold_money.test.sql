-- ทดสอบเงินพักระดับฐานข้อมูล (migration 20261126100000): โครงสร้าง · ยอดค้าง · งวดแรก · ยอดชำระเกิน · คืนเงินพัก · กติกาส่งมอบ · ส่วนลดเดือนเกิด
-- ตรงกับ src/lib/pricing.js (orderTotals) และ src/lib/holdMoney.js · รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น)
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น hm_ / OR-HM- · ทำในธุรกรรมที่ย้อนกลับ
-- หมายเหตุ: ลำดับการทดสอบที่ต้องพึ่งกันเขียนเป็นคำสั่งแยกบรรทัด (ไม่ใช้ AND ในนิพจน์เดียว เพราะลำดับการประเมินไม่รับประกัน)

begin;

-- ลองคำสั่ง: คืน 'OK' หรือ 'ERR:<sqlstate>:<ข้อความ>' (ผิดพลาดแล้วย้อนเฉพาะคำสั่งนั้น)
create function test.hm_try(stmt text) returns text language plpgsql as $$
begin
  execute stmt;
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate || ':' || sqlerrm;
end $$;

-- เพิ่มออร์เดอร์ทดสอบ (ช่องทางเว็บ · ลูกค้า c1) คืน 'OK' หรือ 'ERR:...'
create function test.hm_ins(oid text, ocode text, st text, fulil text, d text) returns text language plpgsql as $$
begin
  return test.hm_try(format(
    'insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values (%L, %L, %L, %L, %L, %L, %L::jsonb)',
    oid, ocode, 'c1', st, fulil, 'web', d));
end $$;

-- ---------- HM1: โครงสร้างเงินพัก (ตรวจตอนสร้าง และตอนเงินพักเปลี่ยน) ----------
select test.ok('HM1a: เงินพักถูกต้อง (1000 = ธนบัตร 1000 × 1) สร้างออร์เดอร์ได้',
  test.hm_ins('hm_ok', 'OR-HM-1', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM1b: ยอดเงินพักไม่ตรงกับธนบัตร → สร้างไม่ได้',
  test.hm_ins('hm_b1', 'OR-HM-2', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":900,"notes":{"1000":1}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1c: ประเภทเงินพักไม่ถูกต้อง (ไม่ใช่ hide/pull) → สร้างไม่ได้',
  test.hm_ins('hm_b2', 'OR-HM-3', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"other","amount":1000,"notes":{"1000":1}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1d: ไม่มีธนบัตรเลย → สร้างไม่ได้',
  test.hm_ins('hm_b3', 'OR-HM-4', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"pull","amount":0,"notes":{}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1e: จำนวนธนบัตรเป็นทศนิยม → สร้างไม่ได้',
  test.hm_ins('hm_b4', 'OR-HM-5', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":150,"notes":{"100":1.5}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1f: ธนบัตรที่ไม่รองรับ (200 บาท) → สร้างไม่ได้',
  test.hm_ins('hm_b5', 'OR-HM-6', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":200,"notes":{"200":1}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1g: จำนวนธนบัตรติดลบ → สร้างไม่ได้',
  test.hm_ins('hm_b6', 'OR-HM-7', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":-100,"notes":{"100":-1}}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1h: ธนบัตรไม่ใช่ออบเจกต์ → สร้างไม่ได้',
  test.hm_ins('hm_b7', 'OR-HM-8', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":100,"notes":[100]}}') like 'ERR:P0001:punpang_hold_invalid:%');
select test.ok('HM1i: แก้ยอดเงินพักให้ไม่ตรงกับธนบัตร → ถูกบล็อก',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{holdMoney,amount}', '950') where id = 'hm_ok' $q$) like 'ERR:P0001:punpang_hold_invalid:%');

-- ---------- HM2: ยอดค้าง (balance) รวมเงินพัก ----------
-- ค่า balance ที่แอปส่งมา (999) ถูกแทนด้วยค่าที่คำนวณ: เงินพัก 1000 + สินค้า 400 = 1400
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, balance, data) values
  ('hm_bal', 'OR-HM-9', 'c1', 'awaiting_payment', 'pickup', 'web', 999,
   '{"items":[{"unitPrice":400,"qty":1}],"payments":[],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}');
select test.ok('HM2a: ยอดค้างรวมเงินพัก (1400) และไม่ใช้ค่าที่แอปส่งมาผิด',
  (select balance from public.punpang_orders where id = 'hm_bal') = 1400);
update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"p1","status":"confirmed","amount":1400}]') where id = 'hm_bal';
select test.ok('HM2b: ชำระครบทั้งเงินพักและสินค้า → ยอดค้าง 0',
  (select balance from public.punpang_orders where id = 'hm_bal') = 0);

-- ---------- HM3: งวดแรกต้องครอบคลุมเงินพัก (ตอนยืนยันครั้งแรก) ----------
select test.ok('HM3a: ยืนยันครั้งแรก 600 < เงินพัก 1000 → ถูกบล็อก',
  test.hm_ins('hm_fp1', 'OR-HM-10', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":600}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') like 'ERR:P0001:punpang_hold_first_payment:%');
select test.ok('HM3b: รายการแจ้งชำระ (ยังไม่ยืนยัน) 600 สร้างได้',
  test.hm_ins('hm_fp2', 'OR-HM-11', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"reported","amount":600}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM3c: ยืนยันรายการแจ้ง 600 เป็นงวดแรกที่ไม่ครอบคลุมเงินพัก → ถูกบล็อก',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments,0,status}', '"confirmed"') where id = 'hm_fp2' $q$) like 'ERR:P0001:punpang_hold_first_payment:%');
select test.ok('HM3d: ยืนยันงวดแรก 1000 (ครอบคลุมเงินพัก) → ผ่าน',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"p1","status":"confirmed","amount":1000}]') where id = 'hm_fp2' $q$) = 'OK');
select test.ok('HM3e: เพิ่มเงินพักหลังงวดแรกแล้ว (1500) ไม่ใช้กติกางวดแรก → ผ่าน',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{holdMoney}', '{"kind":"hide","amount":1500,"notes":{"1000":1,"500":1}}') where id = 'hm_fp2' $q$) = 'OK');
select test.ok('HM3e: ยอดค้างหลังเพิ่มเงินพัก = 1900 − 1000 = 900',
  (select balance from public.punpang_orders where id = 'hm_fp2') = 900);

-- ---------- HM4: ยอดชำระเกินยอดที่ต้องจ่าย (เงินพัก + สินค้า) ----------
select test.ok('HM4a: ยืนยันเท่ายอดที่ต้องจ่าย (1400) ผ่าน',
  test.hm_ins('hm_ov1', 'OR-HM-12', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1400}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM4b: ยืนยันเกินยอดที่ต้องจ่าย 2 สตางค์ (1400.02) → ถูกบล็อก',
  test.hm_ins('hm_ov2', 'OR-HM-13', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1400.02}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') like 'ERR:P0001:punpang_over_bill:%');
select test.ok('HM4c: เกิน 1 สตางค์ (1400.01) ยังผ่าน (ค่าคลาดเคลื่อนเศษสตางค์)',
  test.hm_ins('hm_ov3', 'OR-HM-14', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1400.01}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');

-- ---------- HM5: ลดเงินพักแล้วคืนเงิน (kind = hold) ----------
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('hm_ret', 'OR-HM-15', 'c1', 'payment_confirmed', 'pickup', 'web',
   '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1400}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}');
-- ลดเงินพักเหลือ 700 และคืนเงินสด 300 (returns kind hold) → ยอดที่ต้องจ่าย 1100 = ชำระ 1400 − คืน 300 → ยอดค้าง 0
select test.ok('HM5a: ลดเงินพักเหลือ 700 พร้อมบันทึกคืน 300 → ผ่าน',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(jsonb_set(data, '{holdMoney}', '{"kind":"hide","amount":700,"notes":{"500":1,"100":2}}'), '{returns}', '[{"id":"h1","kind":"hold","amount":300}]') where id = 'hm_ret' $q$) = 'OK');
select test.ok('HM5a: ยอดค้างหลังคืนเงินพักแล้ว = 0 (ไม่เปิดยอดค้างใหม่)',
  (select balance from public.punpang_orders where id = 'hm_ret') = 0);
-- หลังคืนเงินแล้ว การชำระเพิ่ม 100 ทำให้ยอดสุทธิ (1500 − 300 = 1200) เกินยอดที่ต้องจ่าย (1100) → ถูกบล็อก
select test.ok('HM5b: ชำระเพิ่มหลังคืนเงินพัก ทำให้ยอดสุทธิเกินยอดที่ต้องจ่าย → ถูกบล็อก',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"p1","status":"confirmed","amount":1400},{"id":"p2","status":"confirmed","amount":100}]') where id = 'hm_ret' $q$) like 'ERR:P0001:punpang_over_bill:%');

-- ---------- HM6: กติกาส่งมอบ/จัดส่ง (ตอนเปลี่ยนเข้าสถานะ) ----------
select test.ok('HM6a: เตรียมจัดส่งที่ยังไม่ชำระ → สร้างได้',
  test.hm_ins('hm_d1', 'OR-HM-20', 'awaiting_payment', 'delivery', '{"items":[{"unitPrice":400,"qty":1}],"payments":[]}') = 'OK');
select test.ok('HM6a: จัดส่งที่ยังไม่ชำระเปลี่ยนเป็นส่งมอบไม่ได้',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_d1' $q$) like 'ERR:P0001:punpang_hand_over_unpaid:%');
select test.ok('HM6b: ชำระจัดส่งครบ → ผ่าน',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{payments}', '[{"id":"p1","status":"confirmed","amount":400}]') where id = 'hm_d1' $q$) = 'OK');
select test.ok('HM6b: จัดส่งชำระครบแล้วเปลี่ยนเป็นส่งมอบได้',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_d1' $q$) = 'OK');
select test.ok('HM6c: เตรียมจัดส่งที่เงินพักชำระแล้วแต่สินค้ายังค้าง → สร้างได้',
  test.hm_ins('hm_d2', 'OR-HM-21', 'payment_confirmed', 'delivery', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM6c: จัดส่งต้องชำระครบ (ready_to_ship ไม่ได้ แม้เงินพักครบ)',
  test.hm_try($q$ update public.punpang_orders set status = 'ready_to_ship' where id = 'hm_d2' $q$) like 'ERR:P0001:punpang_hand_over_unpaid:%');
select test.ok('HM6d: เตรียมรับที่ร้าน (เงินพัก 1000 ชำระครบ > ยอดสินค้า 400) → สร้างได้',
  test.hm_ins('hm_p1', 'OR-HM-22', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM6d: รับที่ร้านส่งมอบได้แม้สินค้าค้าง',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_p1' $q$) = 'OK');
select test.ok('HM6e: เตรียมรับที่ร้าน (เงินพัก 300 ไม่มากกว่าสินค้า 400) → สร้างได้',
  test.hm_ins('hm_p2', 'OR-HM-23', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":300}],"holdMoney":{"kind":"hide","amount":300,"notes":{"100":3}}}') = 'OK');
select test.ok('HM6e: เงินพักไม่มากกว่ายอดสินค้า → ส่งมอบค้างไม่ได้',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_p2' $q$) like 'ERR:P0001:punpang_hand_over_unpaid:%');
select test.ok('HM6f: เตรียมรับที่ร้าน (เงินพัก 1000 ชำระครบ) → สร้างได้',
  test.hm_ins('hm_p3', 'OR-HM-24', 'payment_confirmed', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}') = 'OK');
select test.ok('HM6f: เพิ่มเงินพักเป็น 1500 (ยังไม่ได้ชำระเพิ่ม) → ผ่าน',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{holdMoney}', '{"kind":"hide","amount":1500,"notes":{"1000":1,"500":1}}') where id = 'hm_p3' $q$) = 'OK');
select test.ok('HM6f: เงินพักที่ชำระยังไม่ครบ 1500 → ส่งมอบค้างไม่ได้',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_p3' $q$) like 'ERR:P0001:punpang_hand_over_unpaid:%');
select test.ok('HM6g: เตรียมรับที่ร้านที่ยังไม่ชำระและไม่มีเงินพัก → สร้างได้',
  test.hm_ins('hm_p4', 'OR-HM-25', 'awaiting_payment', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[]}') = 'OK');
select test.ok('HM6g: ไม่มีเงินพักและยังไม่ชำระ → ส่งมอบไม่ได้',
  test.hm_try($q$ update public.punpang_orders set status = 'delivered' where id = 'hm_p4' $q$) like 'ERR:P0001:punpang_hand_over_unpaid:%');
select test.ok('HM6h: สร้างออร์เดอร์ด้วยสถานะส่งมอบทั้งที่ยังไม่ชำระ → ไม่ตรวจข้อนี้ตอนสร้าง (ตรวจเฉพาะตอนเปลี่ยนสถานะ ตามแผน)',
  test.hm_ins('hm_p5', 'OR-HM-26', 'delivered', 'pickup', '{"items":[{"unitPrice":400,"qty":1}],"payments":[]}') = 'OK');
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, data) values
  ('hm_p6', 'OR-HM-27', 'c1', 'payment_confirmed', 'pickup', 'web', '{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":400}]}');
update public.punpang_orders set status = 'delivered' where id = 'hm_p6';
select test.ok('HM6i: แก้ข้อมูลออร์เดอร์ที่ส่งมอบแล้วโดยไม่เปลี่ยนสถานะ → ไม่ถูกกติกาส่งมอบบล็อก',
  test.hm_try($q$ update public.punpang_orders set data = jsonb_set(data, '{items}', '[{"unitPrice":400,"qty":1},{"unitPrice":100,"qty":1}]') where id = 'hm_p6' $q$) = 'OK');

-- ---------- HM7: ส่วนลดเดือนเกิด (หน้าร้าน) หักจากยอดบิลตามแอป ----------
select test.ok('BD1: ส่วนลดเดือนเกิด 50 หักจากยอดบิล 1000 → 950 (ตรงแอป)',
  public.punpang__bill_total('{"items":[{"unitPrice":500,"qty":2}],"birthdayDiscount":{"amount":50}}'::jsonb) = 950);
select test.ok('BD2: ยอดค้างของออร์เดอร์วันเกิดที่ชำระครบแล้วเป็น 0',
  public.punpang__balance_of('{"items":[{"unitPrice":500,"qty":2}],"birthdayDiscount":{"amount":50},"payments":[{"id":"p1","status":"confirmed","amount":950}]}'::jsonb, 'pickup') = 0);

-- ---------- HM8: ตัวช่วยตรงกับกติกาในแอป (canHandOver · holdErrors · ยอดคืน · งวดแรก) ----------
select test.ok('PH1: จัดส่งที่ยังค้าง → ส่งมอบไม่ได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[]}'::jsonb, 'delivery') = false);
select test.ok('PH1: จัดส่งที่ชำระครบ → ส่งมอบได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":400}]}'::jsonb, 'delivery') = true);
select test.ok('PH1: รับที่ร้าน เงินพักชำระครบ (1000) > ยอดสินค้า (400) → ส่งมอบได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}'::jsonb, 'pickup') = true);
select test.ok('PH1: รับที่ร้าน เงินพัก (300) ไม่มากกว่ายอดสินค้า (400) → ส่งมอบค้างไม่ได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":300}],"holdMoney":{"kind":"hide","amount":300,"notes":{"100":3}}}'::jsonb, 'pickup') = false);
select test.ok('PH1: รับที่ร้าน เงินพักยังชำระไม่ครบ (600 < 1000) → ส่งมอบค้างไม่ได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":600}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}'::jsonb, 'pickup') = false);
select test.ok('PH1: รับที่ร้าน คืนเงินพักไปแล้ว → ยอดสุทธิที่ชำระลดลงตามการคืน (1000 − 300 < 1000) → ส่งมอบค้างไม่ได้',
  public.punpang__can_hand_over('{"items":[{"unitPrice":400,"qty":1}],"payments":[{"id":"p1","status":"confirmed","amount":1000}],"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}},"returns":[{"kind":"hold","amount":300}]}'::jsonb, 'pickup') = false);
select test.ok('PH2: เงินพักถูกต้องผ่านตรวจโครงสร้าง (ได้ null) และไม่มีเงินพักก็ผ่าน',
  public.punpang__hold_error('{"holdMoney":{"kind":"hide","amount":1000,"notes":{"1000":1}}}'::jsonb) is null
  and public.punpang__hold_error('{"items":[]}'::jsonb) is null);
select test.ok('PH2: เงินพักไม่ตรงธนบัตรไม่ผ่านตรวจโครงสร้าง',
  public.punpang__hold_error('{"holdMoney":{"kind":"hide","amount":900,"notes":{"1000":1}}}'::jsonb) is not null);
select test.ok('PH3: ยอดคืนเงินพัก = เฉพาะ kind hold ที่ไม่ยกเลิก (300)',
  public.punpang__hold_returned('{"returns":[{"kind":"hold","amount":300},{"kind":"hold","amount":200,"cancelled":true},{"amount":100}]}'::jsonb) = 300);
select test.ok('PH3: ยอดคืนทุกชนิดที่ไม่ยกเลิก = 400 (ไม่นับที่ยกเลิก)',
  public.punpang__returned_all('{"returns":[{"kind":"hold","amount":300},{"kind":"hold","amount":200,"cancelled":true},{"amount":100}]}'::jsonb) = 400);
select test.ok('PH4: งวดแรกที่ยืนยันแล้วคือรายการแรกในอาร์เรย์ที่ยืนยัน (700)',
  public.punpang__first_confirmed('{"payments":[{"status":"reported","amount":500},{"status":"confirmed","amount":700},{"status":"confirmed","amount":300}]}'::jsonb) = 700);

-- ---------- HM10: การคำนวณยอดค้างย้อนหลังของออร์เดอร์วันเกิด (คำสั่งเดียวกับ migration 20261126110000) ----------
-- จำลองแถวเดิมที่ยอดค้างไม่ถูกคำนวณใหม่ (ปิดทริกเกอร์ยอดค้างชั่วคราวในธุรกรรมนี้เท่านั้น)
alter table public.punpang_orders disable trigger zz_punpang_orders_balance;
insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, balance, data) values
  ('hm_bf1', 'OR-HM-30', 'c1', 'awaiting_payment', 'pickup', 'pos', 1000,
   '{"items":[{"unitPrice":500,"qty":2}],"payments":[],"birthdayDiscount":{"amount":50}}'),
  ('hm_bf2', 'OR-HM-31', 'c1', 'awaiting_payment', 'pickup', 'web', 999,
   '{"items":[{"unitPrice":400,"qty":1}],"payments":[]}');
alter table public.punpang_orders enable trigger zz_punpang_orders_balance;
select test.ok('HM10: ก่อน backfill ยอดค้างวันเกิดยังเป็นค่าเดิม (1000)',
  (select balance from public.punpang_orders where id = 'hm_bf1') = 1000);
update public.punpang_orders set data = data
 where jsonb_typeof(data->'birthdayDiscount') = 'object'
   and balance is distinct from public.punpang__balance_of(data, fulfillment);
select test.ok('HM10: หลัง backfill ออร์เดอร์วันเกิดได้ยอดค้าง 950 (หักส่วนลดตามแอป)',
  (select balance from public.punpang_orders where id = 'hm_bf1') = 950);
select test.ok('HM10: ออร์เดอร์ที่ไม่มีส่วนลดเดือนเกิดไม่ถูกแตะ (ยอดค้างเดิม 999)',
  (select balance from public.punpang_orders where id = 'hm_bf2') = 999);

-- ---------- HM9: การติดตั้งและสิทธิ์ ----------
select test.ok('SEC1: ทริกเกอร์ด่านเงินพักติดตั้งบน punpang_orders',
  (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where c.relnamespace = 'public'::regnamespace and c.relname = 'punpang_orders'
      and t.tgname = 'punpang_orders_hold_guard' and not t.tgisinternal) = 1);
select test.ok('SEC2: anon และ authenticated เรียกตัวช่วยด่านเงินพักไม่ได้',
  not has_function_privilege('anon', 'public.punpang__can_hand_over(jsonb,text)', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.punpang__can_hand_over(jsonb,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.punpang_guard_hold_money()', 'EXECUTE')
  and not has_function_privilege('authenticated', 'public.punpang_guard_hold_money()', 'EXECUTE'));
rollback;
