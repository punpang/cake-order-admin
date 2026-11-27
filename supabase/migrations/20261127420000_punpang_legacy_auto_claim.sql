-- จับคู่คะแนนเดิมอัตโนมัติเมื่อลูกค้าเกิดใหม่หรือเปลี่ยนเบอร์
-- กติกา: คะแนนที่ได้ = คะแนนเดิม × 2 × ตัวคูณระดับสูงสุด · ยอดซื้อสะสม = เกณฑ์ระดับสูงสุด + 1 (ได้ระดับสูงสุด 1 ปี)
-- เบอร์ที่ใช้ร่วมกัน: คนที่ถูกผูกก่อนได้คะแนน (claimed_by กันซ้ำ) · ข้อผิดพลาดไม่ขัดขวางการสมัคร (rollback เฉพาะส่วนของการจับคู่)

alter table public.punpang_legacy_points add column if not exists claimed_by text;
alter table public.punpang_legacy_points add column if not exists claimed_at timestamptz;

-- เทียบ normalizeTel ฝั่งแอป: ตัดทุกอักขระที่ไม่ใช่ตัวเลข · 66xxxxxxxxx → 0xxxxxxxxx · ต้องเป็น 0 ตามด้วย 8–9 หลัก
create or replace function public.punpang__legacy_norm_tel(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare x text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if length(x) = 11 and left(x, 2) = '66' then x := '0' || substr(x, 3); end if;
  if x ~ '^0\d{8,9}$' then return x; end if;
  return null;
end $$;

-- เพิ่มล็อตคะแนนให้ลูกค้า (ฝั่งบวก เหมือน punpang_adjust_points แต่ไม่ตรวจสิทธิ์พนักงาน)
create or replace function public.punpang__legacy_award(p_customer text, p_points integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c record;
  ledger jsonb;
  eid text := public.punpang__pts_newid();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
begin
  if p_points <= 0 then return; end if;
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found then return; end if;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  update public.punpang_customers
     set data = jsonb_set(data, '{ledger}', ledger || jsonb_build_array(jsonb_build_object(
           'id', eid, 'at', nowz, 'delta', p_points, 'reason', p_reason, 'orderId', null,
           'expiresAt', exp_at, 'remaining', p_points, 'by', 'legacy')), true),
         updated_at = now()
   where id = p_customer;
end $$;

-- จับคู่ลูกค้าหนึ่งราย: ถ้าเบอร์ตรงกับคะแนนเดิมที่ยังไม่ถูกผูก → ให้คะแนนและยอดซื้อสะสม แล้วผูกเบอร์นั้นกับลูกค้า
create or replace function public.punpang__legacy_claim_customer(p_id text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c record;
  norm text;
  h text;
  lp record;
  cfg jsonb;
  top_min numeric;
  top_mult numeric;
  top_name text;
  renew numeric;
  pts integer;
  spend numeric;
begin
  select * into c from public.punpang_customers where id = p_id;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return; end if;
  norm := public.punpang__legacy_norm_tel(c.phone);
  if norm is null then return; end if;
  h := encode(sha256(convert_to(norm, 'UTF8')), 'hex');
  select * into lp from public.punpang_legacy_points where tel_hash = h and claimed_by is null for update skip locked;
  if not found then return; end if;
  if exists (select 1 from public.punpang_member_events where order_id = 'legacy-' || p_id) then return; end if;

  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'memberLevels';
  if cfg is null or jsonb_typeof(cfg->'levels') is distinct from 'array' then return; end if;
  select (lv->>'min')::numeric, (lv->>'mult')::numeric, lv->>'name' into top_min, top_mult, top_name
    from jsonb_array_elements(cfg->'levels') as lv order by (lv->>'min')::numeric desc limit 1;
  renew := coalesce((cfg->>'renewGross')::numeric, 0);
  if top_min is null or top_mult is null or top_mult < 1 or renew <= 0 then return; end if;

  pts := (floor(lp.points) * 2 * top_mult)::integer;
  spend := top_min + 1;
  if pts > 0 then
    perform public.punpang__legacy_award(p_id, pts, 'ย้ายจากระบบเดิม ' || floor(lp.points) || ' แต้ม');
  end if;
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_id, 'legacy-' || p_id, 'spend', now(), (now() at time zone 'Asia/Bangkok')::date, spend, renew, top_mult);
  update public.punpang_legacy_points set claimed_by = p_id, claimed_at = now() where tel_hash = h;
end $$;

-- trigger: ลูกค้าใหม่ หรือเปลี่ยนเบอร์ → ลองจับคู่ (ล้มเหลวได้โดยไม่ขัดขวางการบันทึกลูกค้า)
create or replace function public.punpang__legacy_auto_claim_trg()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and old.phone is not distinct from new.phone then return null; end if;
  begin
    perform public.punpang__legacy_claim_customer(new.id);
  exception when others then
    raise warning 'legacy auto-claim failed for %: %', new.id, sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists punpang_customers_legacy_claim on public.punpang_customers;
create trigger punpang_customers_legacy_claim
  after insert or update of phone on public.punpang_customers
  for each row execute function public.punpang__legacy_auto_claim_trg();

-- ค้นหาคะแนนเดิม: เฉพาะเบอร์ที่ยังไม่ถูกผูก
create or replace function public.punpang_legacy_lookup(p_tel_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_tel_hash is null or p_tel_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  return (select jsonb_build_object('points', floor(points)) from public.punpang_legacy_points
           where tel_hash = p_tel_hash and claimed_by is null);
end $$;


-- แก้การย้ายแบบพนักงาน: ไม่ให้เบอร์ที่ถูกผูกกับลูกค้าอื่นแล้วให้คะแนนซ้ำ และผูกเบอร์เมื่อย้ายสำเร็จ
create or replace function public.punpang_legacy_migrate(p_customer text, p_old_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb;
  top_min numeric;
  top_mult numeric;
  top_name text;
  spend numeric;
  renew numeric;
  pts integer;
  adj jsonb;
  c record;
  h text;
  lp record;
  oid text := 'legacy-' || coalesce(p_customer, '');
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_old_points is null or p_old_points < 1 or p_old_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  select * into c from public.punpang_customers where id = p_customer;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  if exists (select 1 from public.punpang_member_events where order_id = oid) then return jsonb_build_object('error', 'already_migrated'); end if;
  h := encode(sha256(convert_to(public.punpang__legacy_norm_tel(c.phone), 'UTF8')), 'hex');
  if public.punpang__legacy_norm_tel(c.phone) is not null then
    select * into lp from public.punpang_legacy_points where tel_hash = h;
    if found and lp.claimed_by is not null and lp.claimed_by <> p_customer then return jsonb_build_object('error', 'already_claimed'); end if;
  end if;

  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'memberLevels';
  if cfg is null or jsonb_typeof(cfg->'levels') is distinct from 'array' then return jsonb_build_object('error', 'no_config'); end if;
  select (lv->>'min')::numeric, (lv->>'mult')::numeric, lv->>'name' into top_min, top_mult, top_name
    from jsonb_array_elements(cfg->'levels') as lv order by (lv->>'min')::numeric desc limit 1;
  renew := coalesce((cfg->>'renewGross')::numeric, 0);
  if top_min is null or top_mult is null or top_mult < 1 or renew <= 0 then return jsonb_build_object('error', 'no_config'); end if;

  pts := (p_old_points * 2 * top_mult)::integer;
  spend := top_min + 1;

  adj := public.punpang_adjust_points(p_customer, pts, 'ย้ายจากระบบเดิม ' || p_old_points || ' แต้ม');
  if adj ? 'error' then return adj; end if;

  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_customer, oid, 'spend', now(), (now() at time zone 'Asia/Bangkok')::date, spend, renew, top_mult);

  if found then update public.punpang_legacy_points set claimed_by = p_customer, claimed_at = now() where tel_hash = h; end if;

  return jsonb_build_object('ok', true, 'points', pts, 'spend', spend, 'level', top_name);
end $$;

revoke all on function public.punpang_legacy_migrate(text, integer) from public, anon;
grant execute on function public.punpang_legacy_migrate(text, integer) to authenticated;
