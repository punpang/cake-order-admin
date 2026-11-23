-- สิทธิวันเกิด (ต่อจาก 20261123130000): ล้างเดือนเกิด · ข้อมูลสิทธิวันเกิดสำหรับบัตรและ POS/เว็บ
-- ส่วนลดเค้กเดือนเกิด: LV3 5% (สูงสุด 25 บาท) · LV4 10% (สูงสุด 50 บาท) เฉพาะ Active และกรอกเดือนเกิดครบ 30 วัน
-- ใช้กับยอดหมวดเค้กเท่านั้น และไม่ซ้อนคูปอง: เลือกส่วนลดที่ได้มากกว่า (คำนวณในแอป/เซิร์ฟเวอร์ตามกติกาเดียวกัน)

-- ---------- 1) ล้างเดือนเกิด (ถอนความยินยอม) ----------
create or replace function public.punpang_cust_clear_birth(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  update public.punpang_customers
     set data = (data - 'birth'), updated_at = now()
   where id = p_customer and not coalesce((data->>'deleted')::boolean, false);
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.punpang_cust_clear_birth(text) from public, anon, authenticated;
grant execute on function public.punpang_cust_clear_birth(text) to service_role;

-- ---------- 2) มุมมองสิทธิวันเกิดจากผล fold (ไม่มีข้อมูลภายในอื่น) ----------
create or replace function public.punpang__member_birth_view(st jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select jsonb_build_object(
    'eligible', coalesce((st->>'birthOk')::boolean, false),
    'active', st->>'status' = 'active',
    'rate', case when coalesce((st->>'birthOk')::boolean, false) and st->>'status' = 'active'
                 then case (st->>'level')::int when 3 then 5 when 4 then 10 else 0 end else 0 end,
    'cap', case (st->>'level')::int when 3 then 25 when 4 then 50 else 0 end,
    'birthMult', case when coalesce((st->>'birthOk')::boolean, false) and st->>'status' = 'active'
                      then (st->>'birthMult')::numeric end)
$$;
revoke all on function public.punpang__member_birth_view(jsonb) from public, anon, authenticated;

-- ---------- 3) บัตรลูกค้า: เพิ่มกุญแจ birth และตัวคูณแสดงรวมเดือนเกิด ----------
create or replace function public.punpang_member_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
begin
  if cfg->>'mode' <> 'live' then return jsonb_build_object('enabled', false); end if;
  if not exists (select 1 from public.punpang_customers c
                  where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('enabled', false);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  bv := public.punpang__member_birth_view(st);
  return jsonb_build_object(
    'enabled', true,
    'levelNo', (st->>'level')::int,
    'levelName', st->>'levelName',
    'mult', case when st->>'status' = 'active' then greatest((st->>'mult')::numeric, coalesce((bv->>'birthMult')::numeric, 0)) else 1 end,
    'status', st->>'status',
    'golden', (st->>'golden')::boolean,
    'renewAt', st->>'renewAt',
    'activeUntil', case when st->>'renewAt' is not null then ((st->>'renewAt')::date + (cfg->>'inactiveDays')::int)::text end,
    'downgradeAt', st->>'downgradeAt',
    'birth', bv
  );
end $$;
revoke all on function public.punpang_member_card(text) from public, anon, authenticated;
grant execute on function public.punpang_member_card(text) to service_role;

-- สำเนาโหมดทดสอบ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();

-- พนักงาน (POS): เหมือนเดิมทุกประการ + birth และตัวคูณรวมเดือนเกิด
create or replace function public.punpang_member_staff_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
  lvl int;
  cum numeric;
  cur_min numeric;
  next_min numeric;
begin
  if public.punpang__pts_staff() is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if cfg->>'mode' = 'off' or not exists (select 1 from public.punpang_customers c where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('enabled', false);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  bv := public.punpang__member_birth_view(st);
  lvl := (st->>'level')::int;
  cum := (st->>'cum')::numeric;
  cur_min := (cfg->'levels'->(lvl - 1)->>'min')::numeric;
  next_min := (st->>'nextMin')::numeric;
  return jsonb_build_object(
    'enabled', true, 'mode', cfg->>'mode',
    'levelNo', lvl, 'levelName', st->>'levelName',
    'mult', case when st->>'status' = 'active' then greatest((st->>'mult')::numeric, coalesce((bv->>'birthMult')::numeric, 0)) else 1 end,
    'status', st->>'status', 'golden', (st->>'golden')::boolean,
    'renewAt', st->>'renewAt',
    'activeUntil', case when st->>'renewAt' is not null then ((st->>'renewAt')::date + (cfg->>'inactiveDays')::int)::text end,
    'downgradeAt', st->>'downgradeAt',
    'nextName', case when next_min is not null then cfg->'levels'->lvl->>'name' end,
    'toNext', case when next_min is not null then greatest(0, ceil(next_min - cum)) end,
    'pct', case when next_min is not null and next_min > cur_min
                then least(100, greatest(0, floor((cum - cur_min) * 100 / (next_min - cur_min))))
                else 100 end,
    'birth', bv);
end $$;
revoke all on function public.punpang_member_staff_card(text) from public, anon, authenticated;
grant execute on function public.punpang_member_staff_card(text) to authenticated;

select punpang_test.punpang_test_sync();
