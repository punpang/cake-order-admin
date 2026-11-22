-- ระยะเก็บ 5 ปี (รอบ 2026-11-22): ทำให้ออร์เดอร์ที่ครบกำหนดนิรนาม · ลบสลิป/รูปงานของออร์เดอร์นั้นผ่าน Edge Function · ยกยอดสมาชิกเป็นสแนปช็อตแล้วลบเหตุการณ์เก่า
-- โหมดเริ่มต้น = off (ไม่ทำอะไร) · ตั้งค่าที่ punpang_kv config/retention5y: {mode: off|report|live, years: 5..30, batch}
-- วันเริ่มนับ: created_at ของออร์เดอร์ (ยังไม่ได้ยืนยันทางกฎหมาย) · ค่าตั้งผิดหรือปีน้อยกว่า 5 = ปิดระบบ
-- ไฟล์นี้: (0) ค่าตั้งต้น (1) ตารางสแนปช็อตยอดสมาชิก (2) จัดประเภทในโหมดทดสอบ (3) ฟังก์ชันสมาชิก: เดินเหตุการณ์แบบมีจุดตัด + ยกยอด (4) ทริกเกอร์: ลบลูกค้า/แก้ยอดออร์เดอร์ที่นิรนามแล้ว (5) งานระยะเก็บ + รายงาน (6) pg_cron
-- ยังไม่ใช้กับ production: ต้องอนุมัติก่อน (migration + Edge Function retention-5y + ตั้งโหมด)

-- ---------- 0) ค่าตั้งต้น: ปิด ----------
insert into public.punpang_kv (collection, id, data)
values ('config', 'retention5y', jsonb_build_object('v', jsonb_build_object('mode', 'off', 'years', 5, 'batch', 200)))
on conflict (collection, id) do nothing;

-- ---------- 1) ตารางสแนปช็อตยอดสมาชิก (ยอดก่อนวันตัด · เขียนได้เฉพาะฟังก์ชันของระบบ) ----------
create table public.punpang_member_snapshots (
  customer_id text primary key references public.punpang_customers (id),
  as_of date not null,
  lvl int not null check (lvl >= 1),
  cum numeric(12, 2) not null check (cum >= 0),
  renew_at date,
  down_at date,
  last_day date not null, -- วันของรายการล่าสุดที่ยกยอดไปแล้ว (ใช้นับ 365 วันก่อนลบสแนปช็อต)
  updated_at timestamptz not null default now()
);
alter table public.punpang_member_snapshots enable row level security;
revoke all on public.punpang_member_snapshots from public, anon, authenticated, service_role;

-- ---------- 2) โหมดทดสอบ: จัดประเภทตารางใหม่เป็นตารางธุรกิจ (สำเนาในโหมดทดสอบ) ----------
do $$
declare d text; n text; pat text := '''punpang_member_events''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_member_snapshots''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'retention: รายการตารางธุรกิจใน punpang_test_sync ไม่ชัดเจน';
  end if;
  n := replace(d, pat, '''punpang_member_events'', ''punpang_member_snapshots''];');
  execute n;
end $$;

