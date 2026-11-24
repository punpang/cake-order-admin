-- สั่งล่วงหน้า เฟส 2C: ใช้แต้ม/คืนแต้มของออร์เดอร์สั่งล่วงหน้า (service_role เท่านั้น · ไม่ใช้ RPC ของออร์เดอร์ปกติ)
-- ตัดแต้มตาม FIFO เหมือน punpang__cust_spend แต่บันทึก orderId จริง เพื่อให้ idempotent และคืนแต้มได้ตามรหัสออร์เดอร์
-- มูลค่าแต้ม = pointValue จาก config/loyalty (ฝั่งฐานข้อมูล): p_amount ต้องเท่ากับ p_points × pointValue ไม่งั้นปฏิเสธ
-- ล็อกแถวลูกค้า (FOR UPDATE) ก่อนเสมอ ตามลำดับล็อกของสั่งล่วงหน้า: ลูกค้า → แคมเปญ → slots → counters

-- (1) ตัดแต้มแบบ FIFO ที่บันทึก orderId (overload ใหม่ ไม่แตะ punpang__cust_spend เดิม)
create or replace function public.punpang__cust_spend_order(p_ledger jsonb, p_points integer, p_today text, p_reason text, p_nowz text, p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  bal integer; takes jsonb; nmap jsonb; out_ jsonb;
begin
  with lots as (
    select ord::int as ord, e->>'id' as id, (e->>'remaining')::int as rem, coalesce(e->>'expiresAt', '9999') as exp
      from jsonb_array_elements(p_ledger) with ordinality as t(e, ord)
     where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0 and (e->>'expiresAt' is null or e->>'expiresAt' >= p_today)
  ), cum as (
    select ord, id, rem, coalesce(sum(rem) over (order by exp, ord rows between unbounded preceding and 1 preceding), 0) as before from lots
  ), tk as (
    select ord, id, least(rem, greatest(p_points - before, 0)) as k from cum
  )
  select coalesce((select sum(rem) from lots), 0),
         (select jsonb_agg(jsonb_build_object('lotId', id, 'n', k) order by ord) from tk where k > 0),
         (select jsonb_object_agg(ord::text, k) from tk where k > 0)
    into bal, takes, nmap;
  if bal < p_points then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;
  select coalesce(jsonb_agg(case when nmap ? (ord::text)
                                 then jsonb_set(e, '{remaining}', to_jsonb((e->>'remaining')::int - (nmap->>(ord::text))::int))
                                 else e end order by ord), '[]'::jsonb)
    into out_ from jsonb_array_elements(p_ledger) with ordinality as t(e, ord);
  out_ := out_ || jsonb_build_array(jsonb_build_object(
    'id', public.punpang__pts_newid(), 'at', p_nowz, 'delta', -p_points, 'reason', p_reason, 'orderId', p_order, 'takes', coalesce(takes, '[]'::jsonb)));
  return jsonb_build_object('ledger', out_, 'balance', bal);
end $$;

revoke all on function public.punpang__cust_spend_order(jsonb, integer, text, text, text, text) from public, anon, authenticated;

-- (2) ใช้แต้มกับออร์เดอร์: idempotent ตามรหัสออร์เดอร์ (มีรายการตัดที่ยังไม่คืนอยู่แล้ว → คืนรายการเดิม)
create or replace function public.punpang_preorder_spend_points(p_order text, p_customer text, p_points integer, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; e jsonb; r jsonb; pv numeric;
  today text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_points is null or p_points < 1 or p_points <> trunc(p_points) then return jsonb_build_object('error', 'bad_points'); end if;
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  select x into e from jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) x
   where x->>'orderId' = p_order and (x->>'delta')::int < 0 and not coalesce((x->>'refunded')::boolean, false) limit 1;
  if e is not null then return jsonb_build_object('ok', true, 'already', true, 'entryId', e->>'id'); end if;
  pv := public.punpang__pts_cfg('pointValue', 1);
  if p_amount is distinct from round(p_points * pv, 2) then return jsonb_build_object('error', 'amount_mismatch'); end if;
  r := public.punpang__cust_spend_order(coalesce(c.data->'ledger', '[]'::jsonb), p_points, today, 'ใช้คะแนน สั่งล่วงหน้า', nowz, p_order);
  if r ? 'error' then return r; end if;
  update public.punpang_customers set data = jsonb_set(data, '{ledger}', r->'ledger'), updated_at = now() where id = p_customer;
  return jsonb_build_object('ok', true, 'already', false, 'entryId', r->'ledger'->-1->>'id', 'points', p_points, 'amount', p_amount);
end $$;

-- (3) คืนแต้มของออร์เดอร์: คืนก้อนที่ตัดไป และทำเครื่องหมายรายการเดิมว่าคืนแล้ว · เรียกซ้ำไม่มีผล
create or replace function public.punpang_preorder_return_points(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; e jsonb; gmap jsonb; new_ledger jsonb;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  cid text;
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if cid is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = cid for update;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select x into e from jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) x
   where x->>'orderId' = p_order and (x->>'delta')::int < 0 and not coalesce((x->>'refunded')::boolean, false) limit 1;
  if e is null then return jsonb_build_object('ok', true, 'already', true); end if;
  select coalesce(jsonb_object_agg(t->>'lotId', (t->>'n')::int), '{}'::jsonb) into gmap
    from jsonb_array_elements(coalesce(e->'takes', '[]'::jsonb)) t;
  select coalesce(jsonb_agg(case
           when x->>'id' = e->>'id' then jsonb_set(x, '{refunded}', 'true'::jsonb)
           when gmap ? (x->>'id') then jsonb_set(x, '{remaining}', to_jsonb(coalesce((x->>'remaining')::int, 0) + (gmap->>(x->>'id'))::int))
           else x end order by ord), '[]'::jsonb)
    into new_ledger from jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) with ordinality as t(x, ord);
  new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
    'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -((e->>'delta')::int), 'reason', 'คืนคะแนน สั่งล่วงหน้า', 'orderId', p_order, 'refund', true));
  update public.punpang_customers set data = jsonb_set(data, '{ledger}', new_ledger), updated_at = now() where id = cid;
  return jsonb_build_object('ok', true, 'already', false, 'points', -((e->>'delta')::int));
end $$;

revoke all on function public.punpang_preorder_spend_points(text, text, integer, numeric) from public, anon, authenticated;
grant execute on function public.punpang_preorder_spend_points(text, text, integer, numeric) to service_role;
revoke all on function public.punpang_preorder_return_points(text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_return_points(text) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มี RPC ใหม่
select punpang_test.punpang_test_sync();
