-- กันการดูส่วนลดวันเกิดของลูกค้าคนอื่น: punpang__birth_discount_expected ตอบ 0 สำหรับผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงาน
-- เดิมผู้ใช้ล็อกอินคนใดก็เรียกได้พร้อมรหัสลูกค้าใดก็ได้ (พบจากการตรวจความปลอดภัย) · ทริกเกอร์ punpang_orders_insert_guard ยังเรียกได้ตามเดิม
-- คงสิทธิ์เดิม: เรียกได้เฉพาะ authenticated (ทริกเกอร์ทำงานด้วยสิทธิ์ผู้เขียน) และเจ้าของฟังก์ชันยังเป็นผู้รัน (security definer)

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
  -- ผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงานที่ใช้งานอยู่ ไม่ควรดูส่วนลดวันเกิดของลูกค้าคนอื่นได้ ตอบ 0
  -- (ทริกเกอร์สร้างออร์เดอร์ยังเรียกได้ตามปกติ · ผู้เรียกฝั่งเซิร์ฟเวอร์ที่ไม่มี uid ไม่ถูกกระทบ)
  if (select auth.uid()) is not null and not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then
    return 0;
  end if;
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
