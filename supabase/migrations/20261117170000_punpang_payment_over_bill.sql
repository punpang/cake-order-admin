-- ยอดชำระที่ยืนยันแล้วของออร์เดอร์ต้องไม่เกินยอดบิล (ระดับฐานข้อมูล)
-- ยอดบิลคิดจากรายการในออร์เดอร์ ตามสูตร orderTotals ใน src/lib/pricing.js (ราคาต่อหน่วย × จำนวน · ค่าส่ง ส่งฟรี ปรับราคา คะแนน คูปอง VAT)
-- ตรวจเฉพาะตอนยอดยืนยันเพิ่มขึ้น (สร้างออร์เดอร์ที่มีการชำระยืนยัน หรือเพิ่มรายการยืนยัน) · การลดยอดบิลหรือยกเลิกการชำระไม่ถูกบล็อก
-- ค่าคลาดเคลื่อนเศษสตางค์ยอมรับได้ 0.01 บาท · สูตรถูกเทียบกับแอปด้วย supabase/tests/payment_bill_parity.test.sql
-- ข้อจำกัด: ยอดบิลมาจากรายการที่แอปบันทึก ราคาหน้าร้าน (POS) ยังตรวจหลังบันทึก จึงกันได้เฉพาะยอดชำระที่เกินยอดบิลที่บันทึกไว้

-- ตัวช่วย: อ่านค่าตัวเลข (ค่าที่อ่านไม่ได้ = 0 เหมือน Number(x) || 0 ในแอป)
create or replace function public.punpang__num(v text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when v ~ '^\s*-?[0-9]+(\.[0-9]+)?\s*$' then v::numeric else 0 end
$$;

-- ยอดที่ยืนยันแล้วของออร์เดอร์ (เฉพาะรายการสถานะ confirmed)
create or replace function public.punpang__paid_confirmed(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(public.punpang__num(p->>'amount')), 0)
    from jsonb_array_elements(case when jsonb_typeof(d->'payments') = 'array' then d->'payments' else '[]'::jsonb end) p
   where (p->>'status') = 'confirmed'
$$;

-- ยอดบิลตามสูตร orderTotals ในแอป (ยอดรวมหลังส่วนลดทุกประเภทและ VAT · ไม่ติดลบ)
create or replace function public.punpang__bill_total(d jsonb)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  items jsonb := case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end;
  coupons jsonb := case when jsonb_typeof(d->'couponsUsed') = 'array' then d->'couponsUsed' else '[]'::jsonb end;
  subtotal numeric;
  ship_fee numeric;
  ship_waived numeric;
  shipping numeric;
  adjustment numeric;
  points numeric;
  coupon_disc numeric;
  gross numeric;
  rate numeric;
  vat_mode text;
  base numeric;
  vat numeric;
  vat_add numeric;
begin
  select coalesce(sum(public.punpang__num(i->>'unitPrice') * public.punpang__num(i->>'qty')), 0) into subtotal
    from jsonb_array_elements(items) i;
  ship_fee := case when (d->>'fulfillment') = 'delivery' then public.punpang__num(d->>'shippingFee') else 0 end;
  ship_waived := case when (d #>> '{shipPromo,free}') = 'true' then ship_fee else 0 end;
  shipping := ship_fee - ship_waived;
  adjustment := public.punpang__num(d #>> '{adjustment,amount}');
  points := public.punpang__num(d #>> '{pointsUsed,amount}');
  select coalesce(sum(public.punpang__num(c->>'amount')), 0) into coupon_disc
    from jsonb_array_elements(coupons) c;
  gross := round(subtotal + shipping + adjustment - points - coupon_disc, 2);
  rate := public.punpang__num(d #>> '{vat,rate}');
  vat_mode := case when rate > 0
                   then (case when (d #>> '{vat,mode}') = 'exclusive' then 'exclusive' else 'inclusive' end)
                   else null end;
  base := greatest(gross, 0);
  vat := case vat_mode
           when 'exclusive' then round(base * rate / 100, 2)
           when 'inclusive' then round(base * rate / (100 + rate), 2)
           else 0 end;
  vat_add := case when vat_mode = 'exclusive' then vat else 0 end;
  return greatest(round(gross + vat_add, 2), 0);
end
$$;

-- ด่าน: ยอดยืนยันเพิ่มขึ้นแล้วเกินยอดบิลไม่ได้ (ทั้งการสร้างและการแก้ไข · ทุกบทบาทรวมบริการ)
create or replace function public.punpang_guard_payment_over_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid_new numeric;
  paid_old numeric := 0;
  bill numeric;
begin
  -- โหมดทดสอบ (punpang_test) ข้ามด่านนี้: ข้อมูลจำลองสร้างตามสถานะสุดท้าย และมีออร์เดอร์ที่ยอดชำระเกินยอดบิลหลังลดราคาแล้ว (เกิดได้จริงในแอป)
  if tg_table_schema <> 'public' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data then return new; end if;
    paid_old := public.punpang__paid_confirmed(old.data);
  end if;
  paid_new := public.punpang__paid_confirmed(new.data);
  if paid_new <= paid_old + 0.005 then return new; end if; -- ยอดยืนยันไม่ได้เพิ่ม
  bill := public.punpang__bill_total(new.data);
  if paid_new > bill + 0.01 then
    raise exception 'punpang_over_bill: ยอดที่ยืนยันรวม % บาท เกินยอดบิล % บาท', paid_new, bill using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- สิทธิ์: ฟังก์ชันชุดนี้ใช้ภายในด่านเท่านั้น ไม่เปิดให้ผู้ใช้เรียก (Supabase เปิดสิทธิ์เริ่มต้นให้ anon/authenticated ทุกฟังก์ชันใหม่)
revoke all on function public.punpang__num(text) from public, anon, authenticated;
revoke all on function public.punpang__paid_confirmed(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__bill_total(jsonb) from public, anon, authenticated;
revoke all on function public.punpang_guard_payment_over_bill() from public, anon, authenticated;

drop trigger if exists punpang_orders_payment_over_bill on public.punpang_orders;
create trigger punpang_orders_payment_over_bill
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_guard_payment_over_bill();

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีฟังก์ชันใหม่ด้วย (ดู supabase/tests/mirror.test.sql ข้อ A6)
select punpang_test.punpang_test_sync();
