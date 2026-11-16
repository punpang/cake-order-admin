-- คูปองส่วนลด 3 แบบ: ลดเป็นบาท (เดิม) · ซื้อครบ x บาท ลด y% สูงสุด z บาท · ซื้อสินค้า x ลด y% สูงสุด z บาท
-- รันหลัง 20261115050000 และ 20261110175102 · รันซ้ำได้ปลอดภัย · ไม่แตะข้อมูลที่มีอยู่
-- 1) punpang__coupon_entry_ok รู้จัก mode/pct/cap/productId: แบบลดเป็นบาทเหมือนเดิม · แบบ % ต้องไม่เกินเพดาน และไม่เกินร้อยละของยอดที่เกี่ยวข้อง
-- 2) punpang_cust_redeem คัดลอกฟิลด์ของคูปอง % ลงแถวคูปองที่ลูกค้าแลก (ไม่เช่นนั้นตรวจไม่ผ่านตอนใช้)

-- ============================================================================
-- 1) ตรวจรายการคูปองหนึ่งรายการ (กติกาเดียวกับ src/lib/coupons.js)
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
  if coalesce(cd->>'type', '') <> 'discount' or coalesce(cd->>'status', '') <> 'used' then return false; end if;
  if not (coalesce(cd->>'orderId', '') = oid or (coalesce(cd->>'orderId', '') = 'pos-pending' and p_channel = 'pos')) then return false; end if;
  if coalesce(cd->>'customerId', '') <> '' and p_customer is not null and cd->>'customerId' <> p_customer then return false; end if;

  mode := coalesce(nullif(cd->>'mode', ''), 'fixed');
  if mode not in ('fixed', 'spend', 'product') then return false; end if;
  if amt < 0 then return false; end if;

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
  if amt > maxt + 0.01 then return false; end if;
  return true;
end
$$;
revoke all on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- 2) แลกของ: คูปองลูกค้าคัดลอกฟิลด์ประเภทคูปองจากของแลก (ลดเป็นบาท หรือ % ตามประเภท)
-- ============================================================================
create or replace function public.punpang_cust_redeem(p_customer text, p_reward text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; cfg jsonb; rewards jsonb; rw jsonb; pts integer; sp jsonb; cp_id text; cdata jsonb;
  today_ text := public.punpang__pts_today();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  data_ jsonb;
  mode_ text;
  fields_ jsonb;
begin
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'loyalty';
  select data->'v' into rewards from public.punpang_kv where collection = 'config' and id = 'rewards';
  if cfg is null or rewards is null then return jsonb_build_object('error', 'config_missing'); end if;
  select e into rw from jsonb_array_elements(rewards) e where e->>'id' = p_reward and coalesce((e->>'active')::boolean, true) limit 1;
  if rw is null then return jsonb_build_object('error', 'no_reward'); end if;
  pts := coalesce((rw->>'points')::int, 0);
  if pts <= 0 then return jsonb_build_object('error', 'invalid'); end if;

  sp := public.punpang__cust_spend(coalesce(c.data->'ledger', '[]'::jsonb), pts, today_, 'แลก ' || (rw->>'name'), nowz);
  if sp ? 'error' then return sp; end if;

  if rw->>'kind' = 'coupon' then
    mode_ := coalesce(nullif(rw->>'mode', ''), 'fixed');
    if mode_ = 'fixed' then
      fields_ := jsonb_build_object('mode', 'fixed',
                                    'amount', coalesce((rw->>'amount')::numeric, 0),
                                    'minSpend', coalesce((rw->>'minSpend')::numeric, 0));
    else
      fields_ := jsonb_build_object('mode', mode_,
                                    'pct', coalesce((rw->>'pct')::numeric, 0),
                                    'cap', coalesce((rw->>'cap')::numeric, 0),
                                    'amount', coalesce((rw->>'cap')::numeric, 0),
                                    'minSpend', case when mode_ = 'spend' then coalesce((rw->>'minSpend')::numeric, 0) else 0 end,
                                    'productId', case when mode_ = 'product' then coalesce(rw->>'productId', '') else '' end,
                                    'productName', case when mode_ = 'product' then coalesce(rw->>'productName', '') else '' end);
    end if;
    data_ := jsonb_build_object('type', 'discount', 'rewardId', rw->>'id', 'points', pts, 'name', rw->>'name', 'source', 'redeem') || fields_;
    if coalesce((rw->>'validDays')::int, 0) > 0 then
      data_ := data_ || jsonb_build_object('expiresAt', to_char(today_::date + (rw->>'validDays')::int, 'YYYY-MM-DD'));
    end if;
  else
    data_ := jsonb_build_object('type', 'reward', 'rewardId', rw->>'id', 'points', pts, 'name', rw->>'name', 'source', 'redeem');
  end if;
  cp_id := public.punpang__cust_new_coupon(p_customer, data_, cfg, today_);

  update public.punpang_customers set data = jsonb_set(c.data, '{ledger}', sp->'ledger'), updated_at = now() where id = c.id;
  select jsonb_build_object('id', r.id) || r.data into cdata from public.punpang_records r where r.collection = 'coupons' and r.id = cp_id;
  return jsonb_build_object('ok', true, 'coupon', cdata, 'balance', (sp->>'balance')::int - pts);
end $$;
