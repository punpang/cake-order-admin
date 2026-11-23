-- ส่วนลดเดือนเกิดบนเว็บและใบเสนอ (รอบ 2 · ต่อจาก 20261123150000)
-- punpang_member_birth_for_quote: สิทธิเดือนเกิดของลูกค้าสำหรับ order-create / quote-create (บริการเท่านั้น)
-- คืน { eligible, active, rate, cap, birthMult, cakeCategories } · โหมดไม่ใช่ใช้จริง/ไม่มีลูกค้า = ไม่มีสิทธิ (rate 0)
-- ลำดับ deploy: migration นี้ → deploy order-create และ quote-create → แอป

create or replace function public.punpang_member_birth_for_quote(p_customer text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  cats jsonb;
begin
  cats := coalesce((select k.data->'v'->'cakeCategories' from public.punpang_kv k
                     where k.collection = 'config' and k.id = 'memberLevels'), '[]'::jsonb);
  if jsonb_typeof(cats) is distinct from 'array' then cats := '[]'::jsonb; end if;
  if p_customer is null or cfg->>'mode' <> 'live' then
    return jsonb_build_object('eligible', false, 'active', false, 'rate', 0, 'cap', 0, 'birthMult', null, 'cakeCategories', cats);
  end if;
  st := public.punpang__member_fold(p_customer, now());
  return public.punpang__member_birth_view(st) || jsonb_build_object('cakeCategories', cats);
end $$;
revoke all on function public.punpang_member_birth_for_quote(text) from public, anon, authenticated;
grant execute on function public.punpang_member_birth_for_quote(text) to service_role;

-- สำเนาโหมดทดสอบ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
