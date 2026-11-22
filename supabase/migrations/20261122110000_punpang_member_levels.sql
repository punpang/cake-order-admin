-- ระดับสมาชิก เฟส 1 (ฐานข้อมูล) · รอบ 2026-11-22 · โหมดเริ่มต้น = off (ไม่บันทึกและไม่คูณ) · ยังไม่เปิดใช้
-- ตั้งค่าอยู่ที่ punpang_kv config/memberLevels (เปิดทดลอง/ใช้จริงเมื่อผู้ใช้อนุมัติ)
-- ไฟล์นี้: (0) ให้โหมดทดสอบรู้จักตารางใหม่ (1) ตารางเหตุการณ์ยอด (2) ตั้งค่า/คำนวณระดับ (3) ทริกเกอร์ถอนยอด/ย้ายผู้ซื้อ/ลบลูกค้า (4) RPC ตัวคูณและบัตรระดับ
-- ยอดสมาชิกใหม่ถูกบันทึกโดย punpang_award_order (migration 20261122110100) เท่านั้น

-- ---------- 0) โหมดทดสอบ: ตารางเหตุการณ์ยอดสมาชิกเป็นตารางธุรกิจ (แยกสำเนา) · เพิ่มชื่อในรายการ iso ของฟังก์ชันปัจจุบัน ----------
-- (ไม่คัดลอกฟังก์ชันทั้งชุด: migration อื่นแก้ฟังก์ชันนี้ภายหลัง เช่น punpang_sync_review, punpang_error_log)
do $$
declare d text; n text; pat text := '''punpang_sync_review''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_member_events''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'member levels: รายการตารางธุรกิจใน punpang_test_sync ไม่ชัดเจน';
  end if;
  n := replace(d, pat, '''punpang_sync_review'', ''punpang_member_events''];');
  execute n;
end $$;

-- ---------- 1) ตารางเหตุการณ์ยอดสมาชิก (เพิ่มอย่างเดียว · ไม่มีนโยบาย RLS = เข้าได้ผ่านฟังก์ชันของระบบเท่านั้น) ----------
-- kind: spend = ยอดที่ให้สิทธิ์ (ตอนส่งมอบ) · undo = ถอนยอดของรายการ spend ก่อนหน้า (ย้อนสถานะ/ยกเลิก/ย้ายผู้ซื้อ)
-- day = วันที่ตามเขตเวลาไทย (ใช้ตัดสินการต่ออายุรายวันและการลดขั้น) · renew_min = เกณฑ์ต่ออายุของบิลนั้น (ก่อน VAT)
create table public.punpang_member_events (
  id bigint generated always as identity primary key,
  customer_id text not null references public.punpang_customers (id),
  order_id text not null,
  kind text not null check (kind in ('spend', 'undo')),
  at timestamptz not null default now(),
  day date not null,
  amount numeric(12, 2) not null check (amount >= 0),
  renew_min numeric(12, 2) check (renew_min is null or renew_min >= 0),
  mult numeric(6, 2) check (mult is null or mult >= 1),
  check ((kind = 'spend') = (renew_min is not null))
);
create index punpang_member_events_cust_idx on public.punpang_member_events (customer_id, at, id);
create index punpang_member_events_order_idx on public.punpang_member_events (order_id);
alter table public.punpang_member_events enable row level security;
revoke all on public.punpang_member_events from public, anon, authenticated;

-- แก้ไม่ได้ · ลบได้เฉพาะตอนลบข้อมูลลูกค้า (PDPA) ซึ่งตั้งค่าธงเฉพาะธุรกรรมนั้นก่อนลบ
create or replace function public.punpang__member_events_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and coalesce(current_setting('punpang.member_purge', true), '') = 'on' then
    return old;
  end if;
  raise exception 'บันทึกยอดสมาชิกแก้ไขหรือลบไม่ได้' using errcode = '42501';
end $$;
revoke all on function public.punpang__member_events_guard() from public, anon, authenticated;
drop trigger if exists punpang_member_events_guard on public.punpang_member_events;
create trigger punpang_member_events_guard before update or delete on public.punpang_member_events
  for each row execute function public.punpang__member_events_guard();

-- ---------- 2) ตั้งค่า (punpang_kv config/memberLevels) · ค่าไม่ครบหรือไม่ถูกต้อง = ปิดระบบ (ไม่คูณและไม่บันทึก) ----------
create or replace function public.punpang__member_cfg()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := jsonb_build_object(
    'mode', 'off',
    'levels', '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":1000,"mult":3},{"name":"LV3","min":3000,"mult":5},{"name":"LV4","min":7000,"mult":10}]'::jsonb,
    'renewGross', 150, 'inactiveDays', 90, 'goldenDays', 14, 'downgradeDays', 365, 'bigBill', 500);
  kv jsonb;
  lv jsonb;
