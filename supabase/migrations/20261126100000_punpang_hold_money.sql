-- เงินพัก (ซ่อนเงิน/ดึงเงิน) ระดับฐานข้อมูล · สูตรตรงกับ src/lib/pricing.js (orderTotals) และ src/lib/holdMoney.js
-- เงินพักเป็นของลูกค้า ไม่ใช่รายได้: ไม่เข้ายอดบิล (VAT/กำไร/แต้ม/คูปอง) · ยอดที่ต้องจ่ายรวม (payable) = ยอดบิล + เงินพัก
-- ยอดค้าง (balance) = payable − ชำระแล้ว + เงินพักที่คืนไปแล้ว (ลดเงินพักแล้วคืนเงิน ไม่เปิดยอดค้างใหม่)
-- กติกาที่บังคับที่นี่ (ด่านสร้าง/แก้ไขออร์เดอร์ · ทุกผู้เขียนรวมถึงเซิร์ฟเวอร์):
--   (1) โครงสร้างเงินพัก: ประเภท hide/pull · ธนบัตร 20/50/100/500/1000 เป็นจำนวนเต็มไม่ติดลบ · ยอดตรงกับธนบัตร (ตรวจตอนสร้าง หรือตอนเงินพักเปลี่ยน)
--   (2) งวดแรกต้องครอบคลุมเงินพัก: ตอนยอดยืนยันเปลี่ยนจาก "ยังไม่มี" เป็น "มีแล้ว" · หลังจากนั้นการเพิ่มเงินพักใช้กติกายอดค้างแทน
--   (3) ส่งมอบ/จัดส่ง (ready_to_ship/shipping/delivered) ตอนเปลี่ยนเข้าสถานะ ตามกติกาแอป canHandOver: จัดส่งต้องชำระครบ · รับที่ร้านชำระครบ หรือเงินพักชำระครบและมากกว่ายอดสินค้า
-- ไม่บังคับที่นี่: เพดานจำนวนธนบัตร (ตั้งค่าในแอป) · การบันทึกคืนเงินเมื่อลดเงินพัก (แอปบันทึกใน returns แล้วด่านยอดชำระเกินตรวจ)
--   · ข้อ (3) ไม่ตรวจตอนสร้างออร์เดอร์ (ตรวจเฉพาะตอนเปลี่ยนสถานะ ตามแผน · ออร์เดอร์ทดสอบเดิมสร้างด้วยสถานะจัดส่งที่ยังไม่ชำระ)
-- ยอดบิลหักส่วนลดเดือนเกิด (หน้าร้าน) ด้วยให้ตรงแอป · เดิมไม่หัก จึงทำให้ยอดค้างและด่านส่งมอบของออร์เดอร์วันเกิดผิด
-- ข้อจำกัด: ออร์เดอร์วันเกิดที่บันทึกไว้ก่อนไฟล์นี้ ยอดค้างที่เก็บไว้ยังเป็นค่าเดิมจนกว่าจะบันทึกใหม่ (ไม่มีการแก้ข้อมูลย้อนหลังในไฟล์นี้)

