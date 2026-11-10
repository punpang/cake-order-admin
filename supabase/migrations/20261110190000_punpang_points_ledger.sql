-- แต้มสะสมแบบอะตอมิก ขั้นที่ 1 (ฐานข้อมูล): สมุดแต้มแยกเป็นแถวต่อรายการ + RPC ที่ล็อกแถวลูกค้าก่อนแก้
-- ยังไม่ตัดข้อมูลเดิมออกจาก punpang_customers.data.ledger และแอปยังไม่เรียกใช้ (ขั้นที่ 2 ย้ายแอปมาเรียก RPC แล้วค่อยหยุดเขียน ledger เดิม)
-- โครงสร้างรายการ 1:1 กับ ledger เดิม: ก้อนแต้ม (delta>0: remaining, expires_at) · ใช้แต้ม (delta<0: takes) · คืนแต้ม (refund) · ตัดแต้ม (ไม่มี takes)
-- ทุกการแก้ผ่าน RPC เท่านั้น (ตารางไม่มี policy เขียน) · ล็อกด้วย select ... for update บนแถวลูกค้า = คิวต่อคน กันตัด/คืนแต้มชนกัน

create table if not exists public.punpang_points (
  seq bigint generated always as identity,
  id text primary key,
  customer_id text not null references public.punpang_customers(id) on delete cascade,
  at timestamptz not null default now(),
  delta integer not null check (delta <> 0),
  reason text not null default '',
  order_id text,
  expires_at text,                       -- 'YYYY-MM-DD' (เฉพาะก้อนแต้ม)
  remaining integer check (remaining is null or remaining >= 0),
  takes jsonb,                           -- [{lotId, n}] (เฉพาะรายการใช้แต้ม)
  refunded boolean not null default false,
  refund boolean not null default false,
  adjust boolean not null default false,
  by_role text,
  idem_key text
);
create index if not exists punpang_points_customer_idx on public.punpang_points (customer_id, seq);
create unique index if not exists punpang_points_idem_uniq on public.punpang_points (customer_id, idem_key) where idem_key is not null;
alter table public.punpang_points enable row level security;

do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'punpang_points' and policyname = 'points_read') then
    create policy points_read on public.punpang_points for select to authenticated
      using (public.punpang_has_perm('manage') or public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('createOrder')
          or public.punpang_has_perm('pos') or public.punpang_has_perm('chat') or public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('adjustPoints'));
  end if;
end $$;

-- ---------- ตัวช่วย (ไม่เปิดให้เรียกจากภายนอก) ----------
create or replace function public.punpang__pts_today() returns text
language sql stable set search_path = '' as $$ select to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD') $$;

create or replace function public.punpang__pts_staff() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(s.role, 'staff') from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active
$$;

create or replace function public.punpang__pts_cfg(k text, d numeric) returns numeric
language sql stable security definer set search_path = '' as $$
  select coalesce((select (kv.data->'v'->>k)::numeric from public.punpang_kv kv where kv.collection = 'config' and kv.id = 'loyalty'), d)
$$;

create or replace function public.punpang__pts_newid() returns text
language sql volatile set search_path = '' as $$ select 'pt' || substr(md5(random()::text || clock_timestamp()::text), 1, 13) $$;

create or replace function public.punpang__pts_lock(cid text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.punpang_customers where id = cid for update;
  return found;
end $$;

create or replace function public.punpang__pts_balance(cid text) returns integer
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(remaining), 0)::int from public.punpang_points
   where customer_id = cid and delta > 0 and remaining > 0 and (expires_at is null or expires_at >= public.punpang__pts_today())
$$;

