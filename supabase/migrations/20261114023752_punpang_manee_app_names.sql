-- รายชื่อแอปที่ถือว่าเป็นแม่มณี (ชื่อที่แสดงบนโทรศัพท์) · ตั้งได้จากหน้าทดสอบ /admin/manee-test · อ่าน/เพิ่ม/ลบได้เฉพาะพนักงานที่มีสิทธิ์ pos
create table if not exists public.manee_app_names (
  name text primary key check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table public.manee_app_names enable row level security;
create policy manee_app_names_pos_read on public.manee_app_names for select to authenticated using (public.punpang_has_perm('pos'));
create policy manee_app_names_pos_write on public.manee_app_names for insert to authenticated with check (public.punpang_has_perm('pos'));
create policy manee_app_names_pos_delete on public.manee_app_names for delete to authenticated using (public.punpang_has_perm('pos'));
insert into public.manee_app_names (name) values ('แม่มณี') on conflict do nothing;
