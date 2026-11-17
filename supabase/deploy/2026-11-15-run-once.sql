-- รันทีเดียว · รอบ 2026-11-15 (รันก่อน deploy หน้าเว็บใหม่และ Edge Functions)
-- รวมจาก supabase/migrations ตามลำดับชื่อ: 000000 ถึง 070000, 090000, 100000, 110000
-- ไม่รวม 20261115080000 (รันหลัง deploy หน้าเว็บและ quote-create แล้วเท่านั้น) และไม่รวม 20261114025000 (ห้ามรันบน production)
-- ทั้งไฟล์อยู่ในธุรกรรมเดียว (begin ... commit): ขั้นใดผิดพลาด ทุกอย่างย้อนกลับ ไม่มีผลค้างครึ่งทาง
-- ก่อนรัน: (1) สำรองฐานข้อมูล (2) สร้าง Vault secret ชื่อ push_send_key ด้วยค่าเดียวกับ Edge secret PUSH_SEND_KEY
--     select vault.create_secret('<ค่า>', 'push_send_key');
--     (ตรวจเมื่อ 2026-11-15: production มีเฉพาะ scheduled_key)
-- หลังรัน: deploy Edge Functions (order-audit, quote-create, push-send) และหน้าเว็บ แล้วค่อยรัน supabase/migrations/20261115080000_punpang_quote_server.sql
begin;

-- ===== supabase/migrations/20261115000000_punpang_security_hardening.sql =====
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


-- ===== supabase/migrations/20261115010000_punpang_chat_photo_prune_cron.sql =====
-- ตั้งเวลาลบรูปในแชทเว็บ/แอปที่ครบ 90 วัน: pg_cron วันละครั้ง → pg_net → Edge Function chat-photo-prune
-- บันทึกงานที่ production ตั้งไว้แล้ว (ผ่าน SQL Editor) ลงรีโป เพื่อให้สร้างฐานข้อมูลใหม่ได้ตรงกัน · ไม่ต้องรันซ้ำบน production
-- ใช้ค่าลับชุดเดียวกับงาน punpang-scheduled: Edge secret SCHEDULED_KEY และ Vault ชื่อ scheduled_key
-- (ดูขั้นตอนตั้งค่าใน 20261113064656_punpang_scheduled_cron.sql) · ยังไม่ตั้งค่าลับ = ฟังก์ชันตอบ 403 ไม่เกิดอะไรขึ้น
-- ก่อนใช้งาน: deploy ฟังก์ชัน chat-photo-prune (GitHub Actions → Deploy chat-photo-prune)
-- เวลา 03:40 UTC = 10:40 เวลาไทย (ตามที่ตั้งไว้ใน production) · ชื่องานเดิมซ้ำ = ถูกแทนที่ (รันซ้ำได้)
create extension if not exists pg_net;

select cron.schedule(
  'punpang-chat-photo-prune',
  '40 3 * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/chat-photo-prune',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);


-- ===== supabase/migrations/20261115020000_punpang_loyalty_order_guards.sql =====
-- รอบแก้ 2026-11-15 (ต่อจาก 20261115000000 · รันหลังไฟล์นั้น · รันซ้ำได้ปลอดภัย)
-- ปิดช่องที่ตรวจพบด้วยการเรียกฐานข้อมูลจริง (supabase/tests/security.test.sql รอบนี้):
--   A) คืนเงินเป็นคะแนน (earn ที่อ้างออร์เดอร์) ซ้ำได้หลังคะแนนถูกใช้ไปแล้ว → เพดานต้องสะสมต่อออร์เดอร์ ไม่นับเฉพาะคะแนนที่ยังไม่ใช้
--   B) ออกคะแนนจากออร์เดอร์ของลูกค้าคนหนึ่งให้ลูกค้าอีกคนได้ → คืนเงินต้องเป็นของผู้ซื้อในออร์เดอร์นั้น
--   C) สิทธิ์หมุนที่อ้างออร์เดอร์เพิ่มได้ไม่จำกัดครั้ง → การโอนสิทธิ์โอนได้เฉพาะที่ตัดจากผู้ซื้อเดิมไว้
--   D) ผู้ใช้แอป (ผ่าน PostgREST) แก้ราคา/จำนวนรายการ ส่วนลด ค่าส่ง VAT ยอดงวดที่ชำระ ผู้ซื้อ คะแนน/คูปองที่ใช้ได้ทุกออร์เดอร์
--      → trigger ตรวจรายฟิลด์ตามสิทธิ์ (ไม่เขียนค่าใหม่ลงแถวออร์เดอร์ เพื่อไม่ให้ updated_at ขยับทำให้แอปขัดแย้งตอนบันทึก)
--
-- หลักการบัญชีของคะแนนและสิทธิ์หมุน (เก็บใน punpang_order_issued แยกจากแถวออร์เดอร์):
--   refund_points  คะแนนที่ออกจาก "คืนเงิน" ของออร์เดอร์ (สะสม · ใช้แล้วยังนับ จึงออกซ้ำไม่ได้ · ลดได้เฉพาะตอนตัดก้อนที่ยังไม่ได้ใช้ออกไป)
--   pending_points / pending_exp   คะแนนที่ถูกตัดจากผู้ซื้อเดิม รอโอนให้ผู้ซื้อใหม่ (โอนได้ไม่เกินยอดที่ตัดจริง)
--   pending_spins  สิทธิ์หมุนที่ถูกตัดจากผู้ซื้อเดิม รอโอนให้ผู้ซื้อใหม่ (เช่นเดียวกัน)
-- ทุกหน่วยที่เข้ามาใหม่มาจากการตัดของเดิมเท่านั้น จึงไม่มีการสร้างคะแนน/สิทธิ์หมุนขึ้นมาเอง

-- ============================================================================
-- 1) ตารางยอดที่ออกจากแต่ละออร์เดอร์ (ไม่มี policy · เข้าถึงผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์เท่านั้น)
-- ============================================================================
create table if not exists public.punpang_order_issued (
  order_id text primary key references public.punpang_orders(id) on delete cascade,
  refund_points integer not null default 0 check (refund_points >= 0),
  pending_points integer not null default 0 check (pending_points >= 0),
  pending_exp text,
  pending_spins integer not null default 0 check (pending_spins >= 0),
  updated_at timestamptz not null default now()
);
alter table public.punpang_order_issued enable row level security;
revoke all on public.punpang_order_issued from anon, authenticated;

-- อ่านแถวของออร์เดอร์ (สร้างถ้ายังไม่มี) พร้อมล็อกแถวเพื่อให้การเพิ่ม/ลดยอดต่อออร์เดอร์เรียงกันทีละรายการ
create or replace function public.punpang__issued_row(p_order text)
returns public.punpang_order_issued
language plpgsql
set search_path = ''
as $$
declare r public.punpang_order_issued;
begin
  insert into public.punpang_order_issued (order_id) values (p_order) on conflict (order_id) do nothing;
  select * into r from public.punpang_order_issued where order_id = p_order for update;
  return r;
end $$;
revoke all on function public.punpang__issued_row(text) from public, anon, authenticated;

