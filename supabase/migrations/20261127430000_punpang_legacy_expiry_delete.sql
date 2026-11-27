-- สิทธิ์คะแนนเดิม: ใช้ได้ถึง 31/12/2027 · ถ้าไม่สมัคร/ไม่ถูกเพิ่มภายในวันนั้น ถือว่าสละสิทธิ์ (ลบข้อมูลทิ้ง)
-- เมื่อรับสิทธิ์แล้ว ลบแถวเบอร์นั้นทันที เพื่อไม่ให้นำไปใช้ซ้ำ

create or replace function public.punpang__legacy_deadline()
returns date language sql immutable set search_path = '' as $$ select date '2027-12-31' $$;

-- จับคู่: หลังวันกำหนดไม่จับคู่แล้ว · เมื่อจับคู่สำเร็จให้ลบแถวเบอร์นั้น (แทนการผูก)
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
  if current_date > public.punpang__legacy_deadline() then return; end if;
  select * into c from public.punpang_customers where id = p_id;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return; end if;
  norm := public.punpang__legacy_norm_tel(c.phone);
  if norm is null then return; end if;
  h := encode(sha256(convert_to(norm, 'UTF8')), 'hex');
  select * into lp from public.punpang_legacy_points where tel_hash = h for update skip locked;
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
  delete from public.punpang_legacy_points where tel_hash = h;
end $$;

-- ค้นหา: หลังวันกำหนดหรือเบอร์ที่รับสิทธิ์ไปแล้ว (ถูกลบแถวแล้ว) คืน null
create or replace function public.punpang_legacy_lookup(p_tel_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_tel_hash is null or p_tel_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  if current_date > public.punpang__legacy_deadline() then return null; end if;
  return (select jsonb_build_object('points', floor(points)) from public.punpang_legacy_points where tel_hash = p_tel_hash);
end $$;

-- ย้ายแบบพนักงาน: หลังวันกำหนดไม่ได้แล้ว · สำเร็จแล้วลบแถวเบอร์นั้น
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
  if current_date > public.punpang__legacy_deadline() then return jsonb_build_object('error', 'expired'); end if;
  if p_old_points is null or p_old_points < 1 or p_old_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  select * into c from public.punpang_customers where id = p_customer;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  if exists (select 1 from public.punpang_member_events where order_id = oid) then return jsonb_build_object('error', 'already_migrated'); end if;
  h := encode(sha256(convert_to(public.punpang__legacy_norm_tel(c.phone), 'UTF8')), 'hex');

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

  delete from public.punpang_legacy_points where tel_hash = h;

  return jsonb_build_object('ok', true, 'points', pts, 'spend', spend, 'level', top_name);
end $$;

revoke all on function public.punpang_legacy_migrate(text, integer) from public, anon;
grant execute on function public.punpang_legacy_migrate(text, integer) to authenticated;

-- ลบเบอร์ที่หมดสิทธิ์ทุกวัน (เวลาไทย 03:00 = 20:00 UTC)
do $$ begin perform cron.unschedule('punpang_legacy_expire'); exception when others then null; end $$;
select cron.schedule('punpang_legacy_expire', '0 20 * * *', $cron$ delete from public.punpang_legacy_points where current_date > date '2027-12-31' $cron$);
