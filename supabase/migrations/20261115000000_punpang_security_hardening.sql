-- ปิดช่องโหว่ที่พบจากการตรวจโค้ดรอบ 2026-11 (ทุกข้อทดสอบซ้ำได้ด้วย supabase/tests/security.test.sql)
--   1) แชทเว็บ/แอปสร้างกระทู้ไม่ได้: constraint ของ punpang_chats.channel ไม่มี 'web'
--   2) ผู้มีสิทธิ์ createOrder แก้สมุดแต้ม/สิทธิ์หมุน (punpang_customers.data) ตรง ๆ ได้ → ข้าม RPC แต้มทั้งหมด
--   3) RPC แต้มเชื่อค่าจากไคลเอนต์: award_order / ledger_apply / apply_points → ตรวจเทียบข้อมูลของออร์เดอร์ที่เซิร์ฟเวอร์
--   4) สถานะออร์เดอร์รับข้อความอะไรก็ได้
--   5) RPC ของผู้ไม่ล็อกอิน: นับเข้าชมด้วยวันที่ปลอมสร้างแถวไม่จำกัด · ตารางคลิกเต็มแล้วหยุดบันทึกถาวร
--   6) trigger แจ้งเตือน push: ล้มแล้วทำให้การบันทึกข้อมูลหลักล้มตาม · ใช้ search_path = public ใน security definer
--   7) พนักงานที่แจ้งชำระ (reportPayment) ลบ/เขียนทับสลิปในบักเก็ตเดิมได้
-- รันซ้ำได้ปลอดภัย (create or replace / drop ... if exists)

-- ============================================================================
-- 1) channel 'web' (แชทเว็บ/แอปของลูกค้า)
-- ============================================================================
alter table public.punpang_chats drop constraint if exists punpang_chats_channel_check;
alter table public.punpang_chats add constraint punpang_chats_channel_check
  check (channel = any (array['line'::text, 'facebook'::text, 'instagram'::text, 'web'::text]));

-- ============================================================================
-- 2) กันแก้สมุดแต้ม/สิทธิ์หมุนตรง ๆ
-- ผู้ใช้แอป (role authenticated/anon ผ่าน PostgREST) แก้ data.ledger / data.spins ไม่ได้ ยกเว้นแอดมิน (manage · ใช้ตอนลบข้อมูลตามคำขอ PDPA)
-- RPC แต้มเป็น security definer (รันด้วยเจ้าของฟังก์ชัน) และ Edge Function ใช้ service_role จึงไม่ถูกกั้น
-- ลูกค้าใหม่ต้องเริ่มด้วยสมุดว่างและสิทธิ์หมุน 0 · ค่าที่ไม่มีคีย์ = ค่าว่าง (ลูกค้าเก่าที่ยังไม่มี ledger/spins บันทึกซ้ำได้)
-- ============================================================================
create or replace function public.punpang_customers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  old_ledger jsonb;
  new_ledger jsonb;
  old_spins numeric;
  new_spins numeric;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  new_ledger := case when jsonb_typeof(new.data->'ledger') = 'array' then new.data->'ledger' else '[]'::jsonb end;
  new_spins := case when jsonb_typeof(new.data->'spins') = 'number' then (new.data->>'spins')::numeric else 0 end;
  if tg_op = 'INSERT' then
    old_ledger := '[]'::jsonb;
    old_spins := 0;
  else
    old_ledger := case when jsonb_typeof(old.data->'ledger') = 'array' then old.data->'ledger' else '[]'::jsonb end;
    old_spins := case when jsonb_typeof(old.data->'spins') = 'number' then (old.data->>'spins')::numeric else 0 end;
  end if;

  if new_ledger is distinct from old_ledger or new_spins is distinct from old_spins then
    raise exception 'points ledger and spins can only change through the loyalty RPCs' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.punpang_customers_guard() from public, anon, authenticated;

