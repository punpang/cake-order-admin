-- ทดสอบสินค้าไม่คำนวณแต้ม (noPoints) ที่เซิร์ฟเวอร์ (migration 20261124100000)
-- ครอบคลุม: ฐานยอดคูปอง/ฐานแต้มไม่รวม noPoints · คูปองไม่ลดสินค้านี้ · ซื้อครบ/ซื้อสินค้าไม่นับสินค้านี้
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น) · ทำในธุรกรรมที่ย้อนกลับ

begin;

-- คูปองที่ใช้กับออร์เดอร์ np_o (จองไว้แล้ว)
insert into public.punpang_records (collection, id, data) values
  ('coupons', 'np_spend', '{"type":"discount","status":"used","orderId":"np_o","customerId":"c1","name":"ซื้อครบ 500 ลด 10%","mode":"spend","minSpend":500,"pct":10,"cap":100,"amount":100}'),
  ('coupons', 'np_fixed', '{"type":"discount","status":"used","orderId":"np_o","customerId":"c1","name":"ลด 50","amount":50,"minSpend":0}'),
  ('coupons', 'np_prod', '{"type":"discount","status":"used","orderId":"np_o","customerId":"c1","name":"คัพเค้ก 20%","mode":"product","productId":"np_cup","pct":20,"cap":60,"amount":60}');

select test.ok('NP1 ฐานยอดคูปองไม่รวมสินค้าไม่คำนวณแต้ม = 300 (จาก 300 + 500)',
  public.punpang__order_goods_coupon('{"items":[{"retailId":"a","unitPrice":300,"qty":1},{"retailId":"b","unitPrice":500,"qty":1,"noPoints":true}]}'::jsonb) = 300);

select test.ok('NP2 ฐานแต้มก่อน VAT (VAT ใน 7%) ไม่รวมสินค้าไม่คำนวณแต้ม = 280.37',
  round(public.punpang__order_goods_exvat_points('{"vat":{"rate":7,"mode":"inclusive"},"items":[{"retailId":"a","unitPrice":300,"qty":1},{"retailId":"b","unitPrice":500,"qty":1,"noPoints":true}]}'::jsonb), 2) = 280.37);

select test.ok('NP3 ซื้อครบ: ยอดปกติ 400 ไม่ถึง 500 แม้รวมสินค้าไม่คำนวณแต้มแล้วเกิน → คูปองไม่ผ่าน',
  not public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"a","unitPrice":400,"qty":1},{"retailId":"b","unitPrice":300,"qty":1,"noPoints":true}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_spend","amount":40}'::jsonb));

select test.ok('NP4 ซื้อครบ: ยอดปกติถึงเกณฑ์ → ลดได้เฉพาะส่วนปกติ (10% ของ 500 = 50)',
  public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"a","unitPrice":500,"qty":1},{"retailId":"b","unitPrice":300,"qty":1,"noPoints":true}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_spend","amount":50}'::jsonb));

select test.ok('NP5 ลดเป็นบาท: ส่วนลด 50 เกินส่วนที่ใช้คูปองได้ (30) → ไม่ผ่าน',
  not public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"a","unitPrice":30,"qty":1},{"retailId":"b","unitPrice":500,"qty":1,"noPoints":true}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_fixed","amount":50}'::jsonb));

select test.ok('NP6 ลดเป็นบาท: ส่วนลด 30 พอดีส่วนที่ใช้ได้ → ผ่าน',
  public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"a","unitPrice":30,"qty":1},{"retailId":"b","unitPrice":500,"qty":1,"noPoints":true}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_fixed","amount":30}'::jsonb));

select test.ok('NP7 ซื้อสินค้าที่กำหนด: สินค้านั้นเป็นไม่คำนวณแต้ม → คูปองไม่ผ่าน',
  not public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"np_cup","unitPrice":100,"qty":1,"noPoints":true},{"retailId":"a","unitPrice":200,"qty":1}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_prod","amount":20}'::jsonb));

select test.ok('NP8 ออร์เดอร์ไม่มี noPoints ผลเหมือนเดิม: ลดเป็นบาท 50 ผ่าน',
  public.punpang__coupon_entry_ok('np_o', 'web', 'c1',
    '{"items":[{"retailId":"a","unitPrice":300,"qty":1}],"couponsUsed":[],"adjustment":{"amount":0}}'::jsonb,
    '{"couponId":"np_fixed","amount":50}'::jsonb));

rollback;