-- ตัดแต้ม n จากก้อนที่ใกล้หมดอายุก่อน (ผู้เรียกล็อกลูกค้าแล้ว) → takes · คืน null ถ้าไม่พอ
create or replace function public.punpang__pts_take(cid text, n integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare lot record; left_n integer := n; k integer; takes jsonb := '[]'::jsonb;
begin
  if n <= 0 or public.punpang__pts_balance(cid) < n then return null; end if;
  for lot in
    select id, remaining from public.punpang_points
     where customer_id = cid and delta > 0 and remaining > 0 and (expires_at is null or expires_at >= public.punpang__pts_today())
     order by coalesce(expires_at, '9999'), seq
     for update
  loop
    exit when left_n = 0;
    k := least(lot.remaining, left_n);
    update public.punpang_points set remaining = remaining - k where id = lot.id;
    left_n := left_n - k;
    takes := takes || jsonb_build_array(jsonb_build_object('lotId', lot.id, 'n', k));
  end loop;
  return takes;
end $$;

-- คืนแต้มตาม takes ของรายการใช้แต้ม (ผู้เรียกล็อกลูกค้าแล้ว)
create or replace function public.punpang__pts_giveback(takes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare t jsonb;
begin
  for t in select * from jsonb_array_elements(coalesce(takes, '[]'::jsonb)) loop
    update public.punpang_points set remaining = remaining + (t->>'n')::int where id = t->>'lotId';
  end loop;
end $$;

-- ---------- RPC ----------
create or replace function public.punpang_points_balance(p_customer text) returns integer
language plpgsql stable security definer set search_path = '' as $$
begin
  if public.punpang__pts_staff() is null then raise exception 'forbidden' using errcode = '42501'; end if;
  return public.punpang__pts_balance(p_customer);
end $$;

-- ได้แต้ม (สร้างก้อนใหม่) · p_key ซ้ำ = คืนก้อนเดิม (เรียกซ้ำปลอดภัย) · แอดมินปรับ (p_adjust) ต้องมีสิทธิ์ adjustPoints
create or replace function public.punpang_points_earn(p_customer text, p_points integer, p_reason text, p_order text default null, p_key text default null, p_adjust boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); ex record; lot_id text; exp text;
begin
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_adjust and not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 1 or p_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  if not public.punpang__pts_lock(p_customer) then return jsonb_build_object('error', 'no_customer'); end if;
  if p_key is not null then
    select * into ex from public.punpang_points where customer_id = p_customer and idem_key = p_key;
    if found then return jsonb_build_object('ok', true, 'id', ex.id, 'expiresAt', ex.expires_at, 'duplicate', true); end if;
  end if;
  exp := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
  lot_id := public.punpang__pts_newid();
  insert into public.punpang_points (id, customer_id, delta, reason, order_id, expires_at, remaining, adjust, by_role, idem_key)
  values (lot_id, p_customer, p_points, left(coalesce(p_reason, ''), 200), p_order, exp, p_points, p_adjust, role_, p_key);
  return jsonb_build_object('ok', true, 'id', lot_id, 'expiresAt', exp);
end $$;

-- ใช้แต้ม: ตรวจยอดคงเหลือภายใต้ล็อก แล้วตัดจากก้อนที่ใกล้หมดอายุก่อน · คืน {ok, id, takes} หรือ {error:'insufficient', balance}
create or replace function public.punpang_points_spend(p_customer text, p_points integer, p_reason text, p_order text default null, p_adjust boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); takes jsonb; eid text;
begin
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_adjust and not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 1 or p_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  if not public.punpang__pts_lock(p_customer) then return jsonb_build_object('error', 'no_customer'); end if;
  takes := public.punpang__pts_take(p_customer, p_points);
  if takes is null then return jsonb_build_object('error', 'insufficient', 'balance', public.punpang__pts_balance(p_customer)); end if;
  eid := public.punpang__pts_newid();
  insert into public.punpang_points (id, customer_id, delta, reason, order_id, takes, adjust, by_role)
  values (eid, p_customer, -p_points, left(coalesce(p_reason, ''), 200), p_order, takes, p_adjust, role_);
  return jsonb_build_object('ok', true, 'id', eid, 'takes', takes);
end $$;

-- คืนแต้มที่ใช้ไป (ยกเลิกการใช้): คืนเข้าก้อนเดิมตาม takes + บันทึกรายการคืน · เรียกซ้ำ = ไม่คืนซ้ำ
create or replace function public.punpang_points_refund(p_entry text, p_reason text default 'คืนคะแนน')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); e record;
begin
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into e from public.punpang_points where id = p_entry;
  if not found or e.delta >= 0 or e.takes is null then return jsonb_build_object('error', 'invalid'); end if;
  if not public.punpang__pts_lock(e.customer_id) then return jsonb_build_object('error', 'no_customer'); end if;
  select * into e from public.punpang_points where id = p_entry for update;
  if e.refunded then return jsonb_build_object('ok', true, 'duplicate', true); end if;
  perform public.punpang__pts_giveback(e.takes);
  update public.punpang_points set refunded = true where id = p_entry;
  insert into public.punpang_points (id, customer_id, delta, reason, order_id, refund, by_role)
  values (public.punpang__pts_newid(), e.customer_id, -e.delta, left(coalesce(p_reason, ''), 200), e.order_id, true, role_);
  return jsonb_build_object('ok', true);
end $$;

-- ตัดแต้มออกจากก้อนที่ได้ไปแล้ว (เช่น ยกเลิกออร์เดอร์ที่ได้แต้ม) · ตัดได้เท่าที่ก้อนนั้นยังเหลือ · คืนจำนวนที่ตัดจริง
create or replace function public.punpang_points_cut(p_customer text, p_lot text, p_points integer, p_reason text, p_order text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); lot record; cut_n integer;
begin
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 1 then return jsonb_build_object('error', 'invalid'); end if;
  if not public.punpang__pts_lock(p_customer) then return jsonb_build_object('error', 'no_customer'); end if;
  select * into lot from public.punpang_points where id = p_lot and customer_id = p_customer and delta > 0 for update;
  if not found then return jsonb_build_object('error', 'no_lot'); end if;
  cut_n := least(coalesce(lot.remaining, 0), p_points);
  if cut_n > 0 then
    update public.punpang_points set remaining = remaining - cut_n where id = p_lot;
    insert into public.punpang_points (id, customer_id, delta, reason, order_id, by_role)
    values (public.punpang__pts_newid(), p_customer, -cut_n, left(coalesce(p_reason, ''), 200), p_order, role_);
  end if;
  return jsonb_build_object('ok', true, 'cut', cut_n);
end $$;

-- ใช้แต้มเป็นส่วนลดของออร์เดอร์ (ธุรกรรมเดียว: ตัดแต้ม + ใส่ pointsUsed ในออร์เดอร์) · มูลค่าต่อแต้มอ่านจากตั้งค่าร้านฝั่งเซิร์ฟเวอร์
create or replace function public.punpang_apply_points(p_order text, p_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); o record; spend jsonb; amt numeric; pv numeric := public.punpang__pts_cfg('pointValue', 1);
begin
  if role_ is null or not public.punpang_has_perm('useLoyalty') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 1 or p_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  if not public.punpang__pts_lock(o.customer_id) then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  if o.status in ('draft', 'cancelled') then return jsonb_build_object('error', 'bad_status'); end if;
  if o.data->'pointsUsed' is not null and o.data->'pointsUsed' <> 'null'::jsonb then return jsonb_build_object('error', 'already_used'); end if;
  spend := public.punpang_points_spend(o.customer_id, p_points, 'ใช้เป็นส่วนลด ' || o.code, o.id);
  if spend ? 'error' then return spend; end if;
  amt := round(p_points * pv, 2);
  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{pointsUsed}', jsonb_build_object('points', p_points, 'amount', amt, 'entryId', spend->>'id')),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', role_, 'text', 'ใช้ ' || p_points || ' คะแนน ลด ' || to_char(amt, 'FM999,999,990.00') || ' ฿')))
   where id = o.id;
  return jsonb_build_object('ok', true, 'entryId', spend->>'id', 'points', p_points, 'amount', amt);
