-- สิทธิวันเกิดสมาชิก (ต่อจาก 20261123120000)
-- 1) ลูกค้ากรอกเดือนเกิด + ยินยอมแยกต่างหาก (data.birth = {month, consentAt, setAt})
--    เดือนที่กรอกใช้ได้หลังกรอกมาแล้วอย่างน้อย 30 วัน · เปลี่ยนเดือนเมื่อไรเริ่มนับ 30 วันใหม่
-- 2) ตัวคูณเดือนเกิด LV2 x4 · LV3 x6 · LV4 x10 ใช้เฉพาะสถานะ Active และใช้ค่าที่สูงกว่าตัวคูณระดับปกติ
-- 3) คูปอง LV4 ส่วนลด 30 บาท ออกเมื่อยอดซื้อในเดือนเกิดครบ 300 บาท (ก่อน VAT) · ปีละ 1 ใบ · หมดอายุสิ้นเดือนเกิด
-- ส่วนลด 5% / 10% หมวดเค้ก และหน้าเว็บ/POS อยู่นอกไฟล์นี้ (ทำในงานแอป)

-- ---------- 1) ลูกค้า: บันทึกเดือนเกิด + ยินยอม ----------
create or replace function public.punpang_cust_set_birth(p_customer text, p_month int, p_consent boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record;
  cur jsonb;
  now_iso text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  b jsonb;
begin
  if p_month is null or p_month not between 1 and 12 then return jsonb_build_object('ok', false, 'error', 'bad_month'); end if;
  if not coalesce(p_consent, false) then return jsonb_build_object('ok', false, 'error', 'no_consent'); end if;
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  cur := c.data->'birth';
  if jsonb_typeof(cur) = 'object' and (cur->>'month')::int = p_month and cur->>'setAt' is not null then
    b := cur;                                      -- เดือนเดิม: คงวันที่เริ่มนับ 30 วัน
  else
    b := jsonb_build_object('month', p_month, 'setAt', now_iso,
           'consentAt', coalesce(cur->>'consentAt', now_iso));
  end if;
  update public.punpang_customers
     set data = jsonb_set(c.data, '{birth}', b), updated_at = now()
   where id = p_customer;
  return jsonb_build_object('ok', true, 'month', p_month, 'eligibleAt', to_char(((b->>'setAt')::timestamptz + interval '30 days') at time zone 'utc', 'YYYY-MM-DD'));
end $$;
revoke all on function public.punpang_cust_set_birth(text, int, boolean) from public, anon, authenticated;
grant execute on function public.punpang_cust_set_birth(text, int, boolean) to service_role;

-- ---------- 2) ตัวคูณระดับ (เพิ่มค่า birthOk และ birthMult ใน fold) ----------
-- ประมวลผลทีละวัน (วันไทย): วันครบกำหนดลดขั้นที่มียอดถึงเกณฑ์ = ต่ออายุ (ไม่ลด) · ไม่ถึง = ลด 1 ขั้นก่อนนับยอดของวันนั้น · ลดได้ถึง LV1
-- คืน jsonb: level, levelName, mult, cum (ภายใน ห้ามส่งให้ลูกค้า), nextMin, status (none/active/paused/lapsed), renewAt, delta, golden, dayTot, dayMax, preMult (ตัวคูณก่อนลดขั้นของวันนี้ ถ้ามี), downgradeAt
create or replace function public.punpang__member_fold(p_customer text, p_now timestamptz)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  lv jsonb := cfg->'levels';
  nlv int := jsonb_array_length(cfg->'levels');
  dg int := (cfg->>'downgradeDays')::int;
  inact int := (cfg->>'inactiveDays')::int;
  gold int := (cfg->>'goldenDays')::int;
  today date := (p_now at time zone 'Asia/Bangkok')::date;
  lvl int := 1;
  cum numeric := 0;
  renew_at date := null;
  down_at date := null;
  anc date := null;
  t_tot numeric := 0;
  t_max numeric := 0;
  pre_lvl int := null; -- ระดับก่อนลดขั้นของวันครบกำหนดวันนี้ (บิลต่ออายุของวันนั้นใช้ระดับนี้)
  d record;
  st text;
  delta int := null;
  bd jsonb;
  birth_ok boolean := false;
  bmult numeric := null;
