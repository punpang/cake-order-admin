-- แต้มสะสมแบบอะตอมิก ขั้นที่ 2: ใช้/ยกเลิกใช้แต้มกับออร์เดอร์ ทำบนสมุดแต้มเดิมใน punpang_customers.data.ledger (แหล่งข้อมูลเดียวกับที่แอปอ่าน)
-- ล็อกแถวลูกค้า (for update) → ตรวจยอด → ตัดจากก้อนที่ใกล้หมดอายุก่อน → เขียนสมุดแต้ม + pointsUsed ของออร์เดอร์ ในธุรกรรมเดียว
-- แทนฟังก์ชันที่อิงตาราง punpang_points ของขั้นที่ 1 (ตารางนั้นเก็บไว้เป็นข้อมูลขนาน ยังไม่ใช้ในแอป)
create or replace function public.punpang_apply_points(p_order text, p_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; ledger jsonb; new_ledger jsonb; takes jsonb; nmap jsonb; bal integer;
  today_ text := public.punpang__pts_today();
  pv numeric := public.punpang__pts_cfg('pointValue', 1);
  amt numeric; eid text := public.punpang__pts_newid();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if role_ is null or not public.punpang_has_perm('useLoyalty') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 1 or p_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;     -- คิวต่อลูกค้า
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  if o.status in ('draft', 'cancelled') then return jsonb_build_object('error', 'bad_status'); end if;
  if o.data->'pointsUsed' is not null and o.data->'pointsUsed' <> 'null'::jsonb then return jsonb_build_object('error', 'already_used'); end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  with lots as (
    select ord::int as ord, e->>'id' as id, (e->>'remaining')::int as rem, coalesce(e->>'expiresAt', '9999') as exp
      from jsonb_array_elements(ledger) with ordinality as t(e, ord)
     where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0 and (e->>'expiresAt' is null or e->>'expiresAt' >= today_)
  ), cum as (
    select ord, id, rem, coalesce(sum(rem) over (order by exp, ord rows between unbounded preceding and 1 preceding), 0) as before from lots
  ), tk as (
    select ord, id, least(rem, greatest(p_points - before, 0)) as n from cum
  )
  select coalesce((select sum(rem) from lots), 0),
         (select jsonb_agg(jsonb_build_object('lotId', id, 'n', n) order by ord) from tk where n > 0),
         (select jsonb_object_agg(ord::text, n) from tk where n > 0)
    into bal, takes, nmap;
  if bal < p_points then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;

  select coalesce(jsonb_agg(case when nmap ? (ord::text)
                                 then jsonb_set(e, '{remaining}', to_jsonb((e->>'remaining')::int - (nmap->>(ord::text))::int))
                                 else e end order by ord), '[]'::jsonb)
    into new_ledger from jsonb_array_elements(ledger) with ordinality as t(e, ord);
  new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
    'id', eid, 'at', nowz, 'delta', -p_points, 'reason', 'ใช้เป็นส่วนลด ' || o.code, 'orderId', o.id, 'takes', takes));
  update public.punpang_customers set data = jsonb_set(data, '{ledger}', new_ledger), updated_at = now() where id = c.id;

  amt := round(p_points * pv, 2);
  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{pointsUsed}', jsonb_build_object('points', p_points, 'amount', amt, 'entryId', eid)),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowz, 'by', role_, 'text', 'ใช้ ' || p_points || ' คะแนน ลด ' || to_char(amt, 'FM999,999,990.00') || ' ฿')))
   where id = o.id;
  return jsonb_build_object('ok', true, 'entryId', eid, 'points', p_points, 'amount', amt);
end $$;

create or replace function public.punpang_remove_points(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; pu jsonb; ledger jsonb; new_ledger jsonb; entry jsonb; gmap jsonb;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if role_ is null or not public.punpang_has_perm('useLoyalty') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  pu := o.data->'pointsUsed';
  if pu is null or pu = 'null'::jsonb then return jsonb_build_object('error', 'none'); end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  select e into entry from jsonb_array_elements(ledger) e where e->>'id' = pu->>'entryId';
  if entry is null or coalesce((entry->>'refunded')::boolean, false) then return jsonb_build_object('error', 'invalid'); end if;
  select coalesce(jsonb_object_agg(t->>'lotId', (t->>'n')::int), '{}'::jsonb) into gmap from jsonb_array_elements(coalesce(entry->'takes', '[]'::jsonb)) t;

  select coalesce(jsonb_agg(case
           when e->>'id' = pu->>'entryId' then jsonb_set(e, '{refunded}', 'true'::jsonb)
           when gmap ? (e->>'id') then jsonb_set(e, '{remaining}', to_jsonb(coalesce((e->>'remaining')::int, 0) + (gmap->>(e->>'id'))::int))
           else e end order by ord), '[]'::jsonb)
    into new_ledger from jsonb_array_elements(ledger) with ordinality as t(e, ord);
  new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
    'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -((entry->>'delta')::int), 'reason', 'คืนคะแนน ' || o.code, 'orderId', o.id, 'refund', true));
  update public.punpang_customers set data = jsonb_set(data, '{ledger}', new_ledger), updated_at = now() where id = c.id;

  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{pointsUsed}', 'null'::jsonb),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowz, 'by', role_, 'text', 'ยกเลิกการใช้ ' || (pu->>'points') || ' คะแนน')))
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