end $$;

-- ยกเลิกการใช้แต้มของออร์เดอร์ (ธุรกรรมเดียว: คืนแต้ม + ล้าง pointsUsed)
create or replace function public.punpang_remove_points(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare role_ text := public.punpang__pts_staff(); o record; pu jsonb; r jsonb;
begin
  if role_ is null or not public.punpang_has_perm('useLoyalty') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  if not public.punpang__pts_lock(o.customer_id) then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  pu := o.data->'pointsUsed';
  if pu is null or pu = 'null'::jsonb then return jsonb_build_object('error', 'none'); end if;
  r := public.punpang_points_refund(pu->>'entryId', 'คืนคะแนน ' || o.code);
  if r ? 'error' then return r; end if;
  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{pointsUsed}', 'null'::jsonb),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'), 'by', role_, 'text', 'ยกเลิกการใช้ ' || (pu->>'points') || ' คะแนน')))
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;

-- ย้ายสมุดแต้มเดิมจาก punpang_customers.data.ledger เข้าตาราง (ทำซ้ำได้ ไม่ซ้ำแถว)
insert into public.punpang_points (id, customer_id, at, delta, reason, order_id, expires_at, remaining, takes, refunded, refund, adjust, by_role)
select e->>'id', c.id, coalesce((e->>'at')::timestamptz, now()), (e->>'delta')::int, coalesce(e->>'reason', ''), nullif(e->>'orderId', ''),
       nullif(e->>'expiresAt', ''), case when (e->>'delta')::int > 0 then coalesce((e->>'remaining')::int, 0) end, e->'takes',
       coalesce((e->>'refunded')::boolean, false), coalesce((e->>'refund')::boolean, false), coalesce((e->>'adjust')::boolean, false), e->>'by'
  from public.punpang_customers c, jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) e
 where (e->>'delta')::int <> 0 and e->>'id' is not null
on conflict (id) do nothing;

-- สิทธิ์เรียก: เฉพาะผู้ล็อกอิน (ตัวช่วย punpang__* ไม่เปิดให้เรียกจากภายนอก)
revoke all on function public.punpang__pts_today(), public.punpang__pts_staff(), public.punpang__pts_cfg(text, numeric), public.punpang__pts_newid(),
  public.punpang__pts_lock(text), public.punpang__pts_balance(text), public.punpang__pts_take(text, integer), public.punpang__pts_giveback(jsonb) from public, anon, authenticated;
revoke all on function public.punpang_points_balance(text), public.punpang_points_earn(text, integer, text, text, text, boolean),
  public.punpang_points_spend(text, integer, text, text, boolean), public.punpang_points_refund(text, text),
  public.punpang_points_cut(text, text, integer, text, text), public.punpang_apply_points(text, integer), public.punpang_remove_points(text) from public, anon;
grant execute on function public.punpang_points_balance(text), public.punpang_points_earn(text, integer, text, text, text, boolean),
  public.punpang_points_spend(text, integer, text, text, boolean), public.punpang_points_refund(text, text),
  public.punpang_points_cut(text, text, integer, text, text), public.punpang_apply_points(text, integer), public.punpang_remove_points(text) to authenticated;