begin
  -- เดือนเกิด: ตรงกับเดือนปัจจุบัน (เวลาไทย) และกรอกมาแล้วอย่างน้อย 30 วัน และยินยอมแล้ว
  select c.data->'birth' into bd from public.punpang_customers c where c.id = p_customer;
  if jsonb_typeof(bd) = 'object' and bd->>'setAt' is not null and bd->>'consentAt' is not null
     and (bd->>'month')::int = extract(month from today)::int
     and (bd->>'setAt')::timestamptz + interval '30 days' <= p_now then
    birth_ok := true;
  end if;
  -- ยอดรวมของแต่ละวัน (ก่อน VAT) และเกณฑ์สูงสุดของบิลในวันนั้น
  for d in
    select e.day as dy, sum(e.amount) as tot, max(e.renew_min) as mx
      from public.punpang_member_events e
     where e.customer_id = p_customer and e.kind = 'spend' and e.at <= p_now
       and not exists (select 1 from public.punpang_member_events u
                        where u.customer_id = e.customer_id and u.order_id = e.order_id
                          and u.kind = 'undo' and u.id > e.id and u.at <= p_now)
     group by e.day
     order by e.day
  loop
    if renew_at is null then renew_at := d.dy; end if; -- ยังไม่เคยต่ออายุ: นับ 90 วันจากวันซื้อครั้งแรก
    anc := greatest(renew_at, down_at);
    while lvl > 1 and anc + dg < d.dy loop -- ลดขั้นที่ครบกำหนดก่อนวันนี้ (วันนั้นไม่มียอด จึงไม่มีการต่ออายุ)
      lvl := lvl - 1;
      cum := (lv->(lvl - 1)->>'min')::numeric;
      down_at := anc + dg;
      anc := down_at;
    end loop;
    -- วันที่ครบกำหนดพอดี: ยอดวันนั้นถึงเกณฑ์ = ต่ออายุ (ไม่ลด) · ไม่ถึง = ลด 1 ขั้นก่อนนับยอดของวันนั้น
    if lvl > 1 and anc + dg = d.dy and d.tot < d.mx then
      if d.dy = today and pre_lvl is null then pre_lvl := lvl; end if;
      lvl := lvl - 1;
      cum := (lv->(lvl - 1)->>'min')::numeric;
      down_at := d.dy;
      anc := down_at;
    end if;
    cum := cum + d.tot;
    while lvl < nlv and cum >= (lv->lvl->>'min')::numeric loop
      lvl := lvl + 1;
    end loop;
    if d.tot >= d.mx then renew_at := d.dy; end if; -- ต่ออายุได้ครั้งเดียวต่อวัน
    if d.dy = today then t_tot := d.tot; t_max := d.mx; end if;
  end loop;

  if renew_at is not null then
    anc := greatest(renew_at, down_at);
    while lvl > 1 and anc + dg <= today loop -- ลดขั้นแบบคำนวณถึงวันนี้
      if anc + dg = today and pre_lvl is null then pre_lvl := lvl; end if;
      lvl := lvl - 1;
      cum := (lv->(lvl - 1)->>'min')::numeric;
      down_at := anc + dg;
      anc := down_at;
    end loop;
    delta := today - renew_at;
    st := case when delta <= inact then 'active' when delta < dg then 'paused' else 'lapsed' end;
  else
    st := 'none';
  end if;

  bmult := case when birth_ok then case lvl when 2 then 4 when 3 then 6 when 4 then 10 else null end end;
  return jsonb_build_object(
    'birthOk', birth_ok,
    'birthMult', bmult,
    'level', lvl,
    'levelName', lv->(lvl - 1)->>'name',
    'mult', (lv->(lvl - 1)->>'mult')::numeric,
    'cum', cum,
    'nextMin', case when lvl < nlv then (lv->lvl->>'min')::numeric end,
    'status', st,
    'renewAt', renew_at,
    'delta', delta,
    'golden', coalesce(st = 'paused' and delta between inact + 1 and inact + gold, false),
    'dayTot', t_tot,
    'dayMax', t_max,
    'preMult', (lv->(coalesce(pre_lvl, lvl) - 1)->>'mult')::numeric,
    'downgradeAt', case when lvl > 1 and renew_at is not null then anc + dg end
  );
