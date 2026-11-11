-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108040924) · เนื้อตรงกับที่รันจริง

create table if not exists public.punpang_tg_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  user_id uuid,
  kind text not null default 'notify' check (kind in ('notify','test')),
  status text not null check (status in ('sent','failed','blocked')),
  detail text not null default ''
);
alter table public.punpang_tg_log enable row level security;
revoke all on public.punpang_tg_log from anon, authenticated;
create index if not exists punpang_tg_log_at_idx on public.punpang_tg_log (at desc);
