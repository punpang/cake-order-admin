-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107183729) · เนื้อตรงกับที่รันจริง

create table public.punpang_shifts (
  id text primary key,
  opened_at timestamptz not null,
  closed_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index punpang_shifts_one_open on public.punpang_shifts ((1)) where closed_at is null;
create index punpang_shifts_opened_idx on public.punpang_shifts (opened_at desc);

create or replace function public.punpang_shifts_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if old.closed_at is not null then
      raise exception 'กะที่ปิดแล้วแก้ไขไม่ได้' using errcode = 'P0001';
    end if;
    new.id := old.id; new.opened_at := old.opened_at; new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end $$;
revoke all on function public.punpang_shifts_guard() from public, anon, authenticated;
create trigger punpang_shifts_guard before update on public.punpang_shifts for each row execute function public.punpang_shifts_guard();

alter table public.punpang_shifts enable row level security;
revoke all on public.punpang_shifts from public, anon, authenticated;
grant select, insert, update on public.punpang_shifts to authenticated;
create policy shifts_read on public.punpang_shifts for select to authenticated
  using (public.punpang_has_perm('pos') or public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('manage'));
create policy shifts_ins on public.punpang_shifts for insert to authenticated with check (public.punpang_has_perm('pos'));
create policy shifts_upd on public.punpang_shifts for update to authenticated
  using (public.punpang_has_perm('pos')) with check (public.punpang_has_perm('pos'));