-- ยกมาจากข้อมูลเดิม: คืนเงินเป็นคะแนนที่เคยออกไปแล้ว (ก้อนที่ไม่ใช่ก้อนของการขาย) นับเป็นยอดที่ออกแล้ว · เกินจริงได้ (ปลอดภัยกว่าต่ำไป)
insert into public.punpang_order_issued (order_id, refund_points)
select s.oid, least(s.issued, 2000000000)::int
  from (
    select g.oid, sum(g.d) as issued
      from (
        select e->>'orderId' as oid,
               e->>'id' as lid,
               case when (e->>'delta') ~ '^[0-9]+$' then (e->>'delta')::int else 0 end as d
          from public.punpang_customers c
          cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data->'ledger') = 'array' then c.data->'ledger' else '[]'::jsonb end) e
         where nullif(e->>'orderId', '') is not null
           and coalesce(e->>'adjust', 'false') <> 'true'
      ) g
      join public.punpang_orders o on o.id = g.oid
     where g.d > 0
       and g.lid is distinct from (o.data->'loyalty'->>'lotId')
     group by g.oid
  ) s
on conflict (order_id) do update set refund_points = excluded.refund_points;

-- ============================================================================
-- 2) สมุดแต้ม/สิทธิ์หมุนหลายรายการ (แทนฉบับ 20261115000000)
--    earn ไม่อ้างออร์เดอร์      → เฉพาะแอดมิน (เหมือนเดิม)
--    earn อ้างออร์เดอร์         → คืนเงิน: ต้องเป็นผู้ซื้อของออร์เดอร์ และสะสมไม่เกินยอดที่ชำระจริง ÷ มูลค่าคะแนน
--    earn อ้างออร์เดอร์ transfer:true → โอน: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้ (ต้องมีสิทธิ์เปลี่ยนผู้ซื้อหรือแอดมิน)
--    spins อ้างออร์เดอร์ (บวก) → โอน: ต้องมี transfer:true และได้ไม่เกินที่ตัดไว้ · ไม่มีการเดาออร์เดอร์จากรายการอื่นในชุดเดียวกันอีก
--    cut / cut_refund / spins (ลบ) ที่อ้างออร์เดอร์ → บันทึกยอดที่รอโอนหรือยอดคืนเงินที่ถูกตัด
--    เกินเพดาน/ไม่ใช่เจ้าของ → error (คืนเงิน) · โอนที่เกินที่ตัดไว้ → โอนเท่าที่มี (ไม่ error)
-- ============================================================================
create or replace function public.punpang_ledger_apply(p_customer text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  removed integer;
  granted integer;
  lid text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text;
  new_exp text;
  is_admin boolean;
  is_changer boolean;
  is_refunder boolean;
  oid text;
  lot_oid text;
  orec record;
  iss public.punpang_order_issued;
  pv numeric := greatest(public.punpang__pts_cfg('pointValue', 1), 0.01);
  cap integer;
begin
  if role_ is null or not (public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel') or public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('adjustPoints') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 50 then
    raise exception 'invalid_op';
  end if;
  is_admin := public.punpang_has_perm('manage') or public.punpang_has_perm('adjustPoints');
  is_changer := is_admin or public.punpang_has_perm('changeBuyer');
  is_refunder := is_changer or public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('cancel');

  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then raise exception 'no_customer'; end if;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  spins_ := coalesce((c.data->>'spins')::int, 0);
  exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');

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
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'expiresAt', exp_at, 'remaining', n));
        continue;
      end if;

      select * into orec from public.punpang_orders where id = oid;
      if not found then raise exception 'invalid_op'; end if;
      iss := public.punpang__issued_row(oid);

      if coalesce((op->>'transfer')::boolean, false) then
        -- โอนคะแนนของออร์เดอร์: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้ (ไม่มีการสร้างคะแนนขึ้นใหม่)
        if not is_changer then raise exception 'forbidden' using errcode = '42501'; end if;
        granted := least(n, iss.pending_points);
        if granted <= 0 then continue; end if;
        new_exp := coalesce(iss.pending_exp, exp_at);
        update public.punpang_order_issued
           set pending_points = pending_points - granted,
               pending_exp = case when pending_points - granted > 0 then pending_exp else null end,
               updated_at = now()
         where order_id = oid;
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', granted, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', oid,
          'expiresAt', new_exp, 'remaining', granted, 'src', 'transfer'));
      else
        -- คืนเงินเป็นคะแนน: ต้องเป็นผู้ซื้อของออร์เดอร์ และสะสมทุกครั้งไม่เกินยอดที่ชำระจริง ÷ มูลค่าคะแนน
        if not is_refunder then raise exception 'forbidden' using errcode = '42501'; end if;
        if orec.customer_id is distinct from p_customer then raise exception 'order_customer_mismatch' using errcode = '42501'; end if;
        cap := floor(public.punpang__order_paid(orec.data) / pv)::int + 1;
        if iss.refund_points + n > cap then raise exception 'cap_exceeded'; end if;
        update public.punpang_order_issued set refund_points = refund_points + n, updated_at = now() where order_id = oid;
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', oid,
          'expiresAt', exp_at, 'remaining', n, 'src', 'refund'));
      end if;

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
      lot_oid := nullif(lot->>'orderId', '');

      if kind = 'cut_refund' then
        n := (op->>'points')::int;
        if n is null or n <= 0 or (lot->>'delta')::int <> n or (lot->>'remaining')::int <> n then raise exception 'lot_used'; end if;
        removed := n;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
          'takes', jsonb_build_array(jsonb_build_object('lotId', lid, 'n', n))));
      else
        cut := coalesce((lot->>'remaining')::int, 0);
        removed := cut;
        if cut > 0 then
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
          ledger := ledger || jsonb_build_array(jsonb_build_object(
            'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -cut, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId'));
        end if;
      end if;

      -- บัญชีของออร์เดอร์ที่ก้อนนี้ผูกอยู่: ก้อนของการขาย/โอน → รอโอนต่อ · ก้อนคืนเงิน → ลดยอดที่ออกแล้ว
      if removed > 0 and lot_oid is not null and exists (select 1 from public.punpang_orders where id = lot_oid) then
        iss := public.punpang__issued_row(lot_oid);
        if (lot->>'src') = 'transfer'
           or ((lot->>'src') is null and lid is not distinct from (select o.data->'loyalty'->>'lotId' from public.punpang_orders o where o.id = lot_oid)) then
          update public.punpang_order_issued
             set pending_points = pending_points + removed,
                 pending_exp = least(coalesce(iss.pending_exp, '9999-12-31'), coalesce(lot->>'expiresAt', exp_at)),
                 updated_at = now()
           where order_id = lot_oid;
        else
          update public.punpang_order_issued
             set refund_points = greatest(refund_points - removed, 0), updated_at = now()
           where order_id = lot_oid;
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
      oid := nullif(op->>'orderId', '');

      if n > 0 then
        if oid is null then
          if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
          spins_ := spins_ + n;
        else
          select * into orec from public.punpang_orders where id = oid;
          if not found then raise exception 'invalid_op'; end if;
          if coalesce((op->>'transfer')::boolean, false) then
            -- โอนสิทธิ์หมุนของออร์เดอร์: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้
            if not is_changer then raise exception 'forbidden' using errcode = '42501'; end if;
            iss := public.punpang__issued_row(oid);
            granted := least(n, iss.pending_spins);
            if granted > 0 then
              update public.punpang_order_issued set pending_spins = pending_spins - granted, updated_at = now() where order_id = oid;
              spins_ := spins_ + granted;
            end if;
          else
            -- สิทธิ์หมุนที่ผูกกับออร์เดอร์โดยตรง (ไม่ใช่การโอน) เป็นของแอดมินเท่านั้น
            if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
            spins_ := spins_ + n;
          end if;
        end if;
      else
        removed := least(spins_, -n);
        spins_ := spins_ - removed;
        if oid is not null and removed > 0 then
          select * into orec from public.punpang_orders where id = oid;
          if not found then raise exception 'invalid_op'; end if;
          iss := public.punpang__issued_row(oid);
          update public.punpang_order_issued set pending_spins = pending_spins + removed, updated_at = now() where order_id = oid;
        end if;
      end if;

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
-- 3) ตรวจรายฟิลด์ของออร์เดอร์ที่ผู้ใช้แอปแก้ผ่าน PostgREST (RPC และ Edge Function ไม่ถูกกั้นที่นี่)
--    ผู้มีสิทธิ์ manage ผ่านทุกข้อ (เหมือนเดิม) · ข้อที่ไม่ตรงสิทธิ์ → 42501
-- ============================================================================
create or replace function public.punpang__items_money(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
    from (
      select coalesce(t.i->>'id', '#' || t.n::text) as k,
             jsonb_build_object('u', t.i->'unitPrice', 'r', t.i->'regularPrice', 'q', t.i->'qty', 'p', t.i->'retailPrice') as v
        from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) with ordinality as t(i, n)
    ) s
