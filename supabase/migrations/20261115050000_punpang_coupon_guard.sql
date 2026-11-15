-- รอบแก้ 2026-11-15 (ส่วนลดคูปอง) · รันหลัง 20261115040000 · รันซ้ำได้ปลอดภัย
-- เดิมส่วนลดคูปองในออร์เดอร์ (couponsUsed) คำนวณในแอปแล้วบันทึกลงแถวออร์เดอร์ตรง ๆ: ผู้มีสิทธิ์ใช้คะแนนใส่คูปองที่ไม่มีอยู่จริง/จำนวนเกินได้
-- ตอนนี้รายการคูปองที่เพิ่มหรือเปลี่ยนจำนวน (ทั้งตอนสร้างและตอนแก้ออร์เดอร์) ต้องตรงกับคูปองที่จองไว้กับออร์เดอร์นี้ที่เซิร์ฟเวอร์:
--   1) คูปองมีอยู่จริง เป็นส่วนลด (type discount) และถูกจองแล้ว (status used) กับออร์เดอร์นี้ (orderId = รหัสออร์เดอร์)
--      ข้อยกเว้นเดียว: ขายหน้าร้าน (channel pos) ที่จองด้วยรหัสชั่วคราว pos-pending ก่อนสร้างบิล (ดูหมายเหตุใน docs/security.md)
--   2) ถ้าคูปองระบุเจ้าของ ต้องเป็นผู้ซื้อของออร์เดอร์ · ยอดสินค้าต้องถึง minSpend ของคูปอง
--   3) ส่วนลดต้องไม่เกินมูลค่าคูปอง และไม่เกินยอดสูงสุดของออร์เดอร์
-- การลบคูปองออกจากออร์เดอร์ไม่ต้องตรวจ (ส่วนลดลดลงเสมอ) · ผู้จัดการ (manage) ผ่านทุกข้อ

-- ============================================================================
-- 1) ตรวจรายการคูปองหนึ่งรายการ (ทำงานด้วยสิทธิ์เจ้าของฟังก์ชันเพื่ออ่านแถวคูปอง · ไม่คืนข้อมูลคูปองให้ผู้เรียก)
-- ============================================================================
create or replace function public.punpang__coupon_entry_ok(
  p_order text,
  p_channel text,
  p_customer text,
  p_data jsonb,
  p_entry jsonb
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  cd jsonb;
  amt numeric;
  cap numeric;
  minsp numeric;
  goods numeric := public.punpang__order_goods(p_data);
  maxt numeric := public.punpang__order_max_total(p_data);
  oid text := coalesce(p_order, '');
begin
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then return false; end if;
  if coalesce(p_entry->>'couponId', '') = '' then return false; end if;
  if (p_entry->>'amount') is null or (p_entry->>'amount') !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;
  amt := (p_entry->>'amount')::numeric;

  select r.data into cd from public.punpang_records r where r.collection = 'coupons' and r.id = p_entry->>'couponId';
  if cd is null then return false; end if;
  if coalesce(cd->>'type', '') <> 'discount' or coalesce(cd->>'status', '') <> 'used' then return false; end if;
  if not (coalesce(cd->>'orderId', '') = oid or (coalesce(cd->>'orderId', '') = 'pos-pending' and p_channel = 'pos')) then return false; end if;
  if coalesce(cd->>'customerId', '') <> '' and p_customer is not null and cd->>'customerId' <> p_customer then return false; end if;

  cap := case when (cd->>'amount') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'amount')::numeric else 0 end;
  minsp := case when (cd->>'minSpend') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'minSpend')::numeric else 0 end;
  if amt < 0 or amt > cap + 0.005 then return false; end if;
  if minsp > 0 and goods < minsp then return false; end if;
  if amt > maxt + 0.01 then return false; end if;
  return true;
