-- สั่งล่วงหน้า เฟส 3A: การชำระมัดจำ การหมดเวลาจ่าย การขอ/อนุมัติขยายเวลา และการยกเลิกพร้อมคืน/ริบ (service_role เท่านั้น)
-- ลำดับล็อกทุกเส้นทาง: ลูกค้า → ออร์เดอร์ → (โควตาผ่าน punpang_preorder_reserve/release) → (แต้มผ่าน RPC แต้ม)
-- สถานะ: awaiting_payment → payment_confirmed (มัดจำครบ) · awaiting_payment → expired (เลยกำหนด คืนโควตาและแต้ม เก็บออร์เดอร์ไว้ให้ขอขยาย)
--        expired → awaiting_payment หรือ payment_confirmed (ร้านอนุมัติขยายเวลา) · ยกเลิกได้จากทุกสถานะยกเว้น delivered → cancelled (สิ้นสุด)
-- ข้อมูลในออร์เดอร์ (data): payments[] {id, amount, method, ref, at} · payDueAt · expiredAt · extensionRequest {status, at} · extensions[] · refund · forfeited · cancelledAt
-- ข้อผิดพลาดที่ต้องย้อนทั้งธุรกรรม (จองโควตา/ตัดแต้มสำเร็จแล้ว) raise ทันที: quota_full:<รหัส> · points:<รหัส>

create or replace function public.punpang_preorder_paid_total(p_data jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select coalesce(sum((x->>'amount')::numeric), 0)
  from jsonb_array_elements(coalesce(p_data->'payments', '[]'::jsonb)) x
$$;

-- 1) บันทึกการชำระ (เงินสดหน้าร้าน หรือ QR/ถุงเงินที่จับคู่แล้ว) · ref ซ้ำ = เรียกซ้ำ ไม่บันทึกซ้ำ · ยอดรวมต้องไม่เกินยอดบิล
create or replace function public.punpang_preorder_record_payment(p_order text, p_amount numeric, p_method text, p_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; paid numeric; total numeric; dep numeric; st text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, 2) then return jsonb_build_object('error', 'bad_amount'); end if;
  if p_method not in ('cash', 'qr') then return jsonb_build_object('error', 'bad_method'); end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status not in ('awaiting_payment', 'payment_confirmed', 'expired') then return jsonb_build_object('error', 'bad_status'); end if;
  if p_ref is not null and exists (select 1 from jsonb_array_elements(coalesce(o.data->'payments', '[]'::jsonb)) x where x->>'ref' = p_ref) then
    return jsonb_build_object('ok', true, 'already', true, 'status', o.status);
  end if;
  total := coalesce((o.data->>'total')::numeric, 0);
  paid := public.punpang_preorder_paid_total(o.data);
  if paid + p_amount > total then return jsonb_build_object('error', 'over_total'); end if;
  dep := coalesce((o.data->'deposit'->>'amount')::numeric, 0);
  st := o.status;
  if o.status = 'awaiting_payment' and paid + p_amount >= dep then st := 'payment_confirmed'; end if;
  update public.punpang_preorder_orders
    set status = st, updated_at = now(),
        data = jsonb_set(o.data, '{payments}', coalesce(o.data->'payments', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'amount', p_amount, 'method', p_method, 'ref', p_ref, 'at', nowz)))
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false, 'status', st, 'paid', paid + p_amount);
end $$;

-- 2) หมดเวลาจ่าย: เฉพาะ awaiting_payment ที่เลยกำหนดแล้ว · คืนแต้ม ปล่อยโควตา (ครั้งเดียวเพราะเปลี่ยนสถานะ) · เก็บออร์เดอร์ไว้
create or replace function public.punpang_preorder_expire(p_order text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; due timestamptz; rel jsonb; ret jsonb;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'awaiting_payment' then return jsonb_build_object('ok', true, 'expired', false, 'status', o.status); end if;
  due := (o.data->>'payDueAt')::timestamptz;
  if due is null or due > p_now then return jsonb_build_object('ok', true, 'expired', false, 'status', o.status, 'reason', 'not_due'); end if;
  ret := public.punpang_preorder_return_points(p_order);
  rel := public.punpang_preorder_release(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb));
  update public.punpang_preorder_orders
    set status = 'expired', updated_at = now(), data = o.data || jsonb_build_object('expiredAt', nowz)
    where id = p_order;
  return jsonb_build_object('ok', true, 'expired', true, 'status', 'expired', 'points', coalesce(ret->>'points', '0'), 'released', coalesce(rel->>'ok', 'false'));
end $$;

-- 3) งานตามเวลา (pg_cron เรียกในเฟส 3D): หมดเวลาทุกออร์เดอร์ที่ถึงกำหนด เรียงตามรหัสเพื่อให้ลำดับล็อกคงที่
create or replace function public.punpang_preorder_expire_due(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare r record; n integer := 0;
begin
  for r in select id from public.punpang_preorder_orders
           where status = 'awaiting_payment' and (data->>'payDueAt')::timestamptz <= p_now
           order by id
  loop
    if (public.punpang_preorder_expire(r.id, p_now)->>'expired') = 'true' then n := n + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'expired', n);