$$;

create or replace function public.punpang_orders_field_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pr record;
  np jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- ราคา/จำนวน/รายการ: แอดมินแก้รายการ หรือผู้ปรับราคา หรือผู้สร้างออร์เดอร์ตอนยังเป็นร่าง/รอชำระ
  if public.punpang__items_money(old.data) is distinct from public.punpang__items_money(new.data) then
    if not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
            or (public.punpang_has_perm('createOrder') and old.status in ('draft', 'awaiting_payment'))) then
      raise exception 'no permission to change item prices or quantities' using errcode = '42501';
    end if;
  end if;

  -- ปรับราคา/ส่วนลด (adjustment) → ผู้ปรับราคาเท่านั้น
  if old.data->'adjustment' is distinct from new.data->'adjustment' and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to change adjustment' using errcode = '42501';
  end if;

  -- ค่าส่ง/VAT
  if (old.data->'shippingFee' is distinct from new.data->'shippingFee' or old.data->'vat' is distinct from new.data->'vat')
     and not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
              or public.punpang_has_perm('createOrder') or public.punpang_has_perm('editPickup')) then
    raise exception 'no permission to change shipping fee or VAT' using errcode = '42501';
  end if;

  -- จำนวนเงินของงวดที่มีอยู่แล้ว: งวดที่ยืนยันแล้วต้องมีสิทธิ์ยืนยัน/ยกเลิกยืนยัน/คืนเงิน · งวดที่แจ้งต้องมีสิทธิ์แจ้งยอด/ยืนยัน
  for pr in
    select v.value as p
      from jsonb_array_elements(case when jsonb_typeof(old.data->'payments') = 'array' then old.data->'payments' else '[]'::jsonb end) as v(value)
  loop
    if pr.p->>'id' is null then continue; end if;
    select x.value into np
      from jsonb_array_elements(case when jsonb_typeof(new.data->'payments') = 'array' then new.data->'payments' else '[]'::jsonb end) as x(value)
     where x.value->>'id' = pr.p->>'id'
     limit 1;
    if np is not null and (pr.p->'amount') is distinct from (np->'amount') then
      if pr.p->>'status' = 'confirmed' then
        if not (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial')) then
          raise exception 'no permission to change a confirmed payment amount' using errcode = '42501';
        end if;
      elsif not (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
        raise exception 'no permission to change a payment amount' using errcode = '42501';
      end if;
    end if;
  end loop;

  -- ผู้ซื้อของออร์เดอร์ (เปลี่ยนผู้ซื้อ)
  if new.customer_id is distinct from old.customer_id and not public.punpang_has_perm('changeBuyer') then
    raise exception 'no permission to change the buyer' using errcode = '42501';
  end if;

  -- คะแนนที่ใช้: ตั้งค่าใหม่ต้องผ่านเซิร์ฟเวอร์ (RPC punpang_apply_points) · ลบออกได้ตามสิทธิ์
  if old.data->'pointsUsed' is distinct from new.data->'pointsUsed' then
    if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
      raise exception 'points can only be applied through the server' using errcode = '42501';
    end if;
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to remove points from the order' using errcode = '42501';
    end if;
  end if;

  -- คูปองที่ใช้ในออร์เดอร์ (ส่วนลด)
  if old.data->'couponsUsed' is distinct from new.data->'couponsUsed'
     and not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
              or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
    raise exception 'no permission to change coupons on the order' using errcode = '42501';
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_field_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_field_guard on public.punpang_orders;
create trigger punpang_orders_field_guard
  before update on public.punpang_orders
  for each row execute function public.punpang_orders_field_guard();


-- ===== supabase/migrations/20261115030000_punpang_grants_and_speed.sql =====
-- รอบแก้ 2026-11-15 (สิทธิ์ของผู้ไม่ล็อกอิน + ความเร็ว) · รันหลัง 20261115020000 · รันซ้ำได้ปลอดภัย
-- 1) anon เหลือเฉพาะที่หน้าร้านใช้จริง: อ่านสินค้า (active) / ตั้งค่าสาธารณะ / รีวิวที่อนุมัติ + RPC ที่ออกแบบให้เรียกได้
--    (เดิม anon มีสิทธิ์ ALL บน punpang_cake_clicks, punpang_push_devices, tungngern_* แม้ RLS จะกันแถวไว้)
revoke all on all tables in schema public from anon;
grant select on public.punpang_items, public.punpang_kv, public.punpang_records to anon;

revoke all on all functions in schema public from anon;
grant execute on function public.punpang_record_pageview(text) to anon;
grant execute on function public.punpang_click_pairs() to anon;
grant execute on function public.punpang_record_click(text, text) to anon;
grant execute on function public.punpang_resolve_short_link(text) to anon;

-- 2) TRUNCATE / REFERENCES / TRIGGER ไม่ผ่าน RLS (ค่าเริ่มต้นของ Supabase ให้มาทุกตาราง) → ถอนจาก anon และ authenticated
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- 3) ดัชนีที่ขาด
--    punpang_push_devices.staff_id เป็น FK แต่ไม่มีดัชนี (ลบพนักงานหรือค้นอุปกรณ์ของพนักงานจะสแกนทั้งตาราง)
--    punpang_orders.data ค้นด้วย @> เมื่อตรวจเลขอ้างอิงการชำระซ้ำ (customer-order) → เดิมสแกนทุกออร์เดอร์
create index if not exists punpang_push_devices_staff_id_idx on public.punpang_push_devices (staff_id);
create index if not exists punpang_orders_data_gin on public.punpang_orders using gin (data jsonb_path_ops);

