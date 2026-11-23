-- ระดับสมาชิก: ความคืบหน้าขั้นถัดไปบนป้ายระดับ (ต่อจาก 20261122110200)
-- punpang_member_staff_card เพิ่ม nextName (ชื่อระดับถัดไป) · toNext (ยอดที่ต้องซื้อเพิ่มถึงขั้นถัดไป ก่อน VAT ปัดขึ้น) · pct (ความคืบหน้า 0–100 ในขั้นปัจจุบัน)
-- ไม่ส่งยอดสะสม (cum) ออกไป · ระดับสูงสุดได้ nextName/toNext = null และ pct = 100
-- ใช้กับจอลูกค้า (แสดงเฉพาะโหมดใช้จริง ฝั่งแอป) · สิทธิ์และโหมดเหมือนเดิมทุกประการ

create or replace function public.punpang_member_staff_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
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
  lvl := (st->>'level')::int;
  cum := (st->>'cum')::numeric;
  cur_min := (cfg->'levels'->(lvl - 1)->>'min')::numeric;
  next_min := (st->>'nextMin')::numeric;
  return jsonb_build_object(
    'enabled', true, 'mode', cfg->>'mode',
    'levelNo', lvl, 'levelName', st->>'levelName',
    'mult', case when st->>'status' = 'active' then (st->>'mult')::numeric else 1 end,
    'status', st->>'status', 'golden', (st->>'golden')::boolean,
    'renewAt', st->>'renewAt',
    'activeUntil', case when st->>'renewAt' is not null then ((st->>'renewAt')::date + (cfg->>'inactiveDays')::int)::text end,
    'downgradeAt', st->>'downgradeAt',
    'nextName', case when next_min is not null then cfg->'levels'->lvl->>'name' end,
    'toNext', case when next_min is not null then greatest(0, ceil(next_min - cum)) end,
    'pct', case when next_min is not null and next_min > cur_min
                then least(100, greatest(0, floor((cum - cur_min) * 100 / (next_min - cur_min))))
                else 100 end);
end $$;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่ไปยังสำเนา punpang_test
select punpang_test.punpang_test_sync();