drop trigger if exists punpang_customers_guard on public.punpang_customers;
create trigger punpang_customers_guard
  before insert or update on public.punpang_customers
  for each row execute function public.punpang_customers_guard();

-- ============================================================================
-- 3) ตัวช่วยคำนวณจากข้อมูลออร์เดอร์ (ฟังก์ชันล้วน ไม่แตะตาราง) + ตัวคูณคะแนนสูงสุดจากโปรที่เปิดอยู่
-- ============================================================================
-- ยอดสินค้ารวม = Σ unitPrice × qty (ค่าที่ไม่ใช่ตัวเลข นับเป็น 0)
create or replace function public.punpang__order_goods(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(
    case when (i->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' and (i->>'qty') ~ '^-?[0-9]+(\.[0-9]+)?$'
         then (i->>'unitPrice')::numeric * (i->>'qty')::numeric else 0 end), 0)
  from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) i
$$;

-- เงินที่ชำระแล้ว (ยืนยันแล้ว) = Σ amount ของรายการชำระสถานะ confirmed
create or replace function public.punpang__order_paid(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(
    case when (p->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p->>'amount')::numeric else 0 end), 0)
  from jsonb_array_elements(case when jsonb_typeof(d->'payments') = 'array' then d->'payments' else '[]'::jsonb end) p
  where p->>'status' = 'confirmed'
$$;