-- 4) นับคลิกรูปเค้ก: เดิมนับทั้งตารางทุกครั้งที่มีคนกด (count(*) ทั้งตาราง) → ใช้ค่าประมาณจากสถิติของตาราง
--    ผู้เยี่ยมชมคนหนึ่งยังนับผ่านดัชนีคู่ (v, photo_id) ได้จำกัด 300 แถว
create or replace function public.punpang_record_click(p_photo text, p_visitor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  est bigint;
  removed bigint;
begin
  if p_photo is null or p_visitor is null or p_photo !~ '^[A-Za-z0-9_-]{1,64}$' or char_length(p_visitor) not between 8 and 64 then
    return;
  end if;
  -- ผู้เยี่ยมชมหนึ่งคนไม่เกิน 300 รูป
  if (select count(*) from (select 1 from public.punpang_cake_clicks where v = p_visitor limit 300) s) >= 300 then
    return;
  end if;
  -- ทั้งระบบไม่เกิน 50,000 แถว (ค่าประมาณจากสถิติ) · เต็มแล้วลบแถวที่เก่ากว่า 90 วันก่อน แทนการหยุดบันทึกถาวร
  select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
  if est >= 50000 then
    delete from public.punpang_cake_clicks where at < now() - interval '90 days';
    get diagnostics removed = row_count;
    if removed > 0 then
      -- อัปเดตสถิติเฉพาะตอนที่ลบจริง (ไม่วิเคราะห์ตารางทุกครั้งที่คนกดตอนตารางเต็ม)
      analyze public.punpang_cake_clicks;
      select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
    end if;
    if est >= 50000 then
      return;
    end if;
  end if;
  insert into public.punpang_cake_clicks (v, photo_id) values (p_visitor, p_photo) on conflict do nothing;
end $$;
revoke all on function public.punpang_record_click(text, text) from public;
grant execute on function public.punpang_record_click(text, text) to anon, authenticated;


-- ===== supabase/migrations/20261115040000_punpang_push_secret.sql =====
-- รอบแก้ 2026-11-15 (แจ้งเตือน push ต้องมีคีย์ลับ) · รันหลัง 20261115030000 · รันซ้ำได้ปลอดภัย
-- push-send ปฏิเสธคำขอที่ไม่มีคีย์ที่ถูกต้อง (เดิมใครรู้ recordId/chatId ก็สั่งส่งแจ้งเตือนได้)
-- ก่อนรันไฟล์นี้ต้องตั้งค่าสองที่ให้ตรงกัน (ไม่ตั้ง = ไม่มีแจ้งเตือนออก):
--   1) Edge Function secret PUSH_SEND_KEY = ค่าสุ่มยาว (เช่น openssl rand -hex 32) · ตั้งก่อน deploy push-send
--   2) Vault: select vault.create_secret('<ค่าเดียวกับ PUSH_SEND_KEY>', 'push_send_key');

create or replace function public.punpang_push_on_bell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if new.collection = 'bell'
     and new.data->>'audience' = 'staff'
     and new.data->>'event' in ('team_new_order', 'team_customer_paid', 'chat_inbound', 'team_due_soon') then
    begin
      select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'push_send_key' limit 1;
      perform net.http_post(
        url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', coalesce(k, '')),
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
  k text;
begin
  if new.channel = 'web' and new.customer_id is not null and jsonb_typeof(new.data->'messages') = 'array' then
    n_new := jsonb_array_length(new.data->'messages');
    if tg_op = 'UPDATE' and jsonb_typeof(old.data->'messages') = 'array' then
      n_old := jsonb_array_length(old.data->'messages');
    end if;
    -- ต้องมีข้อความเพิ่มท้ายกระทู้ และข้อความท้ายสุดนั้นเป็นของพนักงาน
    if n_new > n_old and (new.data->'messages'->(n_new - 1))->>'from' = 'staff' then
      begin
        select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'push_send_key' limit 1;
        perform net.http_post(
          url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
          headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', coalesce(k, '')),
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


-- ===== supabase/migrations/20261115050000_punpang_coupon_guard.sql =====
-- รอบแก้ 2026-11-15 (ส่วนลดคูปอง) · รันหลัง 20261115040000 · รันซ้ำได้ปลอดภัย
-- เดิมส่วนลดคูปองในออร์เดอร์ (couponsUsed) คำนวณในแอปแล้วบันทึกลงแถวออร์เดอร์ตรง ๆ: ผู้มีสิทธิ์ใช้คะแนนใส่คูปองที่ไม่มีอยู่จริง/จำนวนเกินได้
-- ตอนนี้รายการคูปองที่เพิ่มหรือเปลี่ยนจำนวน (ทั้งตอนสร้างและตอนแก้ออร์เดอร์) ต้องตรงกับคูปองที่จองไว้กับออร์เดอร์นี้ที่เซิร์ฟเวอร์:
--   1) คูปองมีอยู่จริง เป็นส่วนลด (type discount) และถูกจองแล้ว (status used) กับออร์เดอร์นี้ (orderId = รหัสออร์เดอร์)
--      ข้อยกเว้นเดียว: ขายหน้าร้าน (channel pos) ที่จองด้วยรหัสชั่วคราว pos-pending ก่อนสร้างบิล (ดูหมายเหตุใน docs/security.md)
--   2) ถ้าคูปองระบุเจ้าของ ต้องเป็นผู้ซื้อของออร์เดอร์ · ยอดสินค้าต้องถึง minSpend ของคูปอง
--   3) ส่วนลดต้องไม่เกินมูลค่าคูปอง และไม่เกินยอดสูงสุดของออร์เดอร์
-- การลบคูปองออกจากออร์เดอร์ไม่ต้องตรวจ (ส่วนลดลดลงเสมอ) · ผู้จัดการ (manage) ผ่านทุกข้อ

-- ============================================================================
-- 1) ตรวจรายการคูปองหนึ่งรายการ (ทำงานด้วยสิทธิ์เจ้าของฟังก์ชันเพื่ออ่านแถวคูปอง · ไม่คืนข้อมูลคูปองให้ผู้เรียก)
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

  cap := case when (cd->>'amount') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'amount')::numeric else 0 end;
  minsp := case when (cd->>'minSpend') ~ '^[0-9]+(\.[0-9]+)?$' then (cd->>'minSpend')::numeric else 0 end;
  if amt < 0 or amt > cap + 0.005 then return false; end if;
  if minsp > 0 and goods < minsp then return false; end if;
  if amt > maxt + 0.01 then return false; end if;
  return true;
end
$$;
revoke all on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.punpang__coupon_entry_ok(text, text, text, jsonb, jsonb) to authenticated;