end
$$;
revoke all on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- 2) ตอนแก้ออร์เดอร์: ตรวจเฉพาะรายการที่เพิ่มหรือเปลี่ยนจำนวน (แทนการตรวจสิทธิ์อย่างเดียวของฉบับ 20261115020000)
-- ============================================================================
create or replace function public.punpang_orders_field_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pr record;
  np jsonb;
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- ราคา/จำนวนของรายการ: แอดมินแก้รายการ หรือผู้ปรับราคา หรือผู้สร้างออร์เดอร์ตอนยังเป็นร่าง/รอชำระ
  if public.punpang__items_money(old.data) is distinct from public.punpang__items_money(new.data) then
    if not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
            or (public.punpang_has_perm('createOrder') and old.status in ('draft', 'awaiting_payment'))) then
      raise exception 'no permission to change item prices or quantities' using errcode = '42501';
    end if;
  end if;

  -- ปรับราคา/ส่วนลด (adjustment) → ผู้ปรับราคาเท่านั้น
  if old.data->'adjustment' is distinct from new.data->'adjustment' and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to change adjustment' using errcode = '42501';
  end if;

  -- ค่าส่ง/VAT
  if (old.data->'shippingFee' is distinct from new.data->'shippingFee' or old.data->'vat' is distinct from new.data->'vat')
     and not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
              or public.punpang_has_perm('createOrder') or public.punpang_has_perm('editPickup')) then
    raise exception 'no permission to change shipping fee or VAT' using errcode = '42501';
  end if;

  -- จำนวนเงินของงวดที่มีอยู่แล้ว: งวดที่ยืนยันแล้วต้องมีสิทธิ์ยืนยัน/ยกเลิกยืนยัน/คืนเงิน · งวดที่แจ้งต้องมีสิทธิ์แจ้งยอด/ยืนยัน
  for pr in
    select v.value as p
      from jsonb_array_elements(case when jsonb_typeof(old.data->'payments') = 'array' then old.data->'payments' else '[]'::jsonb end) as v(value)
  loop
    if pr.p->>'id' is null then continue; end if;
    select x.value into np
      from jsonb_array_elements(case when jsonb_typeof(new.data->'payments') = 'array' then new.data->'payments' else '[]'::jsonb end) as x(value)
     where x.value->>'id' = pr.p->>'id'
     limit 1;
    if np is not null and (pr.p->'amount') is distinct from (np->'amount') then
      if pr.p->>'status' = 'confirmed' then
        if not (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial')) then
          raise exception 'no permission to change a confirmed payment amount' using errcode = '42501';
        end if;
      elsif not (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
        raise exception 'no permission to change a payment amount' using errcode = '42501';
      end if;
    end if;
  end loop;

  -- ผู้ซื้อของออร์เดอร์ (เปลี่ยนผู้ซื้อ)
  if new.customer_id is distinct from old.customer_id and not public.punpang_has_perm('changeBuyer') then
    raise exception 'no permission to change the buyer' using errcode = '42501';
  end if;

  -- คะแนนที่ใช้: ตั้งค่าใหม่ต้องผ่านเซิร์ฟเวอร์ (RPC punpang_apply_points) · ลบออกได้ตามสิทธิ์
  if old.data->'pointsUsed' is distinct from new.data->'pointsUsed' then
    if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
      raise exception 'points can only be applied through the server' using errcode = '42501';
    end if;
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to remove points from the order' using errcode = '42501';
    end if;
  end if;

  -- คูปองที่ใช้ในออร์เดอร์ (ส่วนลด): ต้องมีสิทธิ์ก่อน แล้วรายการที่เพิ่มหรือเปลี่ยนจำนวนต้องตรงกับคูปองที่จองไว้กับออร์เดอร์นี้
  if old.data->'couponsUsed' is distinct from new.data->'couponsUsed' then
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to change coupons on the order' using errcode = '42501';
    end if;
    for cp in
      select v.value as e
        from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
    loop
      if exists (
        select 1
          from jsonb_array_elements(case when jsonb_typeof(old.data->'couponsUsed') = 'array' then old.data->'couponsUsed' else '[]'::jsonb end) as o(value)
         where o.value = cp.e
      ) then
        continue; -- รายการเดิมที่ไม่เปลี่ยน
      end if;
      if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
        raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_field_guard() from public, anon, authenticated;

-- ============================================================================
-- 3) ตอนสร้างออร์เดอร์ใหม่: คูปองที่ใส่มาต้องผ่านการตรวจเดียวกัน (ก่อนหน้านี้ไม่มีตรวจตอนสร้าง)
-- ============================================================================
create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_insert_guard on public.punpang_orders;
create trigger punpang_orders_insert_guard
  before insert on public.punpang_orders
  for each row execute function public.punpang_orders_insert_guard();