-- 1) ยอดบิล (สูตรเดิม + หักส่วนลดเดือนเกิด) · ตรวจกับแอปด้วย supabase/tests/hold_money.test.sql
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
  birthday numeric;
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
  birthday := public.punpang__num(d #>> '{birthdayDiscount,amount}');
  gross := round(subtotal + shipping + adjustment - points - coupon_disc - birthday, 2);
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

-- 2) ตัวช่วยเงินพัก (อ่านค่าที่อ่านไม่ได้ = 0 เหมือน Number(x) || 0 ในแอป)
-- เงินพัก (บาท) ปัดสตางค์
create or replace function public.punpang__hold_amount(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(public.punpang__num(d #>> '{holdMoney,amount}'), 2)
$$;

-- ยอดคืนทุกชนิดที่ไม่ถูกยกเลิก (ตามแอป orderTotals.returned)
create or replace function public.punpang__returned_all(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(public.punpang__num(r->>'amount')), 0)
    from jsonb_array_elements(case when jsonb_typeof(d->'returns') = 'array' then d->'returns' else '[]'::jsonb end) r
   where (r->'cancelled') is distinct from 'true'::jsonb
$$;

-- ยอดเงินพักที่คืนตอนลดเงินพัก (kind = hold ที่ไม่ถูกยกเลิก) ตามแอป orderTotals.holdReturned
create or replace function public.punpang__hold_returned(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(public.punpang__num(r->>'amount')), 0)
    from jsonb_array_elements(case when jsonb_typeof(d->'returns') = 'array' then d->'returns' else '[]'::jsonb end) r
   where (r->>'kind') = 'hold' and (r->'cancelled') is distinct from 'true'::jsonb
$$;

-- จำนวนรายการชำระที่ยืนยันแล้ว และยอดของรายการยืนยันแรก (ตามลำดับในอาร์เรย์)
create or replace function public.punpang__confirmed_count(d jsonb)
returns integer
language sql
immutable
set search_path = ''
as $$
  select count(*)::integer
    from jsonb_array_elements(case when jsonb_typeof(d->'payments') = 'array' then d->'payments' else '[]'::jsonb end) p
   where (p->>'status') = 'confirmed'
$$;

create or replace function public.punpang__first_confirmed(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce((
    select public.punpang__num(e.p->>'amount')
      from jsonb_array_elements(case when jsonb_typeof(d->'payments') = 'array' then d->'payments' else '[]'::jsonb end)
             with ordinality as e(p, n)
     where (e.p->>'status') = 'confirmed'
     order by e.n
     limit 1
  ), 0)
$$;

-- ยอดที่ลูกค้าต้องจ่ายรวม = ยอดบิล + เงินพัก (ตามแอป orderTotals.payable)
create or replace function public.punpang__payable_total(d jsonb, f text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(public.punpang__bill_total(d || jsonb_build_object('fulfillment', f)) + public.punpang__hold_amount(d), 2)
$$;

-- ยอดค้าง = ยอดที่ต้องจ่าย − ชำระแล้ว + เงินพักที่คืนไปแล้ว (ตามแอป orderTotals.balance)
create or replace function public.punpang__balance_of(d jsonb, f text)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select round(public.punpang__payable_total(d, f) - public.punpang__paid_confirmed(d) + public.punpang__hold_returned(d), 2)
$$;

-- เปลี่ยนเป็นสถานะส่งมอบ/จัดส่งได้ไหม (ตามแอป canHandOver)
-- ยอดค้างไม่เกิน 0.005 → ได้ · จัดส่ง → ไม่ได้ · รับที่ร้าน → ได้เมื่อเงินพักชำระครบ (ยอดสุทธิจากคืนสินค้า) และเงินพักมากกว่ายอดสินค้า
create or replace function public.punpang__can_hand_over(d jsonb, f text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  total numeric := public.punpang__bill_total(d || jsonb_build_object('fulfillment', f));
  hold numeric := public.punpang__hold_amount(d);
  paid_net numeric;
begin
  if not (public.punpang__balance_of(d, f) > 0.005) then return true; end if;
  if f = 'delivery' then return false; end if;
  paid_net := public.punpang__paid_confirmed(d) - public.punpang__returned_all(d);
  return hold > 0 and paid_net + 0.005 >= hold and hold > total;
end
$$;

-- ตรวจโครงสร้างเงินพัก → ข้อความผิดพลาด (null = ผ่าน) · ตามแอป holdErrors (ยกเว้นเพดานจำนวนธนบัตรที่ตั้งในแอป)
create or replace function public.punpang__hold_error(d jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  hm jsonb := d->'holdMoney';
  notes jsonb;
  v integer;
  s text;
  cnt numeric := 0;
  amt numeric := 0;
begin
  if hm is null or jsonb_typeof(hm) = 'null' then return null; end if;
  if jsonb_typeof(hm) <> 'object' then return 'รูปแบบเงินพักไม่ถูกต้อง'; end if;
  if (hm->>'kind') is distinct from 'hide' and (hm->>'kind') is distinct from 'pull' then
    return 'ประเภทเงินพักไม่ถูกต้อง';
  end if;
  notes := hm->'notes';
  if jsonb_typeof(notes) is distinct from 'object' then return 'รูปแบบธนบัตรไม่ถูกต้อง'; end if;
  if exists (select 1 from jsonb_object_keys(notes) k where k not in ('20', '50', '100', '500', '1000')) then
    return 'มีธนบัตรที่ไม่รองรับ';
  end if;
  foreach v in array array[20, 50, 100, 500, 1000] loop
    s := notes->>(v::text);
    if s is not null and s !~ '^[0-9]+$' then
      return 'จำนวนธนบัตร ' || v || ' บาทต้องเป็นจำนวนเต็มไม่ติดลบ';
    end if;
    cnt := cnt + coalesce(s::numeric, 0);
    amt := amt + coalesce(s::numeric, 0) * v;
  end loop;
  if cnt < 1 then return 'ต้องระบุธนบัตรอย่างน้อย 1 ใบ'; end if;
  if abs(amt - public.punpang__num(hm->>'amount')) > 0.005 then return 'ยอดเงินพักไม่ตรงกับจำนวนธนบัตร'; end if;
  return null;
end
$$;

-- 3) ยอดคงค้างคำนวณใหม่ทุกครั้งที่บันทึก (สูตรใหม่ที่รวมเงินพัก) · ยอดที่แอปส่งมาไม่มีผล
create or replace function public.punpang_orders_balance_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- การจัดส่งอยู่ที่คอลัมน์ fulfillment (ไม่อยู่ใน data) จึงส่งเข้าไปด้วย
  new.balance := public.punpang__balance_of(new.data, new.fulfillment);
  return new;
end $$;

-- 4) ด่านยอดชำระเกินยอดที่ต้องจ่าย (สูตรเดิม · ยอดที่ต้องจ่ายรวมเงินพัก และหักเงินพักที่คืนแล้ว)
-- ตรวจเฉพาะตอนยอดยืนยันสุทธิเพิ่มขึ้น · การคืนเงินพัก (ยอดสุทธิลดลง) และการลดยอดบิลไม่ถูกบล็อก
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
    paid_old := public.punpang__paid_confirmed(old.data) - public.punpang__hold_returned(old.data);
  end if;
  paid_new := public.punpang__paid_confirmed(new.data) - public.punpang__hold_returned(new.data);
  if paid_new <= paid_old + 0.005 then return new; end if; -- ยอดยืนยันสุทธิไม่ได้เพิ่ม
  bill := public.punpang__payable_total(new.data, new.fulfillment);
  if paid_new > bill + 0.01 then
    raise exception 'punpang_over_bill: ยอดที่ยืนยันรวม % บาท เกินยอดบิล % บาท', paid_new, bill using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- 5) ด่านเงินพัก: โครงสร้าง · งวดแรก · การส่งมอบ (ดูหัวไฟล์) · ข้ามออร์เดอร์ที่ไม่ได้เปลี่ยนสิ่งที่ด่านนี้ดู
create or replace function public.punpang_guard_hold_money()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  err text;
  chk_hold boolean;
  hold_new numeric;
  cnt_old integer := 0;
  cnt_new integer;
begin
  -- โหมดทดสอบ (punpang_test) ข้ามด่านนี้ (เหมือนด่านอื่น)
  if tg_table_schema <> 'public' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data and new.status is not distinct from old.status
       and new.fulfillment is not distinct from old.fulfillment then
      return new;
    end if;
  end if;

  -- (1) โครงสร้างเงินพัก: ตรวจตอนสร้างออร์เดอร์ หรือตอนเงินพักเปลี่ยน (ออร์เดอร์เดิมที่ไม่ได้แตะเงินพักไม่ถูกตรวจซ้ำ)
  if tg_op = 'INSERT' then
    chk_hold := true;
  else
    chk_hold := (new.data->'holdMoney') is distinct from (old.data->'holdMoney');
  end if;
  if chk_hold then
    err := public.punpang__hold_error(new.data);
    if err is not null then
      raise exception 'punpang_hold_invalid: %', err using errcode = 'P0001';
    end if;
  end if;

  -- (2) งวดแรก: ตอนยอดยืนยันเปลี่ยนจาก "ยังไม่มี" เป็น "มีแล้ว" ต้องครอบคลุมเงินพัก (ตามแอป confirmPayment)
  hold_new := public.punpang__hold_amount(new.data);
  if tg_op = 'UPDATE' then
    cnt_old := public.punpang__confirmed_count(old.data);
  end if;
  cnt_new := public.punpang__confirmed_count(new.data);
  if hold_new > 0 and cnt_old = 0 and cnt_new > 0
     and public.punpang__first_confirmed(new.data) + 0.004 < hold_new then
    raise exception 'punpang_hold_first_payment: การชำระครั้งแรกต้องครอบคลุมเงินพักทั้งหมด' using errcode = 'P0001';
  end if;

  -- (3) ส่งมอบ/จัดส่ง: ตอนเปลี่ยนเข้าสถานะนี้ต้องทำได้ตามกติกาเดียวกับแอป (canHandOver) · การสร้างออร์เดอร์ไม่ตรวจข้อนี้ (ตามแผน)
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status and new.status in ('ready_to_ship', 'shipping', 'delivered') then
      if not public.punpang__can_hand_over(new.data, new.fulfillment) then
        raise exception 'punpang_hand_over_unpaid: ยังชำระไม่ครบ ส่งมอบ/จัดส่งไม่ได้' using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end
$$;

-- สิทธิ์: ฟังก์ชันชุดนี้ใช้ภายในด่านและทริกเกอร์เท่านั้น ไม่เปิดให้ผู้ใช้เรียก (Supabase เปิดสิทธิ์เริ่มต้นให้ทุกฟังก์ชันใหม่)
revoke all on function public.punpang__hold_amount(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__returned_all(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__hold_returned(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__confirmed_count(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__first_confirmed(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__payable_total(jsonb, text) from public, anon, authenticated;
revoke all on function public.punpang__balance_of(jsonb, text) from public, anon, authenticated;
revoke all on function public.punpang__can_hand_over(jsonb, text) from public, anon, authenticated;
revoke all on function public.punpang__hold_error(jsonb) from public, anon, authenticated;
revoke all on function public.punpang_guard_hold_money() from public, anon, authenticated;

drop trigger if exists punpang_orders_hold_guard on public.punpang_orders;
create trigger punpang_orders_hold_guard
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_guard_hold_money();

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่เปลี่ยนไปยัง punpang_test (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
