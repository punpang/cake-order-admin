-- นับการเข้าชมหน้าเว็บลูกค้า: ตัวนับรวมต่อวัน (เวลาไทย) เก็บใน punpang_kv collection 'pageViews' id = วันที่ YYYY-MM-DD
-- ไม่เก็บ IP คุกกี้ รหัสผู้ใช้ หรือข้อมูลส่วนตัวใด ๆ · เพิ่มค่าแบบอะตอมิก
-- punpang_record_pageview: anon/authenticated เรียกได้ (หน้าเว็บลูกค้า) · punpang_pageview_stats: เฉพาะพนักงานที่มีสิทธิ์จัดการหรือดูออร์เดอร์ทั้งหมด

create or replace function public.punpang_record_pageview(p_day text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_day is null or p_day !~ '^\d{4}-\d{2}-\d{2}$' then
    return;
  end if;
  insert into public.punpang_kv (collection, id, data)
  values ('pageViews', p_day, jsonb_build_object('n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object('n', coalesce((public.punpang_kv.data->>'n')::integer, 0) + 1);
end;
$$;

revoke all on function public.punpang_record_pageview(text) from public;
grant execute on function public.punpang_record_pageview(text) to anon, authenticated;

create or replace function public.punpang_pageview_stats(p_from text, p_to text)
returns table(day_key text, views integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.punpang_staff s
    where s.user_id = (select auth.uid()) and s.active
      and s.perms && array['manage', 'viewAllOrders']
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
    select k.id, coalesce((k.data->>'n')::integer, 0)
    from public.punpang_kv k
    where k.collection = 'pageViews' and k.id between p_from and p_to
    order by k.id;
end;
$$;

revoke all on function public.punpang_pageview_stats(text, text) from public, anon;
grant execute on function public.punpang_pageview_stats(text, text) to authenticated;