begin
  select k.data->'v' into kv from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels';
  if jsonb_typeof(kv) = 'object' then c := c || kv; end if;
  -- ตรวจชนิดข้อมูลก่อนแปลงเป็นตัวเลขทุกครั้ง
  if coalesce(c->>'mode', '') not in ('off', 'shadow', 'live')
     or jsonb_typeof(c->'levels') is distinct from 'array'
     or jsonb_typeof(c->'renewGross') is distinct from 'number' or jsonb_typeof(c->'inactiveDays') is distinct from 'number'
     or jsonb_typeof(c->'goldenDays') is distinct from 'number' or jsonb_typeof(c->'downgradeDays') is distinct from 'number'
     or jsonb_typeof(c->'bigBill') is distinct from 'number' then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  lv := c->'levels';
  if jsonb_array_length(lv) not between 1 and 10 then return jsonb_set(c, '{mode}', '"off"'::jsonb); end if;
  if exists (select 1 from jsonb_array_elements(lv) e
              where not (case when jsonb_typeof(e) = 'object' and jsonb_typeof(e->'min') = 'number' and jsonb_typeof(e->'mult') = 'number'
                              then (e->>'min')::numeric >= 0 and (e->>'mult')::numeric >= 1
                              else false end)) then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  -- ขั้นแรกต้องเริ่มที่ 0 และเกณฑ์ยอดสะสมต้องเพิ่มขึ้นทุกขั้น
  if (lv->0->>'min')::numeric <> 0 or exists (
       select 1 from (select (e->>'min')::numeric as m, lag((e->>'min')::numeric) over (order by o) as pm
                        from jsonb_array_elements(lv) with ordinality x(e, o)) s
        where s.pm is not null and s.m <= s.pm) then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  -- ลดขั้นต้องหลังช่วงใช้งาน (ค่ามากกว่า inactiveDays ซึ่งต้องอย่างน้อย 1 อยู่แล้ว) มิฉะนั้นสถานะซ้อนกัน
  if (c->>'renewGross')::numeric <= 0 or (c->>'inactiveDays')::numeric < 1 or (c->>'goldenDays')::numeric < 0
     or (c->>'downgradeDays')::numeric <= (c->>'inactiveDays')::numeric or (c->>'bigBill')::numeric < 0 then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  return c;
end $$;
revoke all on function public.punpang__member_cfg() from public, anon, authenticated;

-- เกณฑ์ต่ออายุของบิลหนึ่ง (ก่อน VAT): ยอดรวม 150 บาทรวม VAT → floor(150 × 100 / (100 + อัตรา VAT)) · ไม่มี VAT = 150
create or replace function public.punpang__member_renew_min(d jsonb, cfg jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select case when x.r > 0 then floor((cfg->>'renewGross')::numeric * 100 / (100 + x.r))
              else (cfg->>'renewGross')::numeric end
    from (select case when (d->'vat'->>'rate') ~ '^[0-9]+(\.[0-9]+)?$' then (d->'vat'->>'rate')::numeric else 0 end as r) x
$$;
revoke all on function public.punpang__member_renew_min(jsonb, jsonb) from public, anon, authenticated;

-- ---------- 3) คำนวณสถานะจากเหตุการณ์ที่ยังนับอยู่ (ไม่เก็บผลลัพธ์ · คำนวณใหม่ทุกครั้ง) ----------
-- รายการ spend ที่ยังนับ = ไม่มี undo ของออร์เดอร์เดียวกัน (ลูกค้าเดียวกัน) ที่ตามหลังมา
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
begin
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

  return jsonb_build_object(
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

-- ตัวคูณของบิลใหม่ (amount = ยอดก่อน VAT, rmin = เกณฑ์ต่ออายุของบิล) ตามสถานะก่อนบิลนั้น
--  · Active → ตัวคูณของระดับ · ไม่ Active → ได้ตัวคูณเต็มเฉพาะบิลที่ทำให้ต่ออายุวันนั้น และ (อยู่วันทอง หรือ บิลถึง bigBill) · ใช้ระดับก่อนลดขั้นของวันนั้น (preMult)
--  · นอกนั้น = 1 (บิลถัดไปที่ Active แล้วจึงได้เต็ม)
create or replace function public.punpang__member_bill_mult(st jsonb, amount numeric, rmin numeric, cfg jsonb)
returns numeric language sql immutable set search_path = '' as $$
  select case
    when st->>'status' = 'active' then (st->>'mult')::numeric
    when coalesce((st->>'dayTot')::numeric, 0) + amount >= greatest(coalesce((st->>'dayMax')::numeric, 0), rmin)
         and (coalesce((st->>'golden')::boolean, false) or amount >= (cfg->>'bigBill')::numeric)
      then coalesce((st->>'preMult')::numeric, (st->>'mult')::numeric)
    else 1
  end
$$;
revoke all on function public.punpang__member_bill_mult(jsonb, numeric, numeric, jsonb) from public, anon, authenticated;

-- ---------- 4) ทริกเกอร์: ถอนยอด (ย้อนสถานะ/ยกเลิก) และย้ายผู้ซื้อ · ไม่สร้างยอดใหม่ (ยอดใหม่มาจาก punpang_award_order เท่านั้น) ----------
create or replace function public.punpang__member_order_reconcile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sp public.punpang_member_events%rowtype;
  live boolean := jsonb_typeof(new.data->'loyalty') = 'object';
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select e.* into sp from public.punpang_member_events e
   where e.order_id = new.id and e.kind = 'spend'
     and not exists (select 1 from public.punpang_member_events u
                      where u.order_id = e.order_id and u.customer_id = e.customer_id and u.kind = 'undo' and u.id > e.id)
   order by e.id desc limit 1;
  if sp.id is null then return null; end if;                                           -- ไม่มีรายการที่นับอยู่
  if live and new.customer_id is not distinct from sp.customer_id then return null; end if; -- ยังเป็นรายการเดิม
  insert into public.punpang_member_events (customer_id, order_id, kind, day, amount, renew_min, mult)
    values (sp.customer_id, sp.order_id, 'undo', today, sp.amount, null, null);
  if live and coalesce(new.customer_id, '') <> '' then                                 -- ย้ายผู้ซื้อ: ยอด/ตัวคูณเดิมไปลูกค้าใหม่ วันที่ย้าย
    insert into public.punpang_member_events (customer_id, order_id, kind, day, amount, renew_min, mult)
      values (new.customer_id, sp.order_id, 'spend', today, sp.amount, sp.renew_min, sp.mult);
  end if;
  return null;
