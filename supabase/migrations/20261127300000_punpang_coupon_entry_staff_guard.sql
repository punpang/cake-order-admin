-- กันการตรวจคูปองของลูกค้าคนอื่นจากผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงาน: punpang__coupon_entry_ok ตอบ false สำหรับผู้เรียกดังกล่าว
-- เดิมผู้ใช้ล็อกอินเรียกได้ (พบจากการตรวจความปลอดภัย) · ทริกเกอร์ punpang_orders_insert_guard ยังทำงานตามเดิมสำหรับพนักงานและเซิร์ฟเวอร์
-- create or replace คงสิทธิ์เดิม (authenticated, security definer, search_path ว่าง)

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
  pct numeric;
  base numeric := 0;
  hold numeric;
  mode text;
  pid text;
  goods numeric := public.punpang__order_goods_coupon(p_data);
  maxt numeric := public.punpang__order_max_total(p_data);
  oid text := coalesce(p_order, '');
begin
  -- ผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงานที่ใช้งานอยู่ ไม่ควรตรวจคูปองของลูกค้าคนอื่นได้ ตอบ false
  -- (ทริกเกอร์สร้างออร์เดอร์ของพนักงานยังทำงานได้ · ผู้เรียกฝั่งเซิร์ฟเวอร์ที่ไม่มี uid ไม่ถูกกระทบ)
  if (select auth.uid()) is not null and not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then
    return false;
  end if;
  if p_entry is null or jsonb_typeof(p_entry) <> 'object' then return false; end if;
  if coalesce(p_entry->>'couponId', '') = '' then return false; end if;
  if (p_entry->>'amount') is null or (p_entry->>'amount') !~ '^[0-9]+(\.[0-9]+)?$' then return false; end if;
  amt := (p_entry->>'amount')::numeric;

  select r.data into cd from public.punpang_records r where r.collection = 'coupons' and r.id = p_entry->>'couponId';
  if cd is null then return false; end if;
  if coalesce(cd->>'type', '') <> 'discount' then return false; end if;
  if coalesce(cd->>'customerId', '') <> '' and p_customer is not null and cd->>'customerId' <> p_customer then return false; end if;

  mode := coalesce(nullif(cd->>'mode', ''), 'fixed');
  if amt < 0 then return false; end if;

  if mode = 'credit' then
    -- คูปองคืนเงิน: ยอดที่ใช้ต้องไม่เกินยอดที่จองไว้กับออร์เดอร์นี้ (บิล POS ใช้รหัสบิลเดียวกับที่จอง)
    if jsonb_typeof(cd->'holds') is distinct from 'object' or not (cd->'holds' ? oid) then return false; end if;
    hold := case when (cd->'holds'->>oid) ~ '^[0-9]+(\.[0-9]+)?$' then (cd->'holds'->>oid)::numeric else 0 end;
    if amt > hold + 0.005 then return false; end if;
  else
    if coalesce(cd->>'status', '') <> 'used' then return false; end if;
    if not (coalesce(cd->>'orderId', '') = oid or (coalesce(cd->>'orderId', '') = 'pos-pending' and p_channel = 'pos')) then return false; end if;
    if mode not in ('fixed', 'spend', 'product') then return false; end if;

    if mode = 'fixed' then
      cap := case when (cd->>'amount') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'amount')::numeric else 0 end;
      minsp := case when (cd->>'minSpend') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'minSpend')::numeric else 0 end;
      if amt > cap + 0.005 then return false; end if;
      if minsp > 0 and goods < minsp then return false; end if;
    else
      pct := case when (cd->>'pct') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'pct')::numeric else 0 end;
      cap := case when (cd->>'cap') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'cap')::numeric else 0 end;
      if not (pct > 0 and pct <= 100 and cap > 0) then return false; end if;
      if mode = 'spend' then
        -- ซื้อครบ x บาท: ยอดสินค้าต้องถึง x · ส่วนลดคิดจากยอดสินค้าทั้งออร์เดอร์
        minsp := case when (cd->>'minSpend') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'minSpend')::numeric else 0 end;
        if goods <= 0 or goods < minsp then return false; end if;
        base := goods;
      else
        -- ซื้อสินค้า x: ต้องมีสินค้านั้นในออร์เดอร์ (ไม่นับของแถม) · ส่วนลดคิดจากยอดของสินค้านั้น
        pid := coalesce(cd->>'productId', '');
        if pid = '' then return false; end if;
        select coalesce(sum(
                 case when (i->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' and (i->>'qty') ~ '^-?[0-9]+(\.[0-9]+)?$'
                      then (i->>'unitPrice')::numeric * (i->>'qty')::numeric else 0 end), 0)
          into base
          from jsonb_array_elements(case when jsonb_typeof(p_data->'items') = 'array' then p_data->'items' else '[]'::jsonb end) i
         where i->>'retailId' = pid and coalesce((i->>'promoGift')::boolean, false) = false and coalesce((i->>'noPoints')::boolean, false) = false;
        if base <= 0 then return false; end if;
      end if;
      if amt > cap + 0.005 then return false; end if;
      if amt > round(base * pct / 100, 2) + 0.01 then return false; end if;
    end if;
  end if;
  -- ส่วนที่ใช้คูปองไม่ได้ (สินค้าไม่คำนวณแต้ม) ไม่ถูกลด จึงเป็นเพดานของส่วนลด
  if amt > maxt - (public.punpang__order_goods(p_data) - goods) + 0.01 then return false; end if;
  if amt > maxt + 0.01 then return false; end if;
  return true;
end
$$;
