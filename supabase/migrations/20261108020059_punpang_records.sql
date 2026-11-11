-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108020059) · เนื้อตรงกับที่รันจริง

create table public.punpang_records (
  collection text not null check (collection in ('reviews','coupons','spinLog','photoRequests','deletionRequests','birthdayGreeted','notifySent','shortLinks','outbox','bell','orderLinks','consents','chatDrafts')),
  id text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  primary key (collection, id)
);
create index punpang_records_order_idx on public.punpang_records (collection, created_at desc, id);

create or replace function public.punpang_rec_can(c text, w boolean)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.punpang_staff s
    where s.user_id = (select auth.uid()) and s.active and (
      s.perms && array['manage']
      or case c
        when 'reviews'          then (not w and s.perms && array['viewAllOrders'])
        when 'coupons'          then s.perms && array['useLoyalty','adjustPoints']
        when 'spinLog'          then s.perms && array['useLoyalty','adjustPoints']
        when 'birthdayGreeted'  then s.perms && array['birthdays']
        when 'notifySent'       then true
        when 'bell'             then true
        when 'outbox'           then (w or s.perms && array['chat','viewAllOrders'])
        when 'consents'         then (w or s.perms && array['viewAllOrders','createOrder'])
        when 'orderLinks'       then s.perms && array['createOrder','viewAllOrders','sendToPayment']
        when 'chatDrafts'       then s.perms && array['chat']
        else false end));
$$;
revoke all on function public.punpang_rec_can(text, boolean) from public, anon;
grant execute on function public.punpang_rec_can(text, boolean) to authenticated;

alter table public.punpang_records enable row level security;
revoke all on public.punpang_records from public, anon, authenticated;
grant select on public.punpang_records to anon;
grant select, insert, update, delete on public.punpang_records to authenticated;

create policy rec_public_read on public.punpang_records for select to anon, authenticated
  using ((collection = 'reviews' and data->>'status' = 'approved') or collection = 'shortLinks');
create policy rec_read on public.punpang_records for select to authenticated
  using (public.punpang_rec_can(collection, false));
create policy rec_ins on public.punpang_records for insert to authenticated
  with check (public.punpang_rec_can(collection, true));
create policy rec_upd on public.punpang_records for update to authenticated
  using (public.punpang_rec_can(collection, true)) with check (public.punpang_rec_can(collection, true));
create policy rec_del on public.punpang_records for delete to authenticated
  using (public.punpang_rec_can(collection, true));
