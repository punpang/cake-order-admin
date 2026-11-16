-- LINE Official Account · บอทอย่างเดียว ไม่มีโหมดพนักงานตอบ
-- ตารางผู้ใช้ LINE และประวัติข้อความ: เขียนโดย Edge Function line-webhook (service role) · พนักงานอ่านอย่างเดียวตามสิทธิ์แชท (chat)
-- นำขึ้นฐานข้อมูลจริงด้วย workflow "Deploy DB LINE" (พิมพ์ RUN) เท่านั้น ไม่ได้นำขึ้นตอน merge

create table if not exists public.punpang_line_users (
  line_user_id text primary key,
  display_name text not null default '',
  followed boolean not null default true,
  customer_id text null,
  last_message_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.punpang_line_messages (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null references public.punpang_line_users (line_user_id) on delete cascade,
  direction text not null check (direction in ('in', 'out')),
  kind text not null default 'text',
  text text not null default '',
  source text not null default '',
  webhook_event_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists punpang_line_messages_user_time_idx on public.punpang_line_messages (line_user_id, created_at);
create index if not exists punpang_line_users_last_idx on public.punpang_line_users (last_message_at desc nulls last);

alter table public.punpang_line_users enable row level security;
alter table public.punpang_line_messages enable row level security;

drop policy if exists punpang_line_users_read on public.punpang_line_users;
create policy punpang_line_users_read on public.punpang_line_users
  for select to authenticated using (public.punpang_has_perm('chat'));

drop policy if exists punpang_line_messages_read on public.punpang_line_messages;
create policy punpang_line_messages_read on public.punpang_line_messages
  for select to authenticated using (public.punpang_has_perm('chat'));

revoke all on public.punpang_line_users from anon;
revoke all on public.punpang_line_messages from anon;
grant select on public.punpang_line_users to authenticated;
grant select on public.punpang_line_messages to authenticated;
