-- คูปองคืนเงิน (mode = credit) ใช้ได้หลายครั้งจนยอดคงเหลือหมด · ถอดการใช้คะแนนลดราคา (1 คะแนน = 1 บาท ใช้ผ่านคูปองแทน)
-- ไฟล์นี้ยังไม่ได้รันบนฐานข้อมูลใด · ต้องได้รับอนุมัติก่อนรัน (ห้าม merge ให้ db push อัตโนมัติก่อนอนุมัติ)
-- รันซ้ำได้ปลอดภัย · ไม่แตะข้อมูลที่มีอยู่ (การแปลงคะแนนของลูกค้าเดิมอยู่ในไฟล์ supabase/deploy แยก)
--
-- โครงของคูปองคืนเงิน: mode = 'credit', balance = ยอดคงเหลือที่ยังไม่ถูกจอง, holds = { [รหัสออร์เดอร์/บิล]: ยอดที่จองไว้ }
--   จอง (punpang_hold_credit) ตัด balance เข้า holds · ยกเลิกการจอง (punpang_release_coupon) คืนยอดจาก holds กลับ balance
--   ตรวจรายการในออร์เดอร์ (punpang__coupon_entry_ok) ต้องมียอดจองไว้กับออร์เดอร์นั้นพอ

-- ============================================================================
-- 1) ตรวจรายการคูปองหนึ่งรายการ (กติกาเดียวกับ src/lib/coupons.js) · เพิ่มกรณี credit
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
  pct numeric;
  base numeric := 0;
  hold numeric;
  mode text;
  pid text;
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
         where i->>'retailId' = pid and coalesce((i->>'promoGift')::boolean, false) = false;
        if base <= 0 then return false; end if;
      end if;
      if amt > cap + 0.005 then return false; end if;
      if amt > round(base * pct / 100, 2) + 0.01 then return false; end if;
    end if;
  end if;
  if amt > maxt + 0.01 then return false; end if;
  return true;
