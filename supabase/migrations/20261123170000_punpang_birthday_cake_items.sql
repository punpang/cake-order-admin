-- ส่วนลดเดือนเกิด: เลือกสินค้าเองได้ (ต่อจาก 20261123160000)
-- เค้กที่นับ = สินค้าในหมวดที่ร้านเลือก + สินค้าที่ร้านเลือกเองจากรายการ (config/memberLevels.cakeItemIds)
-- punpang__birth_discount_expected และ punpang_member_birth_for_quote อัปเดตให้รู้จัก cakeItemIds (กติกาอื่นเหมือนเดิม)

create or replace function public.punpang__birth_discount_expected(p_customer text, p_items jsonb)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
  mv jsonb := coalesce((select k.data->'v' from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels'), '{}'::jsonb);
  cats jsonb := case when jsonb_typeof(mv->'cakeCategories') = 'array' then mv->'cakeCategories' else '[]'::jsonb end;
  ids jsonb := case when jsonb_typeof(mv->'cakeItemIds') = 'array' then mv->'cakeItemIds' else '[]'::jsonb end;
  base numeric := 0;
  amt numeric;
begin
  if cfg->>'mode' <> 'live' or (jsonb_array_length(cats) = 0 and jsonb_array_length(ids) = 0) then return 0; end if;
  st := public.punpang__member_fold(p_customer, now());
  bv := public.punpang__member_birth_view(st);
  if (bv->>'rate')::numeric <= 0 then return 0; end if;
  select coalesce(sum(
           (case when (it->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' then (it->>'unitPrice')::numeric else 0 end)
         * (case when (it->>'qty') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'qty')::numeric else 0 end)), 0)
    into base
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) it
    join public.punpang_items pi on pi.id = it->>'retailId' and pi.kind = 'retail'
   where (pi.data->>'category') in (select jsonb_array_elements_text(cats))
      or pi.id in (select jsonb_array_elements_text(ids));
  amt := round(base * (bv->>'rate')::numeric / 100, 2);
  return least(amt, (bv->>'cap')::numeric);
end $$;
revoke all on function public.punpang__birth_discount_expected(text, jsonb) from public, anon;
grant execute on function public.punpang__birth_discount_expected(text, jsonb) to authenticated;

create or replace function public.punpang_member_birth_for_quote(p_customer text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  mv jsonb := coalesce((select k.data->'v' from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels'), '{}'::jsonb);
  cats jsonb := case when jsonb_typeof(mv->'cakeCategories') = 'array' then mv->'cakeCategories' else '[]'::jsonb end;
  ids jsonb := case when jsonb_typeof(mv->'cakeItemIds') = 'array' then mv->'cakeItemIds' else '[]'::jsonb end;
begin
  if p_customer is null or cfg->>'mode' <> 'live' then
    return jsonb_build_object('eligible', false, 'active', false, 'rate', 0, 'cap', 0, 'birthMult', null, 'cakeCategories', cats, 'cakeItemIds', ids);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  return public.punpang__member_birth_view(st) || jsonb_build_object('cakeCategories', cats, 'cakeItemIds', ids);
end $$;
revoke all on function public.punpang_member_birth_for_quote(text) from public, anon, authenticated;
grant execute on function public.punpang_member_birth_for_quote(text) to service_role;

-- สำเนาโหมดทดสอบ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