-- ============================================================================
-- 2) ตอนแก้ออร์เดอร์: ตรวจเฉพาะรายการที่เพิ่มหรือเปลี่ยนจำนวน (แทนการตรวจสิทธิ์อย่างเดียวของฉบับ 20261115020000)
-- ============================================================================
create or replace function public.punpang_orders_field_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pr record;
  np jsonb;
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- ราคา/จำนวนของรายการ: แอดมินแก้รายการ หรือผู้ปรับราคา หรือผู้สร้างออร์เดอร์ตอนยังเป็นร่าง/รอชำระ
  if public.punpang__items_money(old.data) is distinct from public.punpang__items_money(new.data) then
    if not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
            or (public.punpang_has_perm('createOrder') and old.status in ('draft', 'awaiting_payment'))) then
      raise exception 'no permission to change item prices or quantities' using errcode = '42501';
    end if;
  end if;

  -- ปรับราคา/ส่วนลด (adjustment) → ผู้ปรับราคาเท่านั้น
  if old.data->'adjustment' is distinct from new.data->'adjustment' and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to change adjustment' using errcode = '42501';
  end if;

  -- ค่าส่ง/VAT
  if (old.data->'shippingFee' is distinct from new.data->'shippingFee' or old.data->'vat' is distinct from new.data->'vat')
     and not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
              or public.punpang_has_perm('createOrder') or public.punpang_has_perm('editPickup')) then
    raise exception 'no permission to change shipping fee or VAT' using errcode = '42501';
  end if;

  -- จำนวนเงินของงวดที่มีอยู่แล้ว: งวดที่ยืนยันแล้วต้องมีสิทธิ์ยืนยัน/ยกเลิกยืนยัน/คืนเงิน · งวดที่แจ้งต้องมีสิทธิ์แจ้งยอด/ยืนยัน
  for pr in
    select v.value as p
      from jsonb_array_elements(case when jsonb_typeof(old.data->'payments') = 'array' then old.data->'payments' else '[]'::jsonb end) as v(value)
  loop
    if pr.p->>'id' is null then continue; end if;
    select x.value into np
      from jsonb_array_elements(case when jsonb_typeof(new.data->'payments') = 'array' then new.data->'payments' else '[]'::jsonb end) as x(value)
     where x.value->>'id' = pr.p->>'id'
     limit 1;
    if np is not null and (pr.p->'amount') is distinct from (np->'amount') then
      if pr.p->>'status' = 'confirmed' then
        if not (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial')) then
          raise exception 'no permission to change a confirmed payment amount' using errcode = '42501';
        end if;
      elsif not (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
        raise exception 'no permission to change a payment amount' using errcode = '42501';
      end if;
    end if;
  end loop;

  -- ผู้ซื้อของออร์เดอร์ (เปลี่ยนผู้ซื้อ)
  if new.customer_id is distinct from old.customer_id and not public.punpang_has_perm('changeBuyer') then
    raise exception 'no permission to change the buyer' using errcode = '42501';
  end if;

  -- คะแนนที่ใช้: ตั้งค่าใหม่ต้องผ่านเซิร์ฟเวอร์ (RPC punpang_apply_points) · ลบออกได้ตามสิทธิ์
  if old.data->'pointsUsed' is distinct from new.data->'pointsUsed' then
    if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
      raise exception 'points can only be applied through the server' using errcode = '42501';
    end if;
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to remove points from the order' using errcode = '42501';
    end if;
  end if;

  -- คูปองที่ใช้ในออร์เดอร์ (ส่วนลด): ต้องมีสิทธิ์ก่อน แล้วรายการที่เพิ่มหรือเปลี่ยนจำนวนต้องตรงกับคูปองที่จองไว้กับออร์เดอร์นี้
  if old.data->'couponsUsed' is distinct from new.data->'couponsUsed' then
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to change coupons on the order' using errcode = '42501';
    end if;
    for cp in
      select v.value as e
        from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
    loop
      if exists (
        select 1
          from jsonb_array_elements(case when jsonb_typeof(old.data->'couponsUsed') = 'array' then old.data->'couponsUsed' else '[]'::jsonb end) as o(value)
         where o.value = cp.e
      ) then
        continue; -- รายการเดิมที่ไม่เปลี่ยน
      end if;
      if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
        raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
      end if;
    end loop;
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_field_guard() from public, anon, authenticated;

-- ============================================================================
-- 3) ตอนสร้างออร์เดอร์ใหม่: คูปองที่ใส่มาต้องผ่านการตรวจเดียวกัน (ก่อนหน้านี้ไม่มีตรวจตอนสร้าง)
-- ============================================================================
create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_insert_guard on public.punpang_orders;
create trigger punpang_orders_insert_guard
  before insert on public.punpang_orders
  for each row execute function public.punpang_orders_insert_guard();


-- ===== supabase/migrations/20261115060000_punpang_order_insert_guard.sql =====
-- รอบแก้ 2026-11-15 (ตอนสร้างออร์เดอร์) · รันหลัง 20261115050000 · รันซ้ำได้ปลอดภัย
-- เดิมการสร้างออร์เดอร์ใหม่ (INSERT) ไม่มีการตรวจ: คะแนนที่ใช้ (pointsUsed) และส่วนลด/ปรับราคา (adjustment) ใส่มาเองได้ ทดสอบแล้ว
-- ตอนนี้ (ผู้จัดการผ่านทุกข้อ):
--   1) คะแนนที่ใช้ต้องเป็นค่าว่างตอนสร้าง (คะแนนที่ใช้ตั้งได้เฉพาะผ่านเซิร์ฟเวอร์ตอนใช้คะแนน)
--   2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
--   3) คูปองที่ใส่มา ต้องผ่านการตรวจเดียวกับฉบับ 20261115050000
-- ตรงกับแอป: การสร้างออร์เดอร์ใหม่ตั้งส่วนลดเป็นศูนย์และคะแนนว่างเสมอ · บิลหน้าร้านให้ส่วนลดเฉพาะผู้ที่มีสิทธิ์ปรับราคา (หน้าจอซ่อนช่องนี้ไว้)
-- ยังไม่ตรวจในรอบนี้: ราคาต่อรายการตอนสร้างออร์เดอร์ (ต้องออกแบบให้ตรวจกับแคตตาล็อกก่อน — ดู docs/security.md)

create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- 1) คะแนนที่ใช้ต้องว่างตอนสร้าง
  if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
    raise exception 'points can only be applied through the server' using errcode = '42501';
  end if;

  -- 2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
  if (new.data->'adjustment'->>'amount') is not null
     and (new.data->'adjustment'->>'amount') !~ '^-?0+(\.0+)?$'
     and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to set a discount or adjustment' using errcode = '42501';
  end if;

  -- 3) คูปองที่ใส่มา ต้องผ่านการตรวจ (ฉบับ 20261115050000)
  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;

  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;


-- ===== supabase/migrations/20261115070000_punpang_quote_lock.sql =====
-- รอบแก้ 2026-11-15 (ราคาตามใบเสนอ — ล็อก) · รันหลัง 20261115060000 · รันซ้ำได้ปลอดภัย
-- ตัดสินใจแล้ว (ทางเลือก A): ราคาในใบเสนอที่ส่งให้ลูกค้าแล้วคือราคาที่ตกลง
--   1) ข้อมูลของใบเสนอ (data.payload: รายการ ราคา VAT ค่าส่ง) แก้ไม่ได้หลังบันทึก · ลูกค้าและแชทของใบเสนอเปลี่ยนไม่ได้
--      (ทำได้เฉพาะเปลี่ยนสถานะ ผูกออร์เดอร์ และคำตอบ)
--   2) ออร์เดอร์ที่สร้างจากใบเสนอ (data.quoteId) ต้องเป็นใบเสนอที่ลูกค้ายืนยันแล้วและยังไม่ถูกแปลงซ้ำ
--      และรายการ VAT และค่าส่งต้องเท่ากับที่ลูกค้าเห็นในใบเสนอ · ลูกค้าต้องเป็นคนเดียวกัน
-- ยังไม่ครบในรอบนี้: ราคาตอนส่งใบเสนอยังไม่ถูกคิดซ้ำกับแคตตาล็อกที่เซิร์ฟเวอร์ (ผู้มีสิทธิ์แชทที่ส่งผ่าน API ตั้งราคาได้ตั้งแต่ต้น)
--   ต้องแยกการคิดราคาโปรโมชันออกจากหน้าร้านก่อน ดู docs/security.md

-- ============================================================================
-- 1) ใบเสนอ: ข้อมูลที่ส่งแล้วแก้ไม่ได้ · ลูกค้า/แชทของใบเสนอเปลี่ยนไม่ได้
-- ============================================================================
create or replace function public.punpang_quotes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    if (old.data->'payload') is distinct from (new.data->'payload') then
      raise exception 'quote terms are locked after they are saved' using errcode = '42501';
    end if;
    if old.customer_id is distinct from new.customer_id or old.chat_id is distinct from new.chat_id then
      raise exception 'quote customer or chat cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.punpang_quotes_guard() from public, anon, authenticated;

drop trigger if exists punpang_quotes_guard on public.punpang_quotes;
create trigger punpang_quotes_guard
  before update on public.punpang_quotes
  for each row execute function public.punpang_quotes_guard();