-- ---------- 3) เดินเหตุการณ์ยอดสมาชิก (แยกจากการคำนวณสถานะ) ----------
-- เริ่มจากสแนปช็อต (ถ้ามี) แล้วประมวลผลเหตุการณ์ที่ตรงเงื่อนไข p_cut (null = ทั้งหมด) · คืนสถานะภายในก่อนคิดวันนี้
-- ตรรกะเดียวกับเดิมทุกบรรทัด: ลดขั้นที่ครบกำหนดก่อนวันของเหตุการณ์ · วันที่ครบกำหนดพอดีตัดสินด้วยยอดของวันนั้น
create or replace function public.punpang__member_walk(p_customer text, p_now timestamptz, p_cut date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  lv jsonb := cfg->'levels';
  nlv int := jsonb_array_length(cfg->'levels');
  dg int := (cfg->>'downgradeDays')::int;
  today date := (p_now at time zone 'Asia/Bangkok')::date;
  lvl int := 1;
  cum numeric := 0;
  renew_at date := null;
  down_at date := null;
  anc date := null;
  t_tot numeric := 0;
  t_max numeric := 0;
  pre_lvl int := null; -- ระดับก่อนลดขั้นของวันครบกำหนดวันนี้ (บิลต่ออายุของวันนั้นใช้ระดับนี้)
  snap public.punpang_member_snapshots%rowtype;
  d record;
begin
  select * into snap from public.punpang_member_snapshots s where s.customer_id = p_customer;
  if found then
    lvl := snap.lvl; cum := snap.cum; renew_at := snap.renew_at; down_at := snap.down_at;
  end if;
  for d in
    select e.day as dy, sum(e.amount) as tot, max(e.renew_min) as mx
      from public.punpang_member_events e
     where e.customer_id = p_customer and e.kind = 'spend' and e.at <= p_now
       and (p_cut is null or e.day < p_cut)
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

  return jsonb_build_object('lvl', lvl, 'cum', cum, 'renewAt', renew_at, 'downAt', down_at,
    'preLvl', pre_lvl, 'tTot', t_tot, 'tMax', t_max, 'today', today);
end $$;
revoke all on function public.punpang__member_walk(text, timestamptz, date) from public, anon, authenticated;

-- สถานะปัจจุบัน (ไม่เก็บผลลัพธ์ · คำนวณใหม่ทุกครั้ง) · รูปแบบคืนค่าเดิมทุกช่อง
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
  w jsonb := public.punpang__member_walk(p_customer, p_now, null);
  lvl int := (w->>'lvl')::int;
  cum numeric := (w->>'cum')::numeric;
  renew_at date := (w->>'renewAt')::date;
  down_at date := (w->>'downAt')::date;
  pre_lvl int := (w->>'preLvl')::int;
  t_tot numeric := (w->>'tTot')::numeric;
  t_max numeric := (w->>'tMax')::numeric;
  anc date := null;
  delta int := null;
  st text;
begin
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

-- ---------- 4) ทริกเกอร์ ----------
-- ลบลูกค้า (PDPA): ลบสแนปช็อตด้วย (เดิมลบเฉพาะเหตุการณ์)
create or replace function public.punpang__member_customer_purge()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('punpang.member_purge', 'on', true);
  delete from public.punpang_member_events where customer_id = new.id;
  delete from public.punpang_member_snapshots where customer_id = new.id;
  perform set_config('punpang.member_purge', 'off', true);
  return null;
end $$;
revoke all on function public.punpang__member_customer_purge() from public, anon, authenticated;

-- ย้อนสถานะ/ยกเลิก/ย้ายผู้ซื้อ ของออร์เดอร์ที่ทำให้นิรนามแล้ว: ไม่ได้ (ยอดที่ยกไปแล้วแก้ย้อนไม่ได้)
create or replace function public.punpang__member_order_reconcile()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  sp public.punpang_member_events%rowtype;
  live boolean := jsonb_typeof(new.data->'loyalty') = 'object';
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if new.data ? 'retentionAnon' then
    raise exception 'ออร์เดอร์นี้ถูกทำให้นิรนามตามระยะเก็บแล้ว แก้ยอดสมาชิกไม่ได้' using errcode = '42501';
  end if;
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

-- ออร์เดอร์ที่ทำให้นิรนามแล้วบันทึกทับด้วยข้อมูลเดิม (เช่น แอปที่โหลดไว้ก่อน) ไม่ได้ · กันข้อมูลส่วนบุคคลกลับมา
create or replace function public.punpang__ret_keep_anon()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.data ? 'retentionAnon' and not (new.data ? 'retentionAnon') then
    raise exception 'ออร์เดอร์นี้ถูกทำให้นิรนามตามระยะเก็บแล้ว บันทึกทับด้วยข้อมูลเดิมไม่ได้' using errcode = '42501';
  end if;
  return new;