-- เพดานยอดออร์เดอร์ (ไม่เกินนี้แน่นอน) = (สินค้า + ค่าส่ง + ปรับราคาที่เป็นบวก) × (1 + VAT) · ใช้กันใช้คะแนนเป็นส่วนลดเกินยอด
create or replace function public.punpang__order_max_total(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (public.punpang__order_goods(d)
          + case when (d->>'shippingFee') ~ '^[0-9]+(\.[0-9]+)?$' then (d->>'shippingFee')::numeric else 0 end
          + greatest(case when (d->'adjustment'->>'amount') ~ '^-?[0-9]+(\.[0-9]+)?$' then (d->'adjustment'->>'amount')::numeric else 0 end, 0))
         * (1 + greatest(case when (d->'vat'->>'rate') ~ '^[0-9]+(\.[0-9]+)?$' then (d->'vat'->>'rate')::numeric else 0 end, 0) / 100)
$$;

-- ตัวคูณคะแนนสูงสุดของโปรที่เปิดใช้อยู่ (config/pointPromos) · ไม่มีค่า/ไม่มีโปร = 1 · เพดาน 100
create or replace function public.punpang__pts_maxmult()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select least(100, greatest(1, coalesce((
    select max(case when (p->>'multiplier') ~ '^[0-9]+(\.[0-9]+)?$' then (p->>'multiplier')::numeric else 1 end)
    from public.punpang_kv kv,
         jsonb_array_elements(case when jsonb_typeof(kv.data->'v') = 'array' then kv.data->'v' else '[]'::jsonb end) p
    where kv.collection = 'config' and kv.id = 'pointPromos' and coalesce(p->>'active', 'true') <> 'false'
  ), 1)))
$$;

revoke all on function public.punpang__order_goods(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__order_paid(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__order_max_total(jsonb) from public, anon, authenticated;
revoke all on function public.punpang__pts_maxmult() from public, anon, authenticated;

-- ============================================================================
-- 4) ให้คะแนนตอนส่งมอบ: ออร์เดอร์ต้องส่งมอบแล้ว · ยอดฐานไม่เกินยอดสินค้าของออร์เดอร์ · คะแนน/สิทธิ์หมุนไม่เกินที่สูตรให้ได้
--    (คะแนน ≤ ⌊ฐาน × ตัวคูณสูงสุด ÷ earnPer⌋ · สิทธิ์หมุน ≤ ⌊ฐาน ÷ spinPer⌋ · ค่าตั้งต้นเหมือนแอป: earnPer 100 · spinPer 500)
-- ============================================================================
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
  if p_base > public.punpang__order_goods(o.data) + 0.01 or p_bonus > p_points then
    return jsonb_build_object('error', 'invalid');
  end if;
  cap_points := floor((p_base + 0.01) * public.punpang__pts_maxmult() / earn_per + 1e-9);
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
  return jsonb_build_object('ok', true, 'lotId', case when p_points > 0 then lot_id else null end, 'points', p_points, 'spins', p_spins);
end $$;

revoke all on function public.punpang_award_order(text, integer, integer, integer, numeric) from public, anon;
grant execute on function public.punpang_award_order(text, integer, integer, integer, numeric) to authenticated;

-- ============================================================================
-- 5) ใช้คะแนนเป็นส่วนลด: ส่วนลดต้องไม่เกินเพดานยอดของออร์เดอร์ (เดิมตรวจที่แอปเท่านั้น)
-- ============================================================================
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
  -- ส่วนลดจากคะแนนต้องไม่เกินยอดที่ออร์เดอร์ต้องชำระ (ใช้เพดานที่ไม่ต่ำกว่ายอดจริงเสมอ: ยังไม่หักคูปอง/ส่วนลดอื่น)
  if p_points * pv > public.punpang__order_max_total(o.data) + 0.01 then return jsonb_build_object('error', 'exceeds_total'); end if;

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

revoke all on function public.punpang_apply_points(text, integer) from public, anon;
grant execute on function public.punpang_apply_points(text, integer) to authenticated;

-- ============================================================================
-- 6) แก้สมุดแต้มหลายรายการ: ตรวจสิทธิ์และเพดานรายการ (เดิมตรวจแค่ว่ามีสิทธิ์ข้อใดข้อหนึ่ง แล้วเพิ่มคะแนนได้ไม่จำกัด)
--   earn   มี orderId → ผู้มีสิทธิ์คืนเงิน/ยกเลิก/เปลี่ยนผู้ซื้อ/แอดมิน · ออร์เดอร์ต้องมีอยู่ · คะแนนรวมของออร์เดอร์นั้นที่ยังไม่ถูกใช้ ต้องไม่เกิน
--          max(เงินที่ชำระแล้ว ÷ มูลค่าคะแนน, คะแนนที่ออร์เดอร์ได้ตอนส่งมอบ)
--   earn   ไม่มี orderId → เฉพาะผู้มีสิทธิ์ adjustPoints / manage (เช่น คืนคะแนนคูปองที่ไม่ได้ใช้)
--   spins  เพิ่ม → อ้างออร์เดอร์ (orderId ของรายการเอง หรือของ earn รายการแรกในชุดเดียวกัน) ไม่เกินสิทธิ์หมุนที่ออร์เดอร์ได้ · ไม่มีออร์เดอร์ → เฉพาะ adjustPoints / manage
--   รายการที่ลดหรือคืนของเดิม (cut, cut_refund, refund_spend, spins ติดลบ) ไม่เพิ่มคะแนน จึงใช้สิทธิ์ระดับฟังก์ชันตามเดิม
-- ============================================================================
create or replace function public.punpang_ledger_apply(p_customer text, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  c record;
  ledger jsonb;
  spins_ integer;
  op jsonb;
  t jsonb;
  kind text;
  lot jsonb;
  n integer;
  cut integer;
  lid text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text;
  is_admin boolean;
  oid text;
  sib_oid text;
  ord record;
  pv numeric := greatest(public.punpang__pts_cfg('pointValue', 1), 0.01);
  cap integer;
  live integer;
begin
  if role_ is null or not (public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel') or public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('adjustPoints') or public.punpang_has_perm('manage')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 50 then
    raise exception 'invalid_op';
  end if;
  is_admin := public.punpang_has_perm('manage') or public.punpang_has_perm('adjustPoints');
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then raise exception 'no_customer'; end if;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  spins_ := coalesce((c.data->>'spins')::int, 0);
  exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
  -- ออร์เดอร์อ้างอิงของชุดนี้ (เปลี่ยนผู้ซื้อส่ง earn + spins ของออร์เดอร์เดียวกันมาด้วยกัน)
  select nullif(e->>'orderId', '') into sib_oid
    from jsonb_array_elements(p_ops) e
   where e->>'op' = 'earn' and nullif(e->>'orderId', '') is not null
   limit 1;

  for op in select value from jsonb_array_elements(p_ops) loop
    kind := op->>'op';

    if kind = 'earn' then
      n := (op->>'points')::int;
      lid := op->>'id';
      if n is null or n <= 0 or n > 1000000 or lid is null or lid = '' or length(lid) > 64 then raise exception 'invalid_op'; end if;
      if exists (select 1 from jsonb_array_elements(ledger) x where x->>'id' = lid) then raise exception 'dup_id'; end if;
      oid := nullif(op->>'orderId', '');
      if oid is null then
        if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
      else
        if not (is_admin or public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('cancel') or public.punpang_has_perm('changeBuyer')) then
          raise exception 'forbidden' using errcode = '42501';
        end if;
        select * into ord from public.punpang_orders where id = oid;
        if not found then raise exception 'invalid_op'; end if;
        cap := greatest(
          floor(public.punpang__order_paid(ord.data) / pv)::int + 1,
          coalesce((ord.data->'loyalty'->>'points')::int, 0));
        select coalesce(sum((x->>'remaining')::int), 0) into live
          from jsonb_array_elements(ledger) x
         where x->>'orderId' = oid and (x->>'delta')::int > 0 and coalesce((x->>'remaining')::int, 0) > 0
           and coalesce((x->>'adjust')::boolean, false) = false
           and x->>'id' is distinct from (ord.data->'loyalty'->>'lotId');
        if n + live > cap then raise exception 'cap_exceeded'; end if;
      end if;
      ledger := ledger || jsonb_build_array(jsonb_build_object(
        'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
        'expiresAt', exp_at, 'remaining', n));

    elsif kind in ('cut', 'cut_refund') then
      lot := null;
      if op->>'lotId' is not null then
        select x into lot from jsonb_array_elements(ledger) x where x->>'id' = op->>'lotId' limit 1;
      elsif kind = 'cut_refund' and op->>'label' is not null and op->>'points' is not null then
        select x into lot from jsonb_array_elements(ledger) x
         where x->>'orderId' is not distinct from op->>'orderId' and x->>'reason' = op->>'label' and (x->>'delta')::int = (op->>'points')::int
         limit 1;
      end if;
      if lot is null then
        if kind = 'cut' then continue; end if; -- โอนผู้ซื้อ: ไม่มีก้อนเดิมให้ตัด = ข้าม (เหมือนเดิม)
        raise exception 'lot_missing';
      end if;
      lid := lot->>'id';

      if kind = 'cut_refund' then
        n := (op->>'points')::int;
        if n is null or n <= 0 or (lot->>'delta')::int <> n or (lot->>'remaining')::int <> n then raise exception 'lot_used'; end if;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
          'takes', jsonb_build_array(jsonb_build_object('lotId', lid, 'n', n))));
      else
        cut := coalesce((lot->>'remaining')::int, 0);
        if cut > 0 then
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
          ledger := ledger || jsonb_build_array(jsonb_build_object(
            'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -cut, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId'));
        end if;
      end if;

    elsif kind = 'refund_spend' then
      select x into lot from jsonb_array_elements(ledger) x where x->>'id' = op->>'entryId' limit 1;
      if lot is not null and coalesce((lot->>'refunded')::boolean, false) = false and (lot->>'delta')::int < 0 then
        for t in select value from jsonb_array_elements(coalesce(lot->'takes', '[]'::jsonb)) loop
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = t->>'lotId'
                                                  then jsonb_set(x, '{remaining}', to_jsonb((x->>'remaining')::int + (t->>'n')::int))
                                                  else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        end loop;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = op->>'entryId' then jsonb_set(x, '{refunded}', 'true'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -((lot->>'delta')::int), 'reason', left(coalesce(op->>'reason', ''), 200),
          'orderId', lot->'orderId', 'refund', true));
      end if;

    elsif kind = 'spins' then
      n := (op->>'delta')::int;
      if n is null or abs(n) > 10000 then raise exception 'invalid_op'; end if;
      if n > 0 then
        oid := coalesce(nullif(op->>'orderId', ''), sib_oid);
        if oid is null then
          if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
        else
          if not (is_admin or public.punpang_has_perm('changeBuyer')) then raise exception 'forbidden' using errcode = '42501'; end if;
          select * into ord from public.punpang_orders where id = oid;
          if not found or n > coalesce((ord.data->'loyalty'->>'spins')::int, 0) then raise exception 'cap_exceeded'; end if;
        end if;
      end if;
      spins_ := greatest(spins_ + n, 0);

    else
      raise exception 'invalid_op';
    end if;
  end loop;

  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(spins_)), updated_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_ops));
