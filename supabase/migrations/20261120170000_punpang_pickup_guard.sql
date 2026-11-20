-- เวลานัดรับของออร์เดอร์ (pickup_at / data.pickupAt): เปลี่ยนได้เฉพาะผู้มีสิทธิ์ editPickup หรือ manage
-- เดิมไม่มีกติกาเรื่องเวลานัด ผู้มีสิทธิ์แก้ออร์เดอร์ทั่วไป (เช่น ช่างที่บันทึกรูปงาน) จึงเปลี่ยนเวลานัดได้
-- ฟังก์ชันนี้คัดลอกจาก 20261115050000_punpang_coupon_guard.sql แล้วเพิ่มบล็อกเวลานัดเท่านั้น (กติกาอื่นคงเดิม)

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

  -- เวลานัดรับ: เปลี่ยนได้เฉพาะผู้มีสิทธิ์แก้เวลานัด (editPickup) · ช่างและพนักงานส่งแก้เวลานัดไม่ได้
  if new.pickup_at is distinct from old.pickup_at or old.data->'pickupAt' is distinct from new.data->'pickupAt' then
    if not public.punpang_has_perm('editPickup') then
      raise exception 'no permission to change the pickup time' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_field_guard() from public, anon, authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