-- ============================================================================
-- 0) ตรวจออร์เดอร์กับใบเสนอ (ทำงานด้วยสิทธิ์เจ้าของ เพื่อไม่ให้สิทธิ์การมองเห็นของผู้ใช้กั้นการตรวจ) · คืนเฉพาะรหัสผลลัพธ์
-- ============================================================================
create or replace function public.punpang__quote_check(
  p_quote text,
  p_order text,
  p_customer text,
  p_items jsonb,
  p_vat jsonb,
  p_shipping numeric
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  qr record;
begin
  select q.status, q.order_id, q.customer_id, q.data->'payload' as pl into qr
    from public.punpang_quotes q where q.id = p_quote;
  if not found then return 'not_found'; end if;
  if qr.status not in ('customer_ok', 'converting', 'need_phone', 'accepted') then return 'not_ready'; end if;
  if qr.order_id is not null and qr.order_id <> p_order then return 'converted'; end if;
  if qr.customer_id is distinct from p_customer then return 'customer'; end if;
  if (qr.pl->'items') is distinct from p_items then return 'items'; end if;
  if (qr.pl->'vat') is distinct from p_vat then return 'vat'; end if;
  if (case when (qr.pl->>'shippingFee') ~ '^-?[0-9]+(\.[0-9]+)?$' then (qr.pl->>'shippingFee')::numeric else 0 end)
     is distinct from coalesce(p_shipping, 0) then return 'shipping'; end if;
  return 'ok';
end
$$;
revoke all on function public.punpang__quote_check(text, text, text, jsonb, jsonb, numeric) from public, anon;
grant execute on function public.punpang__quote_check(text, text, text, jsonb, jsonb, numeric) to authenticated;

-- ============================================================================
-- 2) ตอนสร้างออร์เดอร์: ฉบับ 20261115060000 + ตรวจออร์เดอร์ที่มาจากใบเสนอ
-- ============================================================================
create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
  qid text;
  qres text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- 1) คะแนนที่ใช้ต้องว่างตอนสร้าง
  if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
    raise exception 'points can only be applied through the server' using errcode = '42501';
  end if;

  -- 2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
  if (new.data->'adjustment'->>'amount') is not null
     and (new.data->'adjustment'->>'amount') !~ '^-?0+(\.0+)?$'
     and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to set a discount or adjustment' using errcode = '42501';
  end if;

  -- 3) คูปองที่ใส่มา ต้องผ่านการตรวจ (ฉบับ 20261115050000)
  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;

  -- 4) ออร์เดอร์จากใบเสนอ: ตรวจผ่านฟังก์ชันของเจ้าของ (ผู้ใช้ทั่วไปมองไม่เห็นใบเสนอที่ไม่มีสิทธิ์แชท) และคืนเฉพาะรหัสผลลัพธ์
  qid := coalesce(new.data->>'quoteId', '');
  if qid <> '' then
    qres := public.punpang__quote_check(
      qid, new.id, new.customer_id, new.data->'items', new.data->'vat',
      case when (new.data->>'shippingFee') ~ '^-?[0-9]+(\.[0-9]+)?$' then (new.data->>'shippingFee')::numeric else 0 end);
    if qres = 'not_found' then raise exception 'quote not found' using errcode = '42501';
    elsif qres = 'not_ready' then raise exception 'quote is not ready to convert' using errcode = '42501';
    elsif qres = 'converted' then raise exception 'quote already converted' using errcode = '42501';
    elsif qres = 'customer' then raise exception 'quote customer mismatch' using errcode = '42501';
    elsif qres = 'items' then raise exception 'order items differ from the quote' using errcode = '42501';
    elsif qres = 'vat' then raise exception 'order VAT differs from the quote' using errcode = '42501';
    elsif qres = 'shipping' then raise exception 'order shipping fee differs from the quote' using errcode = '42501';
    end if;
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;


-- ===== supabase/migrations/20261115090000_punpang_pos_audit.sql =====
-- รอบแก้ 2026-11-15 (ตรวจออร์เดอร์หลังบันทึก · ไม่บล็อกการขาย) · รันหลัง 20261115070000 (ไม่ขึ้นกับ 20261115080000) · รันซ้ำได้ปลอดภัย
-- เดิมบิลหน้าร้านและออร์เดอร์ตรงบันทึกจากเครื่องพร้อมราคา/ส่วนลด ระบบไม่มีที่ตรวจ
-- ตอนนี้เซิร์ฟเวอร์ตรวจออร์เดอร์ที่อัปเดตภายใน 2 วันทุก 10 นาที (Edge Function order-audit) แล้วเก็บผลในตารางนี้
-- ไม่บล็อก: บันทึกและขายได้ตามเดิม · ผลเป็นการเตือนให้ดู ไม่ได้แก้ออร์เดอร์
-- ผลเขียนได้เฉพาะเซิร์ฟเวอร์ · ผู้เห็นออร์เดอร์ทั้งหมดอ่านได้ · คีย์เรียกใช้ร่วมกับ scheduled (Vault scheduled_key)

create table if not exists public.punpang_order_audits (
  order_id text primary key references public.punpang_orders (id) on delete cascade,
  checked_at timestamptz not null default now(),
  ok boolean not null,
  flags jsonb not null default '[]'::jsonb
);

alter table public.punpang_order_audits enable row level security;
revoke all on public.punpang_order_audits from public, anon, authenticated;
grant select on public.punpang_order_audits to authenticated;

drop policy if exists order_audits_read on public.punpang_order_audits;
create policy order_audits_read on public.punpang_order_audits for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

-- คิวออร์เดอร์ที่ยังไม่เคยตรวจ: บิลหน้าร้านทุกใบ + ออร์เดอร์ตรงที่ไม่ใช่ร่างและไม่ได้มาจากใบเสนอ · อัปเดตภายใน 2 วันเท่านั้น (เลี่ยงการเตือนจากราคาเก่า)
-- เรียกได้เฉพาะเซิร์ฟเวอร์ด้วยสิทธิ์ service_role
create or replace function public.punpang_orders_unaudited(p_limit int)
returns table (id text, channel text, status text, fulfillment text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.channel, o.status, o.fulfillment, o.data
    from public.punpang_orders o
   where o.updated_at > now() - interval '2 days'
     and not exists (select 1 from public.punpang_order_audits a where a.order_id = o.id)
     and (
       o.channel = 'pos'
       or (coalesce(o.channel, '') <> 'pos' and coalesce(o.status, '') <> 'draft' and coalesce(o.data->>'quoteId', '') = '')
     )
   order by o.updated_at, o.id
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;
revoke all on function public.punpang_orders_unaudited(int) from public, anon, authenticated;
grant execute on function public.punpang_orders_unaudited(int) to service_role;

-- ตั้งเวลาทุก 10 นาที (ถ้าเคยตั้งชื่อเดิมไว้จะถูกแทนที่) · คีย์เดียวกับ scheduled ที่เก็บใน Vault
do $$ begin perform cron.unschedule('punpang-pos-audit'); exception when others then null; end $$;
do $$ begin perform cron.unschedule('punpang-order-audit'); exception when others then null; end $$;
select cron.schedule(
  'punpang-order-audit',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/order-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1), '')
    ),
    body := '{}'::jsonb
  );
  $$
);