end $$;
revoke all on function public.punpang__ret_keep_anon() from public, anon, authenticated;

drop trigger if exists punpang_orders_ret_keep_anon on public.punpang_orders;
create trigger punpang_orders_ret_keep_anon before update on public.punpang_orders
  for each row execute function public.punpang__ret_keep_anon();

-- ---------- 5) งานระยะเก็บ ----------
-- ค่าตั้ง (ผิดชนิด/ปีน้อยกว่า 5 หรือมากกว่า 30 = off) และวันตัด (เวลาไทย)
create or replace function public.punpang__ret_cfg()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  kv jsonb;
  mode text;
  years int;
  batch int;
begin
  select k.data->'v' into kv from public.punpang_kv k where k.collection = 'config' and k.id = 'retention5y';
  if jsonb_typeof(kv) is distinct from 'object' then kv := '{}'::jsonb; end if;
  mode := coalesce(kv->>'mode', 'off');
  years := case when jsonb_typeof(kv->'years') = 'number' and (kv->>'years') ~ '^[0-9]{1,2}$' then (kv->>'years')::int end;
  batch := case when jsonb_typeof(kv->'batch') = 'number' and (kv->>'batch') ~ '^[0-9]{1,4}$' then (kv->>'batch')::int end;
  if mode not in ('off', 'report', 'live') or years is null or years < 5 or years > 30 then
    mode := 'off';
  end if;
  return jsonb_build_object(
    'mode', mode,
    'years', coalesce(years, 5),
    'batch', least(greatest(coalesce(batch, 200), 1), 1000),
    'cutDay', ((now() at time zone 'Asia/Bangkok')::date - make_interval(years => coalesce(years, 5)))::date);
end $$;
revoke all on function public.punpang__ret_cfg() from public, anon, authenticated;

-- กลุ่มตัวเลือกแบบข้อความ (ข้อความบนเค้ก · แพ้อาหาร ฯลฯ) ตัดออกจากออร์เดอร์ที่นิรนาม
create or replace function public.punpang__ret_text_groups()
returns text[] language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(g->>'id'), '{}'::text[])
    from public.punpang_kv k,
         jsonb_array_elements(case when jsonb_typeof(k.data->'v') = 'array' then k.data->'v' else '[]'::jsonb end) g
   where k.collection = 'config' and k.id = 'optionGroups' and g->>'type' = 'text';
$$;
revoke all on function public.punpang__ret_text_groups() from public, anon, authenticated;