end $$;

revoke all on function public.punpang_ledger_apply(text, jsonb) from public, anon;
grant execute on function public.punpang_ledger_apply(text, jsonb) to authenticated;

-- ============================================================================
-- 7) สถานะออร์เดอร์ต้องเป็นค่าที่ระบบรู้จัก (ตรวจเฉพาะตอนเพิ่มแถว/เปลี่ยนสถานะ จึงไม่ติดแถวเก่าที่มีค่าแปลก)
-- ============================================================================
create or replace function public.punpang_orders_status_valid()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (tg_op = 'INSERT' or new.status is distinct from old.status)
     and new.status not in ('draft', 'awaiting_payment', 'payment_reported', 'payment_confirmed', 'order_confirmed', 'preparing',
                            'prepared', 'ready_to_ship', 'shipping', 'delivered', 'cancelled', 'pos_pending') then
    raise exception 'invalid order status: %', new.status using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public.punpang_orders_status_valid() from public, anon, authenticated;

drop trigger if exists punpang_orders_status_valid on public.punpang_orders;
create trigger punpang_orders_status_valid
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_orders_status_valid();

-- ============================================================================
-- 8) RPC ของผู้ไม่ล็อกอิน
-- ============================================================================
-- นับเข้าชม: ใช้วันที่ (เวลาไทย) ของเซิร์ฟเวอร์เสมอ · พารามิเตอร์ p_day คงไว้เพื่อให้แอปเวอร์ชันเดิมเรียกได้ แต่ไม่ถูกใช้เป็นคีย์
-- (เดิมรับวันอะไรก็ได้ที่ตรงรูปแบบ เช่น 9999-99-99 → สร้างแถวไม่จำกัดโดยผู้ที่ไม่ล็อกอิน)
create or replace function public.punpang_record_pageview(p_day text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  today_ text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
begin
  if p_day is null or p_day !~ '^\d{4}-\d{2}-\d{2}$' then
    return;
  end if;
  insert into public.punpang_kv (collection, id, data)
  values ('pageViews', today_, jsonb_build_object('n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object('n', coalesce((public.punpang_kv.data->>'n')::integer, 0) + 1);
end;
$$;

-- สถิติคลิกแบบเค้ก: ตารางเต็ม (50,000 แถว) แล้วลบแถวที่เก่ากว่า 90 วันก่อน แทนที่จะหยุดบันทึกถาวร
create or replace function public.punpang_record_click(p_photo text, p_visitor text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_photo is null or p_visitor is null or p_photo !~ '^[A-Za-z0-9_-]{1,64}$' or char_length(p_visitor) not between 8 and 64 then return; end if;
  -- กันถูกยิงถล่ม: ผู้เยี่ยมชมหนึ่งคนไม่เกิน 300 รูป · ทั้งระบบไม่เกิน 50,000 แถว
  if (select count(*) from public.punpang_cake_clicks where v = p_visitor) >= 300 then return; end if;
  if (select count(*) from public.punpang_cake_clicks) >= 50000 then
    delete from public.punpang_cake_clicks where at < now() - interval '90 days';
    if (select count(*) from public.punpang_cake_clicks) >= 50000 then return; end if;
  end if;
  insert into public.punpang_cake_clicks (v, photo_id) values (p_visitor, p_photo) on conflict do nothing;
end $$;

-- ============================================================================
-- 9) trigger แจ้งเตือน push: แจ้งเตือนล้มเหลวต้องไม่ทำให้การบันทึกข้อมูลหลักล้มตาม · search_path ว่าง
-- ============================================================================
create or replace function public.punpang_push_on_bell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.collection = 'bell'
     and new.data->>'audience' = 'staff'
     and new.data->>'event' in ('team_new_order', 'team_customer_paid', 'chat_inbound', 'team_due_soon') then
    begin
      perform net.http_post(
        url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := jsonb_build_object('recordId', new.id),
        timeout_milliseconds := 5000
      );
    exception when others then
      null; -- แจ้งเตือนไม่ออก ไม่ทำให้การเพิ่มกระดิ่งล้ม
    end;
  end if;
  return new;
end;
$$;

create or replace function public.punpang_push_on_chat()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  n_new int;
  n_old int := 0;
begin
  if new.channel = 'web' and new.customer_id is not null and jsonb_typeof(new.data->'messages') = 'array' then
    n_new := jsonb_array_length(new.data->'messages');
    if tg_op = 'UPDATE' and jsonb_typeof(old.data->'messages') = 'array' then
      n_old := jsonb_array_length(old.data->'messages');
    end if;
    -- ต้องมีข้อความเพิ่มท้ายกระทู้ และข้อความท้ายสุดนั้นเป็นของพนักงาน
    if n_new > n_old and (new.data->'messages'->(n_new - 1))->>'from' = 'staff' then
      begin
        perform net.http_post(
          url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
          headers := jsonb_build_object('Content-Type', 'application/json'),
          body := jsonb_build_object('chatId', new.id),
          timeout_milliseconds := 5000
        );
      exception when others then
        null; -- แจ้งเตือนไม่ออก ไม่ทำให้การบันทึกข้อความของพนักงานล้ม
      end;
    end if;
  end if;
  return new;
end;
$$;

-- ============================================================================
-- 10) สลิปในบักเก็ตเดิม (punpang-slips): แยกสิทธิ์จาก FOR ALL
--     อ่าน = ผู้แจ้ง/ยืนยันชำระ (+ viewAllOrders จากนโยบายเดิม) · เพิ่ม = ผู้แจ้งชำระ · แก้/ลบ = ผู้ยืนยันชำระหรือแอดมินเท่านั้น
--     (ไฟล์ใหม่เก็บที่ R2 ผ่าน Worker แล้ว บักเก็ตนี้เหลือไฟล์เก่าที่รอลบตามอายุ)
-- ============================================================================
drop policy if exists punpang_slips_rw on storage.objects;
drop policy if exists punpang_slips_read on storage.objects;
drop policy if exists punpang_slips_ins on storage.objects;
drop policy if exists punpang_slips_upd on storage.objects;
drop policy if exists punpang_slips_del on storage.objects;
create policy punpang_slips_read on storage.objects for select to authenticated
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')));
create policy punpang_slips_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'punpang-slips' and public.punpang_has_perm('reportPayment'));
create policy punpang_slips_upd on storage.objects for update to authenticated
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('manage')))
  with check (bucket_id = 'punpang-slips' and (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('manage')));
create policy punpang_slips_del on storage.objects for delete to authenticated
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('manage')));
