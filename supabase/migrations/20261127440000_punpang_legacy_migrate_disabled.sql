-- ปิดการย้ายแบบพนักงาน: ทุกเบอร์ที่เข้าเงื่อนไขถูกจับคู่อัตโนมัติแล้ว (trigger) จึงไม่ต้องป้อนแต้มเอง
create or replace function public.punpang_legacy_migrate(p_customer text, p_old_points integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('adjustPoints') then raise exception 'forbidden' using errcode = '42501'; end if;
  return jsonb_build_object('error', 'disabled');
end $$;

revoke all on function public.punpang_legacy_migrate(text, integer) from public, anon;
grant execute on function public.punpang_legacy_migrate(text, integer) to authenticated;