-- รหัสไฟล์ของ R2 ในข้อมูลออร์เดอร์ (r2://private/<key>) และคีย์ที่ Worker ลบได้จริง (ตรงกับ validKey ของ Worker)
create or replace function public.punpang__ret_keys(d jsonb)
returns text[] language sql immutable set search_path = '' as $$
  select coalesce(array_agg(distinct m[1]), '{}'::text[])
    from regexp_matches(coalesce(d::text, ''), 'r2://private/([A-Za-z0-9_./-]+)', 'g') as m;
$$;
revoke all on function public.punpang__ret_keys(jsonb) from public, anon, authenticated;

create or replace function public.punpang__ret_valid_key(k text)
returns boolean language sql immutable set search_path = '' as $$
  select k ~ '^[A-Za-z0-9_/-]+\.(png|jpg|webp)$' and length(k) <= 200 and k !~ '\.\.' and k !~ '//' and k !~ '^/';
$$;
revoke all on function public.punpang__ret_valid_key(text) from public, anon, authenticated;

-- ข้อความอิสระในออร์เดอร์ที่นิรนาม: ประวัติเหลือเวลาและผู้บันทึก · หมายเหตุ/เหตุผลว่าง · ข้อความในคำขอไม่ให้ใช้รูปว่าง
create or replace function public.punpang__ret_free_text(d jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select d
    || case when jsonb_typeof(d->'history') = 'array' then jsonb_build_object('history',
         (select coalesce(jsonb_agg(case when jsonb_typeof(h) = 'object' then h - 'text' else '{}'::jsonb end order by n), '[]'::jsonb)
            from jsonb_array_elements(d->'history') with ordinality as hh(h, n))) else '{}'::jsonb end
    || case when jsonb_typeof(d->'approval') = 'object' then jsonb_build_object('approval', (d->'approval') || '{"note": "", "decisionNote": ""}'::jsonb) else '{}'::jsonb end
    || case when jsonb_typeof(d->'adjustment') = 'object' then jsonb_build_object('adjustment', (d->'adjustment') || '{"reason": ""}'::jsonb) else '{}'::jsonb end
    || case when jsonb_typeof(d->'cancel') = 'object' then jsonb_build_object('cancel', (d->'cancel') || '{"reason": ""}'::jsonb) else '{}'::jsonb end
    || case when jsonb_typeof(d->'photoConsent') = 'object' then jsonb_build_object('photoConsent',
         (d->'photoConsent') || '{"note": ""}'::jsonb
         || case when jsonb_typeof(d->'photoConsent'->'history') = 'array' then jsonb_build_object('history',
              (select coalesce(jsonb_agg(case when jsonb_typeof(h) = 'object' then h - 'text' else '{}'::jsonb end order by n), '[]'::jsonb)
                 from jsonb_array_elements(d->'photoConsent'->'history') with ordinality as pp(h, n))) else '{}'::jsonb end)
       else '{}'::jsonb end
    || case when jsonb_typeof(d->'payments') = 'array' then jsonb_build_object('payments',
         (select coalesce(jsonb_agg(case when jsonb_typeof(p) = 'object' and p ? 'cancelReason' then p || '{"cancelReason": ""}'::jsonb else p end order by n), '[]'::jsonb)
            from jsonb_array_elements(d->'payments') with ordinality as pa(p, n))) else '{}'::jsonb end
    || case when jsonb_typeof(d->'returns') = 'array' then jsonb_build_object('returns',
         (select coalesce(jsonb_agg(case when jsonb_typeof(r) = 'object'
              then (r || '{"reason": "", "note": ""}'::jsonb)
                   || case when jsonb_typeof(r->'cancelled') = 'object' then jsonb_build_object('cancelled', (r->'cancelled') || '{"reason": ""}'::jsonb) else '{}'::jsonb end
              else r end order by n), '[]'::jsonb)
            from jsonb_array_elements(d->'returns') with ordinality as rt(r, n))) else '{}'::jsonb end;
$$;
revoke all on function public.punpang__ret_free_text(jsonb) from public, anon, authenticated;

-- ไฟล์ลบได้เมื่อ: ชื่อคีย์ถูกต้อง · เป็นของออร์เดอร์นี้ (<orderId>/… หรือ pay-qr/<orderId>/…) · ไม่มีตารางอื่นอ้าง · ไม่มีออร์เดอร์/การชำระอื่นอ้าง
create or replace function public.punpang__ret_deletable(p_key text, p_order text, refs text[], owners jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select public.punpang__ret_valid_key(p_key)
     and p_order is not null
     and (split_part(p_key, '/', 1) = p_order
          or (split_part(p_key, '/', 1) = 'pay-qr' and split_part(p_key, '/', 2) = p_order))
     and not (p_key = any (refs))
     and not exists (select 1 from jsonb_array_elements_text(coalesce(owners -> p_key, '[]'::jsonb)) as ow(v) where ow.v <> p_order);
$$;
revoke all on function public.punpang__ret_deletable(text, text, text[], jsonb) from public, anon, authenticated;

-- ยอดรวมก่อนวันตัดของลูกค้า: ต้องไม่มีเหตุการณ์ที่ยังแก้ไม่ได้ (ออร์เดอร์ยังไม่นิรนาม หรือถูกถอนยอดหลังวันตัด)
create or replace function public.punpang__ret_settled(p_customer text, p_cut date)
returns boolean language sql stable security definer set search_path = '' as $$
  select not exists (
    select 1 from public.punpang_member_events e
     where e.customer_id = p_customer and e.day < p_cut
       and (not exists (select 1 from public.punpang_orders o where o.id = e.order_id and o.data ? 'retentionAnon')
            or exists (select 1 from public.punpang_member_events u
                        where u.customer_id = e.customer_id and u.order_id = e.order_id
                          and u.kind = 'undo' and u.day >= p_cut)));
$$;
revoke all on function public.punpang__ret_settled(text, date) from public, anon, authenticated;

-- ยกยอดของลูกค้า: เขียนสแนปช็อตที่วันตัด (รวมการลดขั้นที่ครบก่อนวันตัด) แล้วลบเหตุการณ์ก่อนวันตัด
create or replace function public.punpang__ret_carry(p_customer text, p_cut date)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  lv jsonb := cfg->'levels';
  dg int := (cfg->>'downgradeDays')::int;
  w jsonb;
  lvl int;
  cum numeric;
  renew_at date;
  down_at date;
  anc date;
  last_d date;
begin
  if not exists (select 1 from public.punpang_member_events e where e.customer_id = p_customer and e.day < p_cut) then
    return false;
  end if;
  select max(e.day) into last_d from public.punpang_member_events e where e.customer_id = p_customer and e.day < p_cut;
  w := public.punpang__member_walk(p_customer, now(), p_cut);
  lvl := (w->>'lvl')::int;
  cum := (w->>'cum')::numeric;
  renew_at := (w->>'renewAt')::date;
  down_at := (w->>'downAt')::date;
  if renew_at is not null then
    anc := greatest(renew_at, down_at);
    while lvl > 1 and anc + dg < p_cut loop -- ลดขั้นที่ครบก่อนวันตัด (วันตัดเองให้เป็นของเหตุการณ์ถัดไป)
      lvl := lvl - 1;
      cum := (lv->(lvl - 1)->>'min')::numeric;
      down_at := anc + dg;
      anc := down_at;
    end loop;
  end if;
  insert into public.punpang_member_snapshots as sn (customer_id, as_of, lvl, cum, renew_at, down_at, last_day, updated_at)
  values (p_customer, p_cut, lvl, cum, renew_at, down_at, last_d, now())
  on conflict (customer_id) do update
     set as_of = excluded.as_of, lvl = excluded.lvl, cum = excluded.cum,
         renew_at = excluded.renew_at, down_at = excluded.down_at,
         last_day = greatest(sn.last_day, excluded.last_day), updated_at = excluded.updated_at;
  perform set_config('punpang.member_purge', 'on', true);
  delete from public.punpang_member_events where customer_id = p_customer and day < p_cut;
  perform set_config('punpang.member_purge', 'off', true);
  return true;
end $$;
revoke all on function public.punpang__ret_carry(text, date) from public, anon, authenticated;

-- สรุปที่จะทำ (อ่านอย่างเดียว)
create or replace function public.punpang__ret_preview(cfg jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cut date := (cfg->>'cutDay')::date;
  cut_ts timestamptz := cut::timestamp at time zone 'Asia/Bangkok';
  n_ready int; n_open int; n_done int; n_queue int; n_ev int; n_cust int; n_ok int; n_exp int;
begin
  select count(*) into n_ready from public.punpang_orders x
   where x.created_at < cut_ts and not (x.data ? 'retentionAnon')
     and (x.status = 'cancelled' or (x.status = 'delivered' and coalesce(x.balance, 0) <= 0));
  select count(*) into n_open from public.punpang_orders x
   where x.created_at < cut_ts and not (x.data ? 'retentionAnon')
     and not (x.status = 'cancelled' or (x.status = 'delivered' and coalesce(x.balance, 0) <= 0));
  select count(*) into n_done from public.punpang_orders x where x.data ? 'retentionAnon';
  select count(*) into n_queue from public.punpang_kv k where k.collection = 'retentionFiles';
  select count(*) into n_ev from public.punpang_member_events e where e.day < cut;
  select count(distinct e.customer_id) into n_cust from public.punpang_member_events e where e.day < cut;
  select count(*) into n_ok from (select distinct e.customer_id from public.punpang_member_events e where e.day < cut) c
   where public.punpang__ret_settled(c.customer_id, cut);
  -- สแนปช็อตที่จะหมดอายุ: ลดถึง LV1 และไม่มีรายการ 365 วัน (ตรงกับงานจริง punpang_retention5y_run)
  select count(*) into n_exp from public.punpang_member_snapshots sn
   where sn.last_day <= ((now() at time zone 'Asia/Bangkok')::date - 365)
     and not exists (select 1 from public.punpang_member_events e where e.customer_id = sn.customer_id)
     and (public.punpang__member_fold(sn.customer_id, now())->>'level')::int = 1;
  return jsonb_build_object('mode', cfg->>'mode', 'years', (cfg->>'years')::int, 'cutDay', cut,
    'ordersReady', n_ready, 'ordersNotClosedOrUnpaid', n_open, 'ordersDone', n_done, 'filesQueued', n_queue,
    'memberEventsOld', n_ev, 'customersOld', n_cust, 'customersReady', n_ok, 'customersBlocked', n_cust - n_ok,
    'snapshotsExpiring', n_exp);
end $$;
revoke all on function public.punpang__ret_preview(jsonb) from public, anon, authenticated;

-- รายงานให้แอดมินดู (อ่านอย่างเดียว)
create or replace function public.punpang_retention5y_report()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'เฉพาะแอดมิน' using errcode = '42501';
  end if;
  return public.punpang__ret_preview(public.punpang__ret_cfg());
end $$;
revoke all on function public.punpang_retention5y_report() from public, anon;
grant execute on function public.punpang_retention5y_report() to authenticated, service_role;

-- งานประจำวัน (เรียกจาก Edge Function ด้วย service role เท่านั้น)
-- off = ไม่ทำอะไร · report = อ่านอย่างเดียว · live = (1) ออร์เดอร์ปิดแล้วก่อนวันตัด → นิรนาม (2) ยกยอดสมาชิกที่ยุติแล้ว (2ข) สแนปช็อตที่ลดถึง LV1 และไม่มีรายการ 365 วัน → ลบ
-- (3) ไฟล์ของออร์เดอร์ที่ไม่มีที่อื่นอ้าง → คิว punpang_kv retentionFiles (4) คืนรายการไฟล์ที่ต้องลบ · Edge Function ลบหลัง transaction นี้ commit แล้ว
create or replace function public.punpang_retention5y_run(p_batch int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__ret_cfg();
  mode text := cfg->>'mode';
  cut date := (cfg->>'cutDay')::date;
  cut_ts timestamptz := (cfg->>'cutDay')::date::timestamp at time zone 'Asia/Bangkok';
  lim int := least(greatest(coalesce(p_batch, (cfg->>'batch')::int, 200), 1), 1000);
  pat text := 'r2://private/([A-Za-z0-9_./-]+)';
  groups text[];
  refs text[] := '{}';
  part text[];
  owners jsonb := '{}'::jsonb;
  t record;
  o record;
  c record;
  sx record;
  r record;
  k text;
  nd jsonb;
  deletes text[] := '{}';
  n_orders int := 0; n_queued int := 0; n_kept int := 0; n_leftover int := 0; n_carry int := 0; n_block int := 0;
  n_expired int := 0;
begin
  if mode = 'off' then return jsonb_build_object('mode', 'off'); end if;
  if mode = 'report' then return public.punpang__ret_preview(cfg); end if;

  groups := public.punpang__ret_text_groups();
  if coalesce(array_length(groups, 1), 0) = 0 then
    return jsonb_build_object('mode', mode, 'error', 'no_text_groups'); -- ไม่รู้กลุ่มข้อความ = ตัดข้อมูลไม่ครบ จึงไม่ทำ
  end if;

  -- ดัชนีการอ้างอิงไฟล์ (ครั้งเดียวต่อรอบ): ตารางอื่นทุกตาราง ยกเว้นออร์เดอร์และการชำระ (ดูแยกด้านล่าง)
  for t in
    select c2.relname as name from pg_class c2 join pg_namespace n on n.oid = c2.relnamespace
     where n.nspname = 'public' and c2.relkind = 'r' and c2.relname not in ('punpang_orders', 'punpang_payments')
  loop
    execute format('select coalesce(array_agg(distinct m[1]), ''{}''::text[]) from public.%I x, regexp_matches(x::text, %L, ''g'') as m', t.name, pat) into part;
    refs := refs || part;
  end loop;
  -- เจ้าของไฟล์: ออร์เดอร์ (ใน data) และการชำระ (slip_path) → ไฟล์ → รหัสออร์เดอร์ที่อ้าง
  select coalesce(jsonb_object_agg(s.k, s.owners), '{}'::jsonb) into owners from (
    select x.k, jsonb_agg(distinct x.owner) as owners from (
      select m[1] as k, o2.id as owner from public.punpang_orders o2, regexp_matches(o2.data::text, pat, 'g') as m
      union all
      select regexp_replace(p.slip_path, '^r2://private/', '') as k, p.order_id as owner
        from public.punpang_payments p where p.slip_path is not null
    ) x group by x.k
  ) s;

  -- 1) ออร์เดอร์ที่ปิดแล้วและสร้างก่อนวันตัด → นิรนาม (ทีละชุด)
  for o in
    select x.id, x.data from public.punpang_orders x
     where x.created_at < cut_ts
       and (x.status = 'cancelled' or (x.status = 'delivered' and coalesce(x.balance, 0) <= 0))
       and not (x.data ? 'retentionAnon')
     order by x.created_at, x.id
     limit lim
     for update skip locked
  loop
    nd := public.punpang__ret_free_text(public.punpang__scrub_order_data(o.data, groups)) - 'occasion';
    if coalesce(array_length(public.punpang__ret_keys(nd), 1), 0) > 0 then
      n_leftover := n_leftover + 1; -- ยังเหลือการอ้างอิงไฟล์หลังตัดข้อมูล: ข้ามออร์เดอร์นี้ ไม่แตะไฟล์
      continue;
    end if;
    for k in
      select distinct u from unnest(public.punpang__ret_keys(o.data) || coalesce(array(
        select regexp_replace(p.slip_path, '^r2://private/', '') from public.punpang_payments p
         where p.order_id = o.id and p.slip_path is not null), '{}'::text[])) as u
    loop
      if public.punpang__ret_deletable(k, o.id, refs, owners) then
        insert into public.punpang_kv (collection, id, data)
        values ('retentionFiles', k, jsonb_build_object('orderId', o.id, 'queuedAt', now()))
        on conflict (collection, id) do nothing;
        n_queued := n_queued + 1;
      else
        n_kept := n_kept + 1; -- ไม่ใช่ไฟล์ของออร์เดอร์นี้ หรือมีที่อื่นอ้าง: ไม่ลบ
      end if;
    end loop;
    update public.punpang_orders x
       set data = nd || jsonb_build_object('retentionAnon', jsonb_build_object('at', now(), 'cutDay', cut))
     where x.id = o.id;
    update public.punpang_payments p set slip_path = null where p.order_id = o.id and p.slip_path is not null;
    update public.punpang_order_changes oc
       set summary = oc.summary #- '{money,adjustment,before,reason}' #- '{money,adjustment,after,reason}'
     where oc.order_id = o.id;
    update public.punpang_records rc set data = rc.data || '{"note": "", "decisionNote": ""}'::jsonb
     where rc.collection = 'photoRequests' and rc.data->>'orderId' = o.id;
    n_orders := n_orders + 1;
  end loop;

  -- 2) ยอดสมาชิก: ยกยอดเฉพาะลูกค้าที่ยุติแล้ว · ที่เหลือข้ามและนับไว้
  for c in select distinct e.customer_id as cid from public.punpang_member_events e where e.day < cut order by 1 loop
    if public.punpang__ret_settled(c.cid, cut) then
      if public.punpang__ret_carry(c.cid, cut) then n_carry := n_carry + 1; end if;
    else
      n_block := n_block + 1;
    end if;
  end loop;

  -- 2ข) สแนปช็อตที่ลดถึง LV1 และไม่มีรายการ 365 วัน (ไม่มีเหตุการณ์ค้าง) → ลบ (ลำดับหลังยกยอด จึงรวมลูกค้าที่เพิ่งยกยอดในรอบนี้ด้วย)
  for sx in
    select sn.customer_id as cid from public.punpang_member_snapshots sn
     where sn.last_day <= ((now() at time zone 'Asia/Bangkok')::date - 365)
       and not exists (select 1 from public.punpang_member_events e where e.customer_id = sn.customer_id)
  loop
    if (public.punpang__member_fold(sx.cid, now())->>'level')::int = 1 then
      delete from public.punpang_member_snapshots sn where sn.customer_id = sx.cid;
      n_expired := n_expired + 1;
    end if;
  end loop;

  -- 3) คิวไฟล์: ตรวจซ้ำทุกรายการ (รวมที่ค้างจากรอบก่อน) · ไม่ผ่าน = เอาออกจากคิว ไม่ลบไฟล์
  for r in select kv.id, kv.data->>'orderId' as oid from public.punpang_kv kv where kv.collection = 'retentionFiles' order by kv.id loop
    if public.punpang__ret_deletable(r.id, r.oid, refs, owners) then
      deletes := deletes || r.id;
    else
      delete from public.punpang_kv kv where kv.collection = 'retentionFiles' and kv.id = r.id;
      n_kept := n_kept + 1;
    end if;
  end loop;

  return jsonb_build_object('mode', mode, 'cutDay', cut,
    'orders', n_orders, 'leftoverRefs', n_leftover, 'filesQueued', n_queued, 'filesKept', n_kept,
    'customersCarried', n_carry, 'customersBlocked', n_block, 'snapshotsExpired', n_expired, 'deleteKeys', to_jsonb(deletes));
end $$;
revoke all on function public.punpang_retention5y_run(int) from public, anon, authenticated;
grant execute on function public.punpang_retention5y_run(int) to service_role;

-- ยืนยันว่าลบไฟล์ใน R2 แล้ว → เอาออกจากคิว (Edge Function เรียกเป็นชุดหลังลบสำเร็จ)
create or replace function public.punpang_retention5y_ack(p_keys text[])
returns int language sql security definer set search_path = '' as $$
  with d as (
    delete from public.punpang_kv kv where kv.collection = 'retentionFiles' and kv.id = any (p_keys) returning 1
  ) select count(*)::int from d;
$$;
revoke all on function public.punpang_retention5y_ack(text[]) from public, anon, authenticated;
grant execute on function public.punpang_retention5y_ack(text[]) to service_role;

-- ---------- 6) pg_cron: ทุกวัน 10:50 เวลาไทย (เหมือนงานรูปในแชท) ----------
create extension if not exists pg_net;

select cron.schedule(
  'punpang-retention-5y',
  '50 3 * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/retention-5y',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- สำเนาโหมดทดสอบ: คัดลอกตาราง/ฟังก์ชันใหม่ (ตารางสแนปช็อตอยู่ในรายการตารางธุรกิจแล้ว)
select punpang_test.punpang_test_sync();
