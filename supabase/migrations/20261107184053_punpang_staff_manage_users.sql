-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107184053) · เนื้อตรงกับที่รันจริง

alter table public.punpang_staff add column email text;
update public.punpang_staff s set email = u.email from auth.users u where u.id = s.user_id;

alter policy staff_manage_ins on public.punpang_staff with check (public.punpang_has_perm('manageUsers'));
alter policy staff_manage_upd on public.punpang_staff using (public.punpang_has_perm('manageUsers')) with check (public.punpang_has_perm('manageUsers'));
alter policy staff_manage_del on public.punpang_staff using (public.punpang_has_perm('manageUsers'));
alter policy staff_self_read on public.punpang_staff using (user_id = (select auth.uid()) or public.punpang_has_perm('manageUsers'));

-- กันล็อกระบบ: ต้องเหลือผู้ใช้ที่ใช้งานอยู่และมี manageUsers อย่างน้อย 1 คน
create or replace function public.punpang_staff_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare keeps boolean;
begin
  if tg_op = 'UPDATE' then
    new.user_id := old.user_id;
    new.created_at := old.created_at;
  end if;
  if old.active and 'manageUsers' = any (old.perms)
     and (tg_op = 'DELETE' or not (new.active and 'manageUsers' = any (new.perms))) then
    select exists (select 1 from public.punpang_staff s
      where s.user_id <> old.user_id and s.active and 'manageUsers' = any (s.perms)) into keeps;
    if not keeps then
      raise exception 'ต้องเหลือผู้ใช้ที่ใช้งานอยู่และมีสิทธิ์จัดการผู้ใช้อย่างน้อย 1 คน' using errcode = 'P0001';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.punpang_staff_guard() from public, anon, authenticated;
create trigger punpang_staff_guard before update or delete on public.punpang_staff
  for each row execute function public.punpang_staff_guard();

-- เพิ่มพนักงานจากอีเมลที่มีบัญชี Supabase Auth อยู่แล้ว (แอดมินสร้างบัญชีในหน้า Supabase ก่อน)
create or replace function public.punpang_staff_add(p_email text, p_name text, p_role text, p_perms text[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not public.punpang_has_perm('manageUsers') then
    raise exception 'ไม่มีสิทธิ์จัดการผู้ใช้' using errcode = '42501';
  end if;
  select u.id into uid from auth.users u where lower(u.email) = lower(trim(p_email)) limit 1;
  if uid is null then
    raise exception 'ไม่พบบัญชีอีเมลนี้ใน Supabase Auth (ให้สร้างบัญชีในหน้า Supabase ก่อน)' using errcode = 'P0002';
  end if;
  insert into public.punpang_staff (user_id, name, role, perms, active, email)
  values (uid, trim(p_name), p_role, coalesce(p_perms, '{}'), true, lower(trim(p_email)));
  return uid;
end $$;
revoke all on function public.punpang_staff_add(text, text, text, text[]) from public, anon;
grant execute on function public.punpang_staff_add(text, text, text, text[]) to authenticated;
