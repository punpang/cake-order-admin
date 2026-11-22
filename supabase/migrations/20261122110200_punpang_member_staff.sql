-- ระดับสมาชิก เฟส 1 (ต่อจาก 20261122110100): ฟังก์ชันฝั่งพนักงานและผู้จัดการ
-- punpang_member_staff_card: ป้ายระดับที่ POS (พนักงานที่มีสิทธิ์ขาย/ส่งมอบ/จัดการ) · ไม่ส่งยอดสะสม · โหมดปิด = enabled false
-- punpang_member_quote: ตัวอย่างตัวคูณของบิลก่อนชำระ · ตอบตัวคูณเฉพาะโหมดใช้จริง (โหมดอื่นตอบ 1) · ตัวจริงคิดตอนให้แต้มเสมอ
-- punpang_member_report: รายงานโหมดทดลอง/ใช้จริง (ผู้จัดการเท่านั้น) · จัดกลุ่มตามระดับปัจจุบันของลูกค้า

create or replace function public.punpang_member_staff_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
begin
  if public.punpang__pts_staff() is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cfg->>'mode' = 'off' or not exists (select 1 from public.punpang_customers c where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('enabled', false);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  return jsonb_build_object(
    'enabled', true, 'mode', cfg->>'mode',
    'levelNo', (st->>'level')::int, 'levelName', st->>'levelName',
    'mult', case when st->>'status' = 'active' then (st->>'mult')::numeric else 1 end,
    'status', st->>'status', 'golden', (st->>'golden')::boolean,
    'renewAt', st->>'renewAt',
    'activeUntil', case when st->>'renewAt' is not null then ((st->>'renewAt')::date + (cfg->>'inactiveDays')::int)::text end,
    'downgradeAt', st->>'downgradeAt');
end $$;
revoke all on function public.punpang_member_staff_card(text) from public, anon;
grant execute on function public.punpang_member_staff_card(text) to authenticated;

create or replace function public.punpang_member_quote(p_customer text, p_base numeric, p_vat_rate numeric default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  m numeric;
begin
  if public.punpang__pts_staff() is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_base is null or p_base < 0 or p_vat_rate is null or p_vat_rate < 0 or p_vat_rate > 100 then
    return jsonb_build_object('error', 'invalid');
  end if;
  if cfg->>'mode' <> 'live' or not exists (select 1 from public.punpang_customers c where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('ok', true, 'applied', false, 'mult', 1);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  m := public.punpang__member_bill_mult(st, round(p_base, 2),
         public.punpang__member_renew_min(jsonb_build_object('vat', jsonb_build_object('rate', p_vat_rate)), cfg), cfg);
  return jsonb_build_object('ok', true, 'applied', true, 'mult', m, 'levelName', st->>'levelName', 'status', st->>'status');
end $$;
revoke all on function public.punpang_member_quote(text, numeric, numeric) from public, anon;
grant execute on function public.punpang_member_quote(text, numeric, numeric) to authenticated;

create or replace function public.punpang_member_report(p_days int default 30, p_redeem numeric default 0.4)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  nlv int := jsonb_array_length(cfg->'levels');
  earn_per numeric := greatest(public.punpang__pts_cfg('earnPer', 100), 0.01);
  pt_val numeric := greatest(public.punpang__pts_cfg('pointValue', 1), 0);
  since date;
  c record;
  st jsonb;
  lvl int;
  mem int[] := array_fill(0, array[nlv]);
  bas numeric[] := array_fill(0::numeric, array[nlv]);
  ext numeric[] := array_fill(0::numeric, array[nlv]);
  s_base numeric;
  s_extra numeric;
  rows_ jsonb := '[]'::jsonb;
  tot_mem int := 0;
  tot_base numeric := 0;
  tot_extra numeric := 0;
  i int;
begin
  if public.punpang__pts_staff() is null or not public.punpang_has_perm('manage') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 3650 or p_redeem is null or p_redeem < 0 or p_redeem > 1 then
    return jsonb_build_object('error', 'invalid');
  end if;
  since := (now() at time zone 'Asia/Bangkok')::date - p_days;
  for c in
    select distinct e.customer_id as cid from public.punpang_member_events e
     where exists (select 1 from public.punpang_customers pc where pc.id = e.customer_id and not coalesce((pc.data->>'deleted')::boolean, false))
  loop
    st := public.punpang__member_fold(c.cid, now());
    lvl := greatest(1, least(nlv, (st->>'level')::int));
    select coalesce(sum(e.amount), 0), coalesce(sum(e.amount * (e.mult - 1)), 0) into s_base, s_extra
      from public.punpang_member_events e
     where e.customer_id = c.cid and e.kind = 'spend' and e.day >= since
       and not exists (select 1 from public.punpang_member_events u
                        where u.customer_id = e.customer_id and u.order_id = e.order_id and u.kind = 'undo' and u.id > e.id);
    mem[lvl] := mem[lvl] + 1;
    bas[lvl] := bas[lvl] + s_base;
    ext[lvl] := ext[lvl] + s_extra;
  end loop;
  for i in 1..nlv loop
    rows_ := rows_ || jsonb_build_array(jsonb_build_object(
      'levelNo', i, 'levelName', cfg->'levels'->(i - 1)->>'name', 'members', mem[i],
      'base', round(bas[i], 2), 'extraPoints', round(ext[i] / earn_per, 2),
      'costPct', case when bas[i] > 0 then round(ext[i] / earn_per * pt_val * p_redeem / bas[i] * 100, 2) else 0 end,
      'fullCostPct', case when bas[i] > 0 then round((ext[i] + bas[i]) / earn_per * pt_val * p_redeem / bas[i] * 100, 2) else 0 end));
    tot_mem := tot_mem + mem[i];
    tot_base := tot_base + bas[i];
    tot_extra := tot_extra + ext[i];
  end loop;
  return jsonb_build_object(
    'mode', cfg->>'mode', 'days', p_days, 'redeem', p_redeem, 'earnPer', earn_per, 'pointValue', pt_val,
    'levels', rows_,
    'total', jsonb_build_object(
      'members', tot_mem, 'base', round(tot_base, 2), 'extraPoints', round(tot_extra / earn_per, 2),
      'costPct', case when tot_base > 0 then round(tot_extra / earn_per * pt_val * p_redeem / tot_base * 100, 2) else 0 end,
      'fullCostPct', case when tot_base > 0 then round((tot_extra + tot_base) / earn_per * pt_val * p_redeem / tot_base * 100, 2) else 0 end));
end $$;
revoke all on function public.punpang_member_report(int, numeric) from public, anon;
grant execute on function public.punpang_member_report(int, numeric) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่ไปยังสำเนา punpang_test
select punpang_test.punpang_test_sync();
