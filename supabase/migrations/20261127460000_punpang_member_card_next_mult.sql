-- การ์ดสมาชิกฝั่งลูกค้า: เพิ่มตัวคูณของระดับถัดไป (nextMult) · เป็นข้อมูลของลูกค้าเอง · ระดับสูงสุดเป็นค่าว่าง
create or replace function public.punpang_member_card(p_customer text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
  mv jsonb := coalesce((select k.data->'v' from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels'), '{}'::jsonb);
  has_cake boolean;
  nxt record;
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
  select (lv->>'name') as name, (lv->>'mult')::numeric as mult into nxt
    from jsonb_array_elements(coalesce(mv->'levels', '[]'::jsonb)) with ordinality as t(lv, ord)
   where ord = (st->>'level')::int + 1
   limit 1;
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
    'cum', (st->>'cum')::numeric,
    'nextMin', (st->>'nextMin')::numeric,
    'nextName', nxt.name,
    'nextMult', nxt.mult,
    'birth', bv || jsonb_build_object('cakeSet', has_cake)
  );
end $function$;