end $$;

-- 4) ลูกค้าขอขยายเวลา: ได้เฉพาะออร์เดอร์ที่หมดเวลาแล้ว และไม่มีคำขอค้าง
create or replace function public.punpang_preorder_request_extension(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'expired' then return jsonb_build_object('error', 'bad_status'); end if;
  if o.data->'extensionRequest'->>'status' = 'pending' then return jsonb_build_object('ok', true, 'already', true); end if;
  update public.punpang_preorder_orders
    set updated_at = now(), data = o.data || jsonb_build_object('extensionRequest', jsonb_build_object('status', 'pending', 'at', nowz))
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false);
end $$;

-- 5) ร้านอนุมัติขยายเวลา: จองโควตากลับ (ไม่ตรวจช่วงรับสั่ง) และตัดแต้มใหม่ตามเดิม · ถ้าโควตาเต็มหรือแต้มไม่พอ raise ย้อนทั้งหมด
create or replace function public.punpang_preorder_extend(p_order text, p_new_due timestamptz, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; r jsonb; sp jsonb; pts integer; pv numeric; paid numeric; dep numeric; st text;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  duez text;
begin
  if p_new_due is null or p_new_due <= p_now then return jsonb_build_object('error', 'bad_due'); end if;
  duez := to_char(p_new_due at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'expired' then return jsonb_build_object('error', 'bad_status'); end if;

  r := public.punpang_preorder_reserve(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb), false);
  if not coalesce((r->>'ok')::boolean, false) then
    raise exception 'quota_full:%', coalesce(r->>'error', 'unknown') using errcode = 'P0001';
  end if;

  pts := coalesce((o.data->>'pointsUsed')::integer, 0);
  if pts > 0 then
    pv := public.punpang__pts_cfg('pointValue', 1);
    sp := public.punpang_preorder_spend_points(p_order, cid, pts, round(pts * pv, 2));
    if sp ? 'error' then raise exception 'points:%', sp->>'error' using errcode = 'P0001'; end if;
  end if;

  paid := public.punpang_preorder_paid_total(o.data);
  dep := coalesce((o.data->'deposit'->>'amount')::numeric, 0);
  st := case when paid >= dep then 'payment_confirmed' else 'awaiting_payment' end;
  update public.punpang_preorder_orders
    set status = st, updated_at = now(),
        data = o.data
          || jsonb_build_object('payDueAt', duez,
               'extensions', coalesce(o.data->'extensions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowz, 'newDue', duez)))
          || (case when o.data ? 'extensionRequest'
                   then jsonb_build_object('extensionRequest', jsonb_set(o.data->'extensionRequest', '{status}', '"approved"'::jsonb))
                   else '{}'::jsonb end)
    where id = p_order;
  return jsonb_build_object('ok', true, 'status', st, 'payDueAt', duez);
end $$;

-- 6) ยกเลิก: คืนแต้มทั้งหมด · ปล่อยโควตาเฉพาะออร์เดอร์ที่ยังจองอยู่ (ไม่ปล่อยซ้ำกับที่หมดเวลาแล้ว) · ยอดคืนต้องไม่เกินยอดที่รับ ที่เหลือคือริบ
create or replace function public.punpang_preorder_cancel(p_order text, p_refund numeric default 0, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; paid numeric; ret jsonb; rel jsonb := null;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status = 'delivered' then return jsonb_build_object('error', 'already_delivered'); end if;
  paid := public.punpang_preorder_paid_total(o.data);
  if p_refund is null or p_refund < 0 or p_refund > paid or p_refund <> round(p_refund, 2) then
    return jsonb_build_object('error', 'bad_refund');
  end if;
  ret := public.punpang_preorder_return_points(p_order);
  if o.status in ('awaiting_payment', 'payment_confirmed') then
    rel := public.punpang_preorder_release(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb));
  end if;
  update public.punpang_preorder_orders
    set status = 'cancelled', updated_at = now(),
        data = o.data || jsonb_build_object('refund', p_refund, 'forfeited', paid - p_refund, 'cancelledAt', nowz)
    where id = p_order;
  return jsonb_build_object('ok', true, 'already', false, 'refund', p_refund, 'forfeited', paid - p_refund,
    'points', coalesce(ret->>'points', '0'), 'released', rel is not null);
end $$;

revoke all on function public.punpang_preorder_paid_total(jsonb) from public, anon, authenticated;
revoke all on function public.punpang_preorder_record_payment(text, numeric, text, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_record_payment(text, numeric, text, text) to service_role;
revoke all on function public.punpang_preorder_expire(text, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_expire(text, timestamptz) to service_role;
revoke all on function public.punpang_preorder_expire_due(timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_expire_due(timestamptz) to service_role;
revoke all on function public.punpang_preorder_request_extension(text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_request_extension(text) to service_role;
revoke all on function public.punpang_preorder_extend(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_extend(text, timestamptz, timestamptz) to service_role;
revoke all on function public.punpang_preorder_cancel(text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_cancel(text, numeric, timestamptz) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มี RPC ใหม่
select punpang_test.punpang_test_sync();