-- ===== supabase/migrations/20261115100000_punpang_order_history.sql =====
-- รอบแก้ 2026-11-15 (ประวัติการแก้ออร์เดอร์และแคตาล็อก · ไม่บล็อกการแก้ไข) · รันหลัง 20261115090000 · รันซ้ำได้ปลอดภัย
-- บันทึกที่ฐานข้อมูล (ทำงานกับทุกการเขียน แม้มาจากเครื่องที่แก้ข้อมูลเองได้):
--   1) punpang_order_changes: ทุกครั้งที่รายการ/ส่วนลด/ค่าส่ง/VAT ของออร์เดอร์เปลี่ยน — ใครแก้ เมื่อไร รายการใดหายไป/เพิ่ม/เปลี่ยน
--   2) punpang_catalog_history: ทุกครั้งที่สินค้าหน้าร้านหรือการตั้งค่าราคาเปลี่ยน — ค่าก่อนและหลัง ใครแก้ เมื่อไร
-- ตัวตรวจใช้ประวัติข้อ 2 เพื่อเทียบออร์เดอร์กับราคาที่ใช้ได้ ณ เวลาที่สร้าง (ไม่เตือนจากการเปลี่ยนราคาภายหลัง)
-- และตรวจซ้ำเมื่อออร์เดอร์ถูกแก้หลังตรวจครั้งก่อน (ทั้งสองตารางอ่านได้เฉพาะสิทธิ์ที่เห็นออร์เดอร์/แก้ตั้งค่า · เขียนได้เฉพาะเซิร์ฟเวอร์และ trigger)

-- ============================================================================
-- 1) ตารางบันทึก
-- ============================================================================
create table if not exists public.punpang_order_changes (
  id bigint generated always as identity primary key,
  order_id text not null references public.punpang_orders (id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by uuid,
  summary jsonb not null
);
create index if not exists punpang_order_changes_order_idx on public.punpang_order_changes (order_id, changed_at);

create table if not exists public.punpang_catalog_history (
  id bigint generated always as identity primary key,
  source text not null check (source in ('item', 'config')),
  key text not null,
  old_data jsonb,
  new_data jsonb,
  changed_at timestamptz not null default now(),
  changed_by uuid
);
create index if not exists punpang_catalog_history_time_idx on public.punpang_catalog_history (changed_at);

alter table public.punpang_order_changes enable row level security;
alter table public.punpang_catalog_history enable row level security;
revoke all on public.punpang_order_changes from public, anon, authenticated;
revoke all on public.punpang_catalog_history from public, anon, authenticated;
grant select on public.punpang_order_changes to authenticated;
grant select on public.punpang_catalog_history to authenticated;

drop policy if exists order_changes_read on public.punpang_order_changes;
create policy order_changes_read on public.punpang_order_changes for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

drop policy if exists catalog_history_read on public.punpang_catalog_history;
create policy catalog_history_read on public.punpang_catalog_history for select to authenticated
  using (public.punpang_has_perm('manage'));

-- ============================================================================
-- 2) บันทึกการแก้รายการ/การเงินของออร์เดอร์ (AFTER UPDATE · ไม่บล็อก)
-- ============================================================================
create or replace function public.punpang_log_order_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed jsonb;
  added jsonb;
  changed jsonb;
  money jsonb := '{}'::jsonb;
  f text;
begin
  if old.data is not distinct from new.data then
    return null;
  end if;

  -- รายการเทียบกันด้วยรหัสรายการ
  select
    coalesce(jsonb_agg(jsonb_build_object('id', o.v->>'id', 'name', o.v->>'name', 'qty', o.v->'qty', 'unitPrice', o.v->'unitPrice'))
      filter (where n.v is null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', n.v->>'id', 'name', n.v->>'name', 'qty', n.v->'qty', 'unitPrice', n.v->'unitPrice'))
      filter (where o.v is null), '[]'::jsonb),
    coalesce(jsonb_agg(jsonb_build_object('id', o.v->>'id',
        'before', jsonb_build_object('qty', o.v->'qty', 'unitPrice', o.v->'unitPrice', 'discounts', o.v->'discounts'),
        'after', jsonb_build_object('qty', n.v->'qty', 'unitPrice', n.v->'unitPrice', 'discounts', n.v->'discounts')))
      filter (where o.v is not null and n.v is not null
        and (o.v->'qty' is distinct from n.v->'qty'
          or o.v->'unitPrice' is distinct from n.v->'unitPrice'
          or o.v->'discounts' is distinct from n.v->'discounts')), '[]'::jsonb)
  into removed, added, changed
  from jsonb_array_elements(coalesce(old.data->'items', '[]'::jsonb)) as o(v)
  full join jsonb_array_elements(coalesce(new.data->'items', '[]'::jsonb)) as n(v)
    on (o.v->>'id') = (n.v->>'id');

  foreach f in array array['adjustment', 'shippingFee', 'vat', 'couponsUsed', 'pointsUsed', 'distanceKm', 'feeManual', 'pickupAt'] loop
    if old.data->f is distinct from new.data->f then
      money := money || jsonb_build_object(f, jsonb_build_object('before', old.data->f, 'after', new.data->f));
    end if;
  end loop;

  if removed = '[]'::jsonb and added = '[]'::jsonb and changed = '[]'::jsonb and money = '{}'::jsonb then
    return null;
  end if;

  insert into public.punpang_order_changes (order_id, changed_by, summary)
  values (new.id, auth.uid(), jsonb_build_object(
    'removed', removed,
    'added', added,
    'changed', changed,
    'money', money,
    'itemsBefore', jsonb_array_length(coalesce(old.data->'items', '[]'::jsonb)),
    'itemsAfter', jsonb_array_length(coalesce(new.data->'items', '[]'::jsonb))));
  return null;
end $$;
revoke all on function public.punpang_log_order_changes() from public, anon, authenticated;

drop trigger if exists punpang_orders_log_changes on public.punpang_orders;
create trigger punpang_orders_log_changes after update on public.punpang_orders
  for each row execute function public.punpang_log_order_changes();

-- ============================================================================
-- 3) ประวัติแคตาล็อก: สินค้าหน้าร้าน และการตั้งค่าที่ใช้คิดราคา (AFTER · ไม่บล็อก)
-- ============================================================================
create or replace function public.punpang_log_catalog_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  rid text;
  rkind text;
  rcoll text;
begin
  if tg_table_name = 'punpang_items' then
    if tg_op = 'DELETE' then rid := old.id; rkind := old.kind; else rid := new.id; rkind := new.kind; end if;
    if rkind <> 'retail' then return null; end if;
    if tg_op = 'UPDATE' and old.price is not distinct from new.price and old.active is not distinct from new.active
       and old.name is not distinct from new.name and old.data is not distinct from new.data then
      return null;
    end if;
    insert into public.punpang_catalog_history (source, key, old_data, new_data, changed_by)
    values ('item', rid,
      case when tg_op = 'INSERT' then null else jsonb_build_object('id', old.id, 'name', old.name, 'price', old.price, 'active', old.active, 'data', old.data) end,
      case when tg_op = 'DELETE' then null else jsonb_build_object('id', new.id, 'name', new.name, 'price', new.price, 'active', new.active, 'data', new.data) end,
      auth.uid());
  else
    if tg_op = 'DELETE' then rid := old.id; rcoll := old.collection; else rid := new.id; rcoll := new.collection; end if;
    if rcoll <> 'config' or rid not in ('shop', 'priceLists', 'bundles', 'optionGroups', 'posDiscounts', 'posBundles', 'posDeals', 'posModifiers') then
      return null;
    end if;
    if tg_op = 'UPDATE' and old.data is not distinct from new.data then return null; end if;
    insert into public.punpang_catalog_history (source, key, old_data, new_data, changed_by)
    values ('config', rid,
      case when tg_op = 'INSERT' then null else old.data->'v' end,
      case when tg_op = 'DELETE' then null else new.data->'v' end,
      auth.uid());
  end if;
  return null;
