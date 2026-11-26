-- ย้ายคะแนนจากระบบเดิม (แอดมินทำทีละคน) · แต้ม = แต้มที่กรอก × 2 × ตัวคูณระดับสูงสุด
-- ลูกค้าได้ระดับสูงสุดโดยเพิ่มยอดสะสม "ย้ายจากระบบเดิม" = เกณฑ์ระดับสูงสุด + 1 (ระดับคำนวณจากสมุดยอดเดิม จึงไม่ต้องแก้ตรรกะระดับ)
-- ทำในธุรกรรมเดียว · ย้ายซ้ำไม่ได้ (ตรวจจากรายการยอดรหัส legacy-<ลูกค้า>)

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
  oid text := 'legacy-' || coalesce(p_customer, '');
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_old_points is null or p_old_points < 1 or p_old_points > 1000000 then return jsonb_build_object('error', 'invalid'); end if;
  if not exists (select 1 from public.punpang_customers where id = p_customer) then return jsonb_build_object('error', 'no_customer'); end if;
  if exists (select 1 from public.punpang_member_events where order_id = oid) then return jsonb_build_object('error', 'already_migrated'); end if;

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

  return jsonb_build_object('ok', true, 'points', pts, 'spend', spend, 'level', top_name);
end $$;

revoke all on function public.punpang_legacy_migrate(text, integer) from public, anon;
grant execute on function public.punpang_legacy_migrate(text, integer) to authenticated;
