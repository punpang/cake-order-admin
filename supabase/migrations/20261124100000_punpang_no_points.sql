-- สินค้าไม่คำนวณแต้ม (noPoints) · ใช้คูปองส่วนลดไม่ได้ทุกแบบ · ไม่นับแต้ม/สิทธิ์หมุน/ยอดสมาชิก
-- 1) punpang__order_goods_coupon: ยอดสินค้าที่ใช้คูปองได้ (ไม่รวม noPoints)
-- 2) punpang__order_goods_exvat_points: ฐานแต้มก่อน VAT (ไม่รวม noPoints) ใช้เป็นเพดานของ punpang_award_order
-- 3) punpang__coupon_entry_ok: ฐานยอดคูปองไม่รวม noPoints · ส่วนลดไม่เกินยอดส่วนที่ใช้คูปองได้
-- 4) punpang_award_order: เพดานฐานแต้มใช้ยอดที่ไม่รวม noPoints (ส่วนอื่นเหมือนเดิม)
-- ออร์เดอร์เดิมไม่มี noPoints → ผลเหมือนเดิมทุกประการ

create or replace function public.punpang__order_goods_coupon(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(
    case when (i->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' and (i->>'qty') ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (i->>'unitPrice')::numeric * (i->>'qty')::numeric else 0 end), 0)
  from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) i
  where coalesce((i->>'noPoints')::boolean, false) = false
$$;
revoke all on function public.punpang__order_goods_coupon(jsonb) from public, anon, authenticated;

create or replace function public.punpang__order_goods_exvat_points(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when x.r > 0 and coalesce(d->'vat'->>'mode', 'inclusive') <> 'exclusive'
              then x.g * 100 / (100 + x.r) else x.g end
  from (select public.punpang__order_goods_coupon(d) as g,
               case when (d->'vat'->>'rate') ~ '^[0-9]+(\.[0-9]+)?$' then (d->'vat'->>'rate')::numeric else 0 end as r) x
$$;
revoke all on function public.punpang__order_goods_exvat_points(jsonb) from public, anon, authenticated;

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
revoke all on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) to authenticated;

create or replace function public.punpang_award_order(p_order text, p_points integer, p_bonus integer, p_spins integer, p_base numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; ledger jsonb; lot_id text := public.punpang__pts_newid();
  exp_at text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  label text;
  sp integer;
  earn_per numeric := greatest(public.punpang__pts_cfg('earnPer', 100), 0.01);
  spin_per numeric := greatest(public.punpang__pts_cfg('spinPer', 500), 0.01);
  cap_points numeric;
  cap_spins numeric;
  mcfg jsonb := public.punpang__member_cfg();
  mst jsonb;
  mrmin numeric;
  mmult numeric := 1;
begin
  if role_ is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 0 or p_points > 1000000 or p_spins is null or p_spins < 0 or p_spins > 10000
     or p_bonus is null or p_bonus < 0 or p_base is null or p_base < 0 then
    return jsonb_build_object('error', 'invalid');
  end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;     -- คิวต่อลูกค้า
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  if o.status is distinct from 'delivered' then return jsonb_build_object('error', 'not_delivered'); end if;
  if o.data->'loyalty' is not null and o.data->'loyalty' <> 'null'::jsonb then
    return jsonb_build_object('error', 'already_awarded');
  end if;

  -- เพดานจากข้อมูลของออร์เดอร์เอง (ค่าที่ไคลเอนต์ส่งมาต้องไม่เกินที่สูตรของแอปให้ได้) · เผื่อเศษปัดสองตำแหน่ง 0.01
  if p_base > public.punpang__order_goods_exvat_points(o.data) + 0.01 or p_bonus > p_points then
    return jsonb_build_object('error', 'invalid');
  end if;

  -- (ก) ตัวคูณระดับของบิลนี้ (ตามสถานะก่อนบิลนี้) · โหมดปิดหรือลูกค้าถูกลบ = ไม่คำนวณ
  if mcfg->>'mode' <> 'off' and not coalesce((c.data->>'deleted')::boolean, false) then
    mst := public.punpang__member_fold(c.id, clock_timestamp());  -- เวลาจริงหลังล็อกลูกค้า: รายการที่บันทึกระหว่างรอคิวของลูกค้าคนเดียวกันต้องนับด้วย
    mrmin := public.punpang__member_renew_min(o.data, mcfg);
    mmult := public.punpang__member_bill_mult(mst, round(p_base, 2), mrmin, mcfg);
  end if;
  -- (ข) เพดานแต้ม: โหมดใช้จริงเท่านั้นที่คูณด้วยตัวคูณระดับ
  cap_points := floor((p_base + 0.01) * (case when mcfg->>'mode' = 'live' then mmult else 1 end) * public.punpang__pts_maxmult() / earn_per + 1e-9);
  cap_spins := floor((p_base + 0.01) / spin_per + 1e-9);
  if p_points > cap_points or p_spins > cap_spins then
    return jsonb_build_object('error', 'invalid');
  end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  label := 'ออร์เดอร์ ' || o.code || case when p_bonus > 0 then ' (รวมโบนัสโปรคะแนน)' else '' end;
  if p_points > 0 then
    exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
    ledger := ledger || jsonb_build_array(jsonb_build_object(
      'id', lot_id, 'at', nowz, 'delta', p_points, 'reason', label, 'orderId', o.id, 'expiresAt', exp_at, 'remaining', p_points));
  end if;
  sp := coalesce((c.data->>'spins')::int, 0) + p_spins;
  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(sp)), updated_at = now()
   where id = c.id;

  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{loyalty}', jsonb_build_object(
             'points', p_points, 'bonus', p_bonus, 'spins', p_spins, 'base', round(p_base, 2),
             'lotId', case when p_points > 0 then lot_id else null end)),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', nowz, 'by', role_, 'text', 'ได้ ' || p_points || ' คะแนน' || case when p_bonus > 0 then ' (โบนัสโปร +' || p_bonus || ')' else '' end || case when p_spins > 0 then ' + สิทธิ์หมุน ' || p_spins || ' ครั้ง' else '' end)))
   where id = o.id;

  -- (ค) บันทึกยอดสมาชิก (โหมดทดลองและใช้จริง) · ยอดและตัวคูณเดียวกับที่ใช้คิด
  if mst is not null then
    insert into public.punpang_member_events (customer_id, order_id, kind, day, amount, renew_min, mult)
      values (c.id, o.id, 'spend', (now() at time zone 'Asia/Bangkok')::date, round(p_base, 2), mrmin, mmult);
  end if;
  return jsonb_build_object('ok', true, 'lotId', case when p_points > 0 then lot_id else null end, 'points', p_points, 'spins', p_spins);
end $$;

revoke all on function public.punpang_award_order(text, integer, integer, integer, numeric) from public, anon;
grant execute on function public.punpang_award_order(text, integer, integer, integer, numeric) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันที่แก้แล้วไปยัง punpang_test
select punpang_test.punpang_test_sync();