end $$;
revoke all on function public.punpang_log_catalog_history() from public, anon, authenticated;

drop trigger if exists punpang_items_catalog_history on public.punpang_items;
create trigger punpang_items_catalog_history after insert or update or delete on public.punpang_items
  for each row execute function public.punpang_log_catalog_history();

drop trigger if exists punpang_kv_catalog_history on public.punpang_kv;
create trigger punpang_kv_catalog_history after insert or update or delete on public.punpang_kv
  for each row execute function public.punpang_log_catalog_history();

-- ============================================================================
-- 4) คิวตรวจ: ตรวจซ้ำเมื่อออร์เดอร์ถูกแก้หลังการตรวจครั้งก่อน (แทนที่ฉบับ 20261115090000)
-- ============================================================================
create or replace function public.punpang_orders_unaudited(p_limit int)
returns table (id text, channel text, status text, fulfillment text, data jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select o.id, o.channel, o.status, o.fulfillment, o.data
    from public.punpang_orders o
   where o.updated_at > now() - interval '2 days'
     and not exists (select 1 from public.punpang_order_audits a where a.order_id = o.id and a.checked_at >= o.updated_at)
     and (
       o.channel = 'pos'
       or (coalesce(o.channel, '') <> 'pos' and coalesce(o.status, '') <> 'draft' and coalesce(o.data->>'quoteId', '') = '')
     )
   order by o.updated_at, o.id
   limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;
revoke all on function public.punpang_orders_unaudited(int) from public, anon, authenticated;
grant execute on function public.punpang_orders_unaudited(int) to service_role;


-- ===== supabase/migrations/20261115110000_punpang_order_gate.sql =====
-- รอบแก้ 2026-11-15 (ด่านตรวจออร์เดอร์เสี่ยงก่อนยืนยันชำระ/ส่งมอบ · ตัวเลือก B) · รันหลัง 20261115100000 และก่อน deploy order-audit ที่ตั้งค่า hold · รันซ้ำได้ปลอดภัย
-- ออร์เดอร์ตรง (ไม่ใช่บิลหน้าร้าน) ที่ผลตรวจล่าสุดมีรายการ high (hold = true) เปลี่ยนสถานะเป็น payment_confirmed / delivered ไม่ได้
-- จนกว่าผู้จัดการ (สิทธิ์ manage) จะตรวจ "หลัง" ผลตรวจล่าสุด (reviewed_at >= checked_at)
-- ไม่บังคับกับคำขอที่ไม่มี JWT (service role / Edge Function) · แอปตรวจล่วงหน้าก่อนเปลี่ยนสถานะ เพื่อไม่ให้การซิงก์ค้างเมื่อถูกปฏิเสธ · ดู docs/security.md

-- ============================================================================
-- 1) ธงบล็อกในผลตรวจ (order-audit เป็นผู้ตั้งจากรายการ high)
-- ============================================================================
alter table public.punpang_order_audits add column if not exists hold boolean not null default false;

-- ============================================================================
-- 2) บันทึกการตรวจโดยผู้จัดการ (เขียนได้ผ่าน RPC punpang_review_order เท่านั้น)
-- ============================================================================
create table if not exists public.punpang_order_reviews (
  id bigint generated always as identity primary key,
  order_id text not null references public.punpang_orders (id) on delete cascade,
  reviewed_at timestamptz not null default now(),
  reviewed_by uuid,
  note text not null default ''
);
create index if not exists punpang_order_reviews_order_idx on public.punpang_order_reviews (order_id, reviewed_at);

alter table public.punpang_order_reviews enable row level security;
revoke all on public.punpang_order_reviews from public, anon, authenticated;
grant select on public.punpang_order_reviews to authenticated;

drop policy if exists order_reviews_read on public.punpang_order_reviews;
create policy order_reviews_read on public.punpang_order_reviews for select to authenticated
  using (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));

-- ============================================================================
-- 3) สถานะด่านของออร์เดอร์ (แอปใช้ตรวจก่อนยืนยันชำระ/ส่งมอบ) · คืน null เมื่อไม่มีผลตรวจหรือไม่มีสิทธิ์ดู
-- ============================================================================
create or replace function public.punpang_order_gate(p_order text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage')
                or public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('deliverPickup')
                or public.punpang_has_perm('deliverShipping')
    then (
      select jsonb_build_object(
        'hold', a.hold,
        'checkedAt', a.checked_at,
        'flags', coalesce(a.flags, '[]'::jsonb),
        'reviewedAt', (select max(r.reviewed_at) from public.punpang_order_reviews r
                        where r.order_id = a.order_id and r.reviewed_at >= a.checked_at))
        from public.punpang_order_audits a
       where a.order_id = p_order)
  end;
$$;
revoke all on function public.punpang_order_gate(text) from public, anon;
grant execute on function public.punpang_order_gate(text) to authenticated;

-- ============================================================================
-- 4) ผู้จัดการตรวจออร์เดอร์ที่มีรายการเสี่ยง (ไม่แก้ตัวออร์เดอร์)
-- ============================================================================
create or replace function public.punpang_review_order(p_order text, p_note text default '')
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  ts timestamptz := now();
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'ต้องเป็นผู้จัดการจึงตรวจได้' using errcode = '42501';
  end if;
  if not exists (select 1 from public.punpang_order_audits a where a.order_id = p_order and a.hold) then
    raise exception 'ไม่มีรายการเสี่ยงที่ต้องตรวจ' using errcode = 'P0002';
  end if;
  insert into public.punpang_order_reviews (order_id, reviewed_at, reviewed_by, note)
  values (p_order, ts, auth.uid(), left(coalesce(p_note, ''), 500));
  return ts;
end $$;
revoke all on function public.punpang_review_order(text, text) from public, anon;
grant execute on function public.punpang_review_order(text, text) to authenticated;

-- ============================================================================
-- 5) ด่านที่ฐานข้อมูล (BEFORE UPDATE): เฉพาะคำขอที่มีผู้ใช้ล็อกอิน · บิลหน้าร้านไม่เข้าเงื่อนไข
-- ============================================================================
create or replace function public.punpang_orders_review_gate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  a_hold boolean;
  a_at timestamptz;
begin
  if (select auth.uid()) is null then return new; end if;
  if new.status is not distinct from old.status then return new; end if;
  if coalesce(new.status, '') not in ('payment_confirmed', 'delivered') then return new; end if;
  if coalesce(new.channel, '') = 'pos' then return new; end if;

  select a.hold, a.checked_at into a_hold, a_at from public.punpang_order_audits a where a.order_id = new.id;
  if not coalesce(a_hold, false) then return new; end if;
  if exists (select 1 from public.punpang_order_reviews r where r.order_id = new.id and r.reviewed_at >= a_at) then return new; end if;

  raise exception 'ออร์เดอร์นี้มีรายการเสี่ยง ต้องให้ผู้จัดการตรวจก่อน' using errcode = 'P0001', hint = 'ORDER_REVIEW_REQUIRED';
end $$;
revoke all on function public.punpang_orders_review_gate() from public, anon, authenticated;

drop trigger if exists punpang_orders_review_gate on public.punpang_orders;
create trigger punpang_orders_review_gate before update on public.punpang_orders
  for each row execute function public.punpang_orders_review_gate();

commit;
