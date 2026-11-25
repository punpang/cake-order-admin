-- สั่งล่วงหน้า: เลขพัสดุให้ลูกค้าติดตาม และรับคืนสินค้าหลังส่งมอบ (service_role เท่านั้น)
-- สถานะเพิ่ม: payment_confirmed → shipped (ร้านบันทึกเลขพัสดุ เมื่อชำระครบแล้ว) → delivered (ร้านยืนยันรับแล้ว) → returned (รับคืนแล้ว)
-- ลำดับล็อก: ลูกค้า → ออร์เดอร์ · คะแนนคืนใช้รูปแบบเดียวกับการยกเลิก (ก้อนไม่มีวันหมดอายุ)

-- คืนเงินหลังส่งมอบ: ร้านบันทึกการคืนเป็นรายการ (ตีกลับหรือลูกค้าคืน) พร้อมรายการคืนเงินตามวิธี · ยอดคืนรวมทั้งหมดต้องไม่เกินยอดที่รับ
create or replace function public.punpang_preorder_set_shipping(p_order text, p_carrier text, p_tracking text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; total numeric; paid numeric;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_carrier is null or length(trim(p_carrier)) = 0 or length(trim(p_carrier)) > 40 then return jsonb_build_object('error', 'bad_carrier'); end if;
  if p_tracking is null or length(trim(p_tracking)) < 3 or length(trim(p_tracking)) > 60 or trim(p_tracking) !~ '^[A-Za-z0-9-]+$' then
    return jsonb_build_object('error', 'bad_tracking');
  end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if coalesce(o.data->>'fulfillment', '') <> 'delivery' then return jsonb_build_object('error', 'not_delivery'); end if;
  if o.status <> 'payment_confirmed' then return jsonb_build_object('error', 'bad_status'); end if;
  total := coalesce((o.data->>'total')::numeric, 0);
  paid := public.punpang_preorder_paid_total(o.data);
  if paid < total then return jsonb_build_object('error', 'balance_due'); end if;
  update public.punpang_preorder_orders
    set status = 'shipped', updated_at = now(),
        data = o.data || jsonb_build_object('shipping', jsonb_build_object('carrier', trim(p_carrier), 'trackingNo', upper(trim(p_tracking)), 'shippedAt', nowz))
    where id = p_order;
  return jsonb_build_object('ok', true, 'status', 'shipped', 'trackingNo', upper(trim(p_tracking)));
end $$;

-- ร้านยืนยันว่าพัสดุถึงลูกค้าแล้ว
create or replace function public.punpang_preorder_mark_delivered(p_order text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status = 'delivered' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status <> 'shipped' then return jsonb_build_object('error', 'bad_status'); end if;
  update public.punpang_preorder_orders
    set status = 'delivered', updated_at = now(), data = o.data || jsonb_build_object('deliveredAt', nowz)
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false, 'status', 'delivered');
end $$;

-- ลูกค้าขอคืนสินค้า (หลังได้รับแล้วเท่านั้น และไม่มีคำขอค้าง)
create or replace function public.punpang_preorder_request_return(p_order text, p_reason text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_reason is null or length(trim(p_reason)) = 0 then return jsonb_build_object('error', 'bad_reason'); end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'delivered' then return jsonb_build_object('error', 'bad_status'); end if;
  if o.data->'returnRequest'->>'status' = 'pending' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.punpang_preorder_orders
    set updated_at = now(),
        data = o.data || jsonb_build_object('returnRequest', jsonb_build_object('status', 'pending', 'reason', left(trim(p_reason), 200), 'at', nowz))
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- ร้านบันทึกการรับคืน (พัสดุตีกลับจาก shipped หรือลูกค้าคืนจาก delivered) · ยังไม่คืนเงิน ร้านตัดสินภายหลัง (refund_return หรือ reship)
create or replace function public.punpang_preorder_record_return(p_order text, p_reason text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_reason is null or length(trim(p_reason)) = 0 then return jsonb_build_object('error', 'bad_reason'); end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status not in ('shipped', 'delivered') then return jsonb_build_object('error', 'bad_status'); end if;
  update public.punpang_preorder_orders
    set status = 'returned', updated_at = now(),
        data = o.data
          || jsonb_build_object('returns', coalesce(o.data->'returns', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
               'id', public.punpang__pts_newid(), 'at', nowz, 'reason', left(trim(p_reason), 200), 'decision', null, 'refunds', '[]'::jsonb, 'total', 0, 'shippingForfeited', 0)))
          || (case when o.data ? 'returnRequest' then jsonb_build_object('returnRequest', jsonb_set(o.data->'returnRequest', '{status}', '"done"'::jsonb)) else '{}'::jsonb end)
    where id = p_order;
  return jsonb_build_object('ok', true, 'status', 'returned');
end $$;

-- ตัดสิน "คืนเงิน": ริบค่าส่งเดิม (shippingFee ในยอด) · ยอดคืนรวมไม่เกินยอดที่รับหลังหักค่าส่ง · วิธีคืน cash | bank | points
create or replace function public.punpang_preorder_refund_return(p_order text, p_refunds jsonb default '[]'::jsonb, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; r jsonb; amt numeric; tot numeric := 0; pts_total int := 0; pv numeric; lg jsonb;
  clean jsonb := '[]'::jsonb; paid numeric; fee numeric; rt jsonb; rts jsonb; rt_idx int; nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if jsonb_typeof(coalesce(p_refunds, '[]'::jsonb)) <> 'array' then return jsonb_build_object('error', 'bad_refund'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb)) loop
    amt := (r->>'amount')::numeric;
    if amt is null or amt <= 0 or amt <> round(amt, 2) or (r->>'method') not in ('cash', 'bank', 'points') then
      return jsonb_build_object('error', 'bad_refund');
    end if;
    tot := tot + amt;
    clean := clean || jsonb_build_array(jsonb_build_object('amount', amt, 'method', r->>'method'));
  end loop;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'returned' then return jsonb_build_object('error', 'bad_status'); end if;
  rts := coalesce(o.data->'returns', '[]'::jsonb);
  rt_idx := jsonb_array_length(rts) - 1;
  if rt_idx < 0 or rts->rt_idx->'decision' <> 'null'::jsonb then return jsonb_build_object('error', 'bad_decision'); end if;
  paid := public.punpang_preorder_paid_total(o.data);
  fee := coalesce((o.data->>'shippingFee')::numeric, 0);
  if tot > paid - fee then return jsonb_build_object('error', 'bad_refund'); end if;
  pv := public.punpang__pts_cfg('pointValue', 1);
  for r in select * from jsonb_array_elements(clean) loop
    if r->>'method' = 'points' then
      if pv <= 0 or abs((r->>'amount')::numeric / pv - round((r->>'amount')::numeric / pv)) > 0.000001 then
        return jsonb_build_object('error', 'bad_refund');
      end if;
      pts_total := pts_total + round((r->>'amount')::numeric / pv)::int;
    end if;
  end loop;
  if pts_total > 0 then
    select data->'ledger' into lg from public.punpang_customers where id = cid;
    lg := coalesce(lg, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', public.punpang__pts_newid(), 'at', nowz, 'delta', pts_total, 'remaining', pts_total,
      'expiresAt', null, 'reason', 'คืนสินค้าสั่งล่วงหน้า (คืนเป็นคะแนน)', 'orderId', p_order));
    update public.punpang_customers set data = jsonb_set(data, '{ledger}', lg), updated_at = now() where id = cid;
  end if;
  rt := rts->rt_idx || jsonb_build_object('decision', 'refund', 'refunds', clean, 'total', tot, 'shippingForfeited', fee, 'decidedAt', nowz);
  update public.punpang_preorder_orders
    set updated_at = now(), data = jsonb_set(o.data, array['returns', rt_idx::text], rt)
    where id = p_order;
  return jsonb_build_object('ok', true, 'decision', 'refund', 'refunded', tot, 'shippingForfeited', fee, 'points', pts_total);
end $$;

-- ตัดสิน "จัดส่งใหม่": ริบค่าส่งเดิม (คงอยู่ในยอดที่รับ) · เพิ่มค่าส่งใหม่เข้ายอดออร์เดอร์ · ลูกค้าชำระส่วนต่างผ่านการชำระปกติ แล้วร้านบันทึกเลขพัสดุใหม่
create or replace function public.punpang_preorder_reship(p_order text, p_new_fee numeric, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; rts jsonb; rt jsonb; rt_idx int; fee numeric; newtotal numeric;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_new_fee is null or p_new_fee <= 0 or p_new_fee <> round(p_new_fee, 2) then return jsonb_build_object('error', 'bad_fee'); end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'returned' then return jsonb_build_object('error', 'bad_status'); end if;
  if coalesce(o.data->>'fulfillment', '') <> 'delivery' then return jsonb_build_object('error', 'not_delivery'); end if;
  rts := coalesce(o.data->'returns', '[]'::jsonb);
  rt_idx := jsonb_array_length(rts) - 1;
  if rt_idx < 0 or rts->rt_idx->'decision' <> 'null'::jsonb then return jsonb_build_object('error', 'bad_decision'); end if;
  fee := coalesce((o.data->>'shippingFee')::numeric, 0);
  newtotal := coalesce((o.data->>'total')::numeric, 0) + p_new_fee;
  rt := rts->rt_idx || jsonb_build_object('decision', 'reship', 'refunds', '[]'::jsonb, 'total', 0, 'shippingForfeited', fee, 'newFee', p_new_fee, 'decidedAt', nowz);
  update public.punpang_preorder_orders
    set status = 'payment_confirmed', updated_at = now(),
        data = jsonb_set(o.data, array['returns', rt_idx::text], rt) || jsonb_build_object('total', newtotal, 'shippingFee', p_new_fee)
    where id = p_order;
  return jsonb_build_object('ok', true, 'decision', 'reship', 'shippingForfeited', fee, 'newFee', p_new_fee, 'balanceDue', p_new_fee);
end $$;

-- ยกเลิกไม่รองรับหลังส่งมอบหรือรับคืนแล้ว · พัสดุที่ส่งออกแล้วยังจองโควตาอยู่ จึงปล่อยโควตาตอนยกเลิก
create or replace function public.punpang_preorder_cancel(p_order text, p_refunds jsonb default '[]'::jsonb, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; paid numeric; ret jsonb; rel jsonb := null; r jsonb; amt numeric; refund_total numeric := 0;
  clean jsonb := '[]'::jsonb; pv numeric; pts_total int; lg jsonb;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if jsonb_typeof(coalesce(p_refunds, '[]'::jsonb)) <> 'array' then return jsonb_build_object('error', 'bad_refund'); end if;
  for r in select * from jsonb_array_elements(coalesce(p_refunds, '[]'::jsonb)) loop
    amt := (r->>'amount')::numeric;
    if amt is null or amt <= 0 or amt <> round(amt, 2) or (r->>'method') not in ('cash', 'bank', 'points') then
      return jsonb_build_object('error', 'bad_refund');
    end if;
    refund_total := refund_total + amt;
    clean := clean || jsonb_build_array(jsonb_build_object('amount', amt, 'method', r->>'method'));
  end loop;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status in ('delivered', 'returned') then return jsonb_build_object('error', 'already_delivered'); end if;
  paid := public.punpang_preorder_paid_total(o.data);
  if refund_total > paid then return jsonb_build_object('error', 'bad_refund'); end if;
  pv := public.punpang__pts_cfg('pointValue', 1);
  pts_total := 0;
  for r in select * from jsonb_array_elements(clean) loop
    if r->>'method' = 'points' then
      if pv <= 0 or abs((r->>'amount')::numeric / pv - round((r->>'amount')::numeric / pv)) > 0.000001 then
        return jsonb_build_object('error', 'bad_refund');
      end if;
      pts_total := pts_total + round((r->>'amount')::numeric / pv)::int;
    end if;
  end loop;
  ret := public.punpang_preorder_return_points(p_order);
  if o.status in ('awaiting_payment', 'payment_confirmed', 'shipped') then
    rel := public.punpang_preorder_release(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb));
  end if;
  if pts_total > 0 then
    select data->'ledger' into lg from public.punpang_customers where id = cid;
    lg := coalesce(lg, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'id', public.punpang__pts_newid(), 'at', nowz, 'delta', pts_total, 'remaining', pts_total,
      'expiresAt', null, 'reason', 'คืนเงินสั่งล่วงหน้า (คืนเป็นคะแนน)', 'orderId', p_order));
    update public.punpang_customers set data = jsonb_set(data, '{ledger}', lg), updated_at = now() where id = cid;
  end if;
  update public.punpang_preorder_orders
    set status = 'cancelled', updated_at = now(),
        data = o.data || jsonb_build_object('refunds', clean, 'refund', refund_total, 'forfeited', paid - refund_total, 'cancelledAt', nowz)
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false, 'refund', refund_total, 'forfeited', paid - refund_total,
    'points', coalesce(ret->>'points', '0'), 'released', rel is not null);
end $$;

revoke all on function public.punpang_preorder_set_shipping(text, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_set_shipping(text, text, text, timestamptz) to service_role;
revoke all on function public.punpang_preorder_mark_delivered(text, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_mark_delivered(text, timestamptz) to service_role;
revoke all on function public.punpang_preorder_request_return(text, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_request_return(text, text) to service_role;
revoke all on function public.punpang_preorder_record_return(text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_record_return(text, text, timestamptz) to service_role;
revoke all on function public.punpang_preorder_refund_return(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_refund_return(text, jsonb, timestamptz) to service_role;
revoke all on function public.punpang_preorder_reship(text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_reship(text, numeric, timestamptz) to service_role;
revoke all on function public.punpang_preorder_cancel(text, jsonb, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_cancel(text, jsonb, timestamptz) to service_role;

select punpang_test.punpang_test_sync();