end $$;
revoke all on function public.punpang__member_order_reconcile() from public, anon, authenticated;
drop trigger if exists punpang_orders_member_reconcile on public.punpang_orders;
create trigger punpang_orders_member_reconcile after update of data, customer_id on public.punpang_orders
  for each row when (old.data->'loyalty' is distinct from new.data->'loyalty' or old.customer_id is distinct from new.customer_id)
  execute function public.punpang__member_order_reconcile();

-- ลบข้อมูลลูกค้า (PDPA): ลบยอดสมาชิกของลูกค้าคนนั้นในธุรกรรมเดียวกัน
create or replace function public.punpang__member_customer_purge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('punpang.member_purge', 'on', true);
  delete from public.punpang_member_events where customer_id = new.id;
  perform set_config('punpang.member_purge', 'off', true);
  return null;
end $$;
revoke all on function public.punpang__member_customer_purge() from public, anon, authenticated;
drop trigger if exists punpang_customers_member_purge on public.punpang_customers;
create trigger punpang_customers_member_purge after update of data on public.punpang_customers
  for each row when (coalesce((new.data->>'deleted')::boolean, false) and not coalesce((old.data->>'deleted')::boolean, false))
  execute function public.punpang__member_customer_purge();

-- ---------- 5) RPC: ตัวคูณของบิล (พนักงาน) และบัตรระดับ (เซิร์ฟเวอร์ของลูกค้า) ----------
-- ตัวคูณของบิลที่กำลังจะส่งมอบ (ใช้แสดงในหน้าขาย) · โหมดปิด/ลูกค้าถูกลบ = ตัวคูณ 1
create or replace function public.punpang_member_preview(p_order text, p_base numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record;
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  cdel boolean;
  m numeric;
begin
  if role_ is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_base is null or p_base < 0 then return jsonb_build_object('error', 'invalid'); end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select coalesce((c.data->>'deleted')::boolean, false) into cdel from public.punpang_customers c where c.id = o.customer_id;
  if cfg->>'mode' = 'off' or coalesce(cdel, true) then
    return jsonb_build_object('ok', true, 'applied', false, 'mult', 1);
  end if;
  st := public.punpang__member_fold(o.customer_id, now());
  m := public.punpang__member_bill_mult(st, round(p_base, 2), public.punpang__member_renew_min(o.data, cfg), cfg);
  return jsonb_build_object('ok', true, 'applied', cfg->>'mode' = 'live', 'mult', m, 'levelName', st->>'levelName', 'status', st->>'status');
end $$;
revoke all on function public.punpang_member_preview(text, numeric) from public, anon;
grant execute on function public.punpang_member_preview(text, numeric) to authenticated;

-- บัตรระดับของลูกค้า: เฉพาะโหมดใช้จริง · ไม่ส่งยอดสะสมและไม่ส่งยอดที่ต้องซื้อเพิ่ม (กันการคำนวณยอดสะสมย้อนกลับ)
create or replace function public.punpang_member_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
begin
  if cfg->>'mode' <> 'live' then return jsonb_build_object('enabled', false); end if;
  if not exists (select 1 from public.punpang_customers c
                  where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('enabled', false);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  return jsonb_build_object(
    'enabled', true,
    'levelNo', (st->>'level')::int,
    'levelName', st->>'levelName',
    'mult', case when st->>'status' = 'active' then (st->>'mult')::numeric else 1 end,
    'status', st->>'status',
    'golden', (st->>'golden')::boolean,
    'renewAt', st->>'renewAt',
    'activeUntil', case when st->>'renewAt' is not null then ((st->>'renewAt')::date + (cfg->>'inactiveDays')::int)::text end,
    'downgradeAt', st->>'downgradeAt'
  );
end $$;
revoke all on function public.punpang_member_card(text) from public, anon, authenticated;
grant execute on function public.punpang_member_card(text) to service_role;

-- สำเนาโหมดทดสอบ: คัดลอกตารางและฟังก์ชันใหม่ไปยัง punpang_test
select punpang_test.punpang_test_sync();