end $$;
revoke all on function public.punpang__member_fold(text, timestamptz) from public, anon, authenticated;

-- ---------- 3) ตัวคูณของบิล: เดือนเกิด (Active เท่านั้น) ใช้ค่าที่สูงกว่า ----------
create or replace function public.punpang__member_bill_mult(st jsonb, amount numeric, rmin numeric, cfg jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when st->>'status' = 'active' then greatest((st->>'mult')::numeric, coalesce((st->>'birthMult')::numeric, 0))
    when coalesce((st->>'dayTot')::numeric, 0) + amount >= greatest(coalesce((st->>'dayMax')::numeric, 0), rmin)
         and (coalesce((st->>'golden')::boolean, false) or amount >= (cfg->>'bigBill')::numeric)
      then coalesce((st->>'preMult')::numeric, (st->>'mult')::numeric)
    else 1
  end
$$;
revoke all on function public.punpang__member_bill_mult(jsonb, numeric, numeric, jsonb) from public, anon, authenticated;

-- ---------- 4) คูปองเดือนเกิด LV4 (ปีละ 1 ใบ) ----------
create or replace function public.punpang__member_birth_coupon(p_customer text, p_now timestamptz)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  today date := (p_now at time zone 'Asia/Bangkok')::date;
  m_start date := date_trunc('month', today)::date;
  m_end date := (date_trunc('month', today) + interval '1 month' - interval '1 day')::date;
  top int := jsonb_array_length(cfg->'levels');
  st jsonb;
  spent numeric;
  cid text := 'bday-' || to_char(today, 'YYYY') || '-' || p_customer;
begin
  if cfg->>'mode' <> 'live' then return 0; end if;
  st := public.punpang__member_fold(p_customer, p_now);
  if st->>'status' <> 'active' or (st->>'level')::int <> top or not coalesce((st->>'birthOk')::boolean, false) then return 0; end if;
  select coalesce(sum(e.amount), 0) into spent from public.punpang_member_events e
   where e.customer_id = p_customer and e.kind = 'spend' and e.day >= m_start and e.day <= today
     and not exists (select 1 from public.punpang_member_events u
                      where u.order_id = e.order_id and u.customer_id = e.customer_id and u.kind = 'undo' and u.id > e.id);
  if spent < 300 then return 0; end if;
  insert into public.punpang_records (collection, id, data)
    values ('coupons', cid, jsonb_build_object(
      'id', cid, 'customerId', p_customer, 'type', 'discount', 'mode', 'fixed',
      'name', 'คูปองวันเกิดสมาชิก LV4 ส่วนลด 30 บาท', 'amount', 30, 'minSpend', 0, 'pct', 0, 'cap', 0,
      'productId', '', 'productName', '', 'status', 'pending', 'source', 'member_birthday',
      'expiresAt', to_char(m_end, 'YYYY-MM-DD'),
      'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    on conflict (collection, id) do nothing;
  return case when found then 1 else 0 end;
end $$;
revoke all on function public.punpang__member_birth_coupon(text, timestamptz) from public, anon, authenticated;

-- ทุกครั้งที่มียอดซื้อใหม่: ตรวจโบนัสเดิม + คูปองเดือนเกิด
create or replace function public.punpang__member_bonus_on_spend()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.punpang__member_bonus_sync(new.customer_id);
  perform public.punpang__member_birth_coupon(new.customer_id, now());
  return null;
end $$;
revoke all on function public.punpang__member_bonus_on_spend() from public, anon, authenticated;

-- สำเนาโหมดทดสอบ (punpang_test) ให้ตรงกับฟังก์ชันใหม่ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
