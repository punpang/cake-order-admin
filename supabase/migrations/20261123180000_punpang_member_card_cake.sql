-- บัตรลูกค้า: บอกส่วนลดเค้กเดือนเกิด (ต่อจาก 20261123170000)
-- punpang_member_card เพิ่ม birth.cakeSet = มีสินค้าเค้กที่ร้านเลือกแล้ว (หมวดหรือรายการ) · ค่าอื่นเหมือนเดิม
-- ลำดับ deploy: migration นี้ → deploy customer-auth (ส่ง birth ไปที่แอป)

create or replace function public.punpang_member_card(p_customer text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
  mv jsonb := coalesce((select k.data->'v' from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels'), '{}'::jsonb);
  has_cake boolean;
begin
  if cfg->>'mode' <> 'live' then return jsonb_build_object('enabled', false); end if;
  if not exists (select 1 from public.punpang_customers c
                  where c.id = p_customer and not coalesce((c.data->>'deleted')::boolean, false)) then
    return jsonb_build_object('enabled', false);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  bv := public.punpang__member_birth_view(st);
  has_cake := (jsonb_typeof(mv->'cakeCategories') = 'array' and jsonb_array_length(mv->'cakeCategories') > 0)
           or (jsonb_typeof(mv->'cakeItemIds') = 'array' and jsonb_array_length(mv->'cakeItemIds') > 0);
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
    'birth', bv || jsonb_build_object('cakeSet', has_cake)
  );
end $$;
revoke all on function public.punpang_member_card(text) from public, anon, authenticated;
grant execute on function public.punpang_member_card(text) to service_role;

-- สำเนาโหมดทดสอบ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