end
$$;
revoke all on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- 2) จองคูปองแบบเดิม: ไม่รับคูปองคืนเงิน (ต้องใช้ punpang_hold_credit ที่ส่งยอดมาด้วย)
-- ============================================================================
create or replace function public.punpang_claim_coupon(p_coupon text, p_order text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  d jsonb;
  today_th text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_coupon is null or p_order is null or length(p_coupon) > 64 or length(p_order) > 64 then return 'invalid'; end if;

  select * into r from public.punpang_records where collection = 'coupons' and id = p_coupon for update;
  if not found then return 'missing'; end if;
  d := r.data;

  if coalesce(d->>'type', '') <> 'discount' then return 'invalid'; end if;
  if coalesce(d->>'mode', '') = 'credit' then return 'invalid'; end if;
  if coalesce(d->>'status', '') = 'used' and d->>'orderId' = p_order then return 'ok'; end if;
  if coalesce(d->>'status', '') in ('used', 'delivered', 'refunded', 'lapsed', 'void') then return 'used'; end if;
  if nullif(d->>'expiresAt', '') is not null and (d->>'expiresAt') < today_th then return 'expired'; end if;
  if nullif(d->>'activatedUntil', '') is not null and (d->>'activatedUntil')::timestamptz <= now() then return 'expired'; end if;

  update public.punpang_records
     set data = d || jsonb_build_object(
           'status', 'used', 'orderId', p_order,
           'usedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'activatedAt', null, 'activatedUntil', null)
   where collection = 'coupons' and id = p_coupon;
  return 'ok';
end
$$;

-- ============================================================================
-- 3) จองยอดคูปองคืนเงินกับออร์เดอร์/บิล (อะตอมิก · กันสองเครื่องใช้ยอดเกินคงเหลือ)
-- ผล: 'ok' | 'insufficient' (ยอดคงเหลือไม่พอ) | 'expired' | 'invalid' | 'missing'
-- ============================================================================
create or replace function public.punpang_hold_credit(p_coupon text, p_order text, p_amount numeric)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  d jsonb;
  holds jsonb;
  bal numeric;
  new_bal numeric;
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_coupon is null or p_order is null or p_amount is null or length(p_coupon) > 64 or length(p_order) > 64 then return 'invalid'; end if;
  if p_amount <= 0 or p_amount > 100000000 then return 'invalid'; end if;

  select * into r from public.punpang_records where collection = 'coupons' and id = p_coupon for update;
  if not found then return 'missing'; end if;
  d := r.data;
  if coalesce(d->>'type', '') <> 'discount' or coalesce(d->>'mode', '') <> 'credit' then return 'invalid'; end if;
  if nullif(d->>'expiresAt', '') is not null and (d->>'expiresAt') < to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') then return 'expired'; end if;

  holds := case when jsonb_typeof(d->'holds') = 'object' then d->'holds' else '{}'::jsonb end;
  if holds ? p_order then
    -- จองซ้ำกับออร์เดอร์เดิมด้วยยอดเท่าเดิม = ok (ลองใหม่ได้) · ยอดต่าง = invalid
    if abs((holds->>p_order)::numeric - p_amount) < 0.005 then return 'ok'; end if;
    return 'invalid';
  end if;

  bal := coalesce(nullif(d->>'balance', '')::numeric, 0);
  if p_amount > bal + 0.005 then return 'insufficient'; end if;
  new_bal := round(bal - p_amount, 2);
  d := jsonb_set(d, '{balance}', to_jsonb(new_bal));
  d := jsonb_set(d, '{holds}', holds || jsonb_build_object(p_order, round(p_amount, 2)));
  d := d || jsonb_build_object('status', case when new_bal <= 0 then 'used' else 'pending' end);
  update public.punpang_records set data = d where collection = 'coupons' and id = p_coupon;
  return 'ok';
end
$$;

-- ============================================================================
-- 4) คืนคูปองที่จองไว้ (ขายไม่สำเร็จ) · คูปองคืนเงิน: คืนยอดที่จองกับออร์เดอร์นั้นกลับเข้า balance
-- ============================================================================
create or replace function public.punpang_release_coupon(p_coupon text, p_order text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  r record;
  d jsonb;
  held numeric;
  bal numeric;
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into r from public.punpang_records where collection = 'coupons' and id = p_coupon for update;
  if found and coalesce(r.data->>'mode', '') = 'credit' then
    d := r.data;
    if jsonb_typeof(d->'holds') <> 'object' or not (d->'holds' ? p_order) then return false; end if;
    held := (d->'holds'->>p_order)::numeric;
    bal := coalesce(nullif(d->>'balance', '')::numeric, 0);
    d := jsonb_set(d, '{balance}', to_jsonb(round(bal + held, 2)));
    d := jsonb_set(d, '{holds}', (d->'holds') - p_order);
    d := d || jsonb_build_object('status', 'pending');
    update public.punpang_records set data = d where collection = 'coupons' and id = p_coupon;
    return true;
  end if;

  update public.punpang_records
     set data = data || jsonb_build_object('status', 'pending', 'orderId', null, 'usedAt', null)
   where collection = 'coupons' and id = p_coupon
     and data->>'status' = 'used' and data->>'orderId' = p_order;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

-- ============================================================================
-- 5) แปลงคะแนนที่ใช้ได้ทั้งหมดของลูกค้าเป็นคูปองคงที่ใบเดียว (มูลค่าเท่ายอดคะแนน · ใช้ครั้งเดียว · หมดอายุ 30 วันนับจากวันแปลง)
-- ตัดคะแนนทุกก้อนที่ใช้ได้ + สร้างคูปอง ในธุรกรรมเดียวกัน · ไม่มีคะแนน = { error: 'no_points' }
-- punpang__convert_points ไม่ตรวจสิทธิ์ (ใช้จากสคริปต์แปลงข้อมูลรันครั้งเดียว) · punpang_convert_points_to_coupon ตรวจสิทธิ์ adjustPoints
-- ============================================================================
create or replace function public.punpang__convert_points(p_customer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  c record;
  today_ text := public.punpang__pts_today();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  pv numeric := public.punpang__pts_cfg('pointValue', 1);
  bal integer;
  sp jsonb;
  amt numeric;
  cp_id text;
begin
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;

  select coalesce(sum((e->>'remaining')::int), 0) into bal
    from jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) e
   where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0
     and (e->>'expiresAt' is null or e->>'expiresAt' >= today_);
  if bal <= 0 then return jsonb_build_object('error', 'no_points'); end if;

  sp := public.punpang__cust_spend(coalesce(c.data->'ledger', '[]'::jsonb), bal, today_, 'แปลงเป็นคูปอง', nowz);
  if sp ? 'error' then return sp; end if;

  amt := round(bal * pv, 2);
  cp_id := public.punpang__cust_new_coupon(p_customer, jsonb_build_object(
             'type', 'discount', 'mode', 'fixed', 'amount', amt, 'minSpend', 0,
             'name', 'คูปองแปลงคะแนน ' || bal || ' คะแนน', 'source', 'convert', 'points', bal,
             'expiresAt', to_char(today_::date + 30, 'YYYY-MM-DD')), '{}'::jsonb, today_);

  update public.punpang_customers set data = jsonb_set(c.data, '{ledger}', sp->'ledger'), updated_at = now() where id = c.id;
  return jsonb_build_object('ok', true, 'points', bal, 'amount', amt, 'couponId', cp_id);
end
$$;

create or replace function public.punpang_convert_points_to_coupon(p_customer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.punpang__convert_points(p_customer);
end
$$;

-- ============================================================================
-- 6) ถอดการใช้คะแนนลดราคาออเดอร์ (RPC เดิมปิดการทำงาน · ออร์เดอร์ค้างที่ใช้คะแนนไว้แล้วยังยกเลิกได้ด้วย punpang_remove_points)
-- ============================================================================
create or replace function public.punpang_apply_points(p_order text, p_points integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return jsonb_build_object('error', 'retired');
end
$$;

-- ============================================================================
-- สิทธิ์การเรียกใช้
-- ============================================================================
revoke all on function public.punpang_hold_credit(text, text, numeric) from public, anon;
grant execute on function public.punpang_hold_credit(text, text, numeric) to authenticated;
revoke all on function public.punpang__convert_points(text) from public, anon, authenticated;
revoke all on function public.punpang_convert_points_to_coupon(text) from public, anon;
grant execute on function public.punpang_convert_points_to_coupon(text) to authenticated;
