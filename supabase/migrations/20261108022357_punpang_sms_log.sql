-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108022357) · เนื้อตรงกับที่รันจริง

create table public.punpang_sms_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  kind text not null default 'notify',
  to_tail text not null default '',
  status text not null check (status in ('sent','failed','blocked')),
  detail text not null default ''
);
create index punpang_sms_log_at_idx on public.punpang_sms_log (user_id, at desc);
alter table public.punpang_sms_log enable row level security;
revoke all on public.punpang_sms_log from public, anon, authenticated;
grant select on public.punpang_sms_log to authenticated;
create policy sms_log_read on public.punpang_sms_log for select to authenticated
  using (public.punpang_has_perm('manage'));
