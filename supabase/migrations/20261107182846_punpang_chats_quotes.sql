-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107182846) · เนื้อตรงกับที่รันจริง

create table public.punpang_chats (
  id text primary key,
  channel text not null check (channel in ('line', 'facebook')),
  external_id text,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index punpang_chats_external_idx on public.punpang_chats (channel, external_id) where external_id is not null;
create index punpang_chats_customer_idx on public.punpang_chats (customer_id);

create table public.punpang_quotes (
  id text primary key,
  code text not null unique,
  chat_id text not null,
  customer_id text,
  status text not null,
  order_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index punpang_quotes_chat_idx on public.punpang_quotes (chat_id);

create or replace function public.punpang_touch_updated()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.punpang_touch_updated() from public, anon, authenticated;
create trigger punpang_chats_touch before update on public.punpang_chats for each row execute function public.punpang_touch_updated();
create trigger punpang_quotes_touch before update on public.punpang_quotes for each row execute function public.punpang_touch_updated();

alter table public.punpang_chats enable row level security;
alter table public.punpang_quotes enable row level security;
revoke all on public.punpang_chats, public.punpang_quotes from public, anon, authenticated;
grant select, insert, update, delete on public.punpang_chats, public.punpang_quotes to authenticated;

create policy chats_read on public.punpang_chats for select to authenticated using (public.punpang_has_perm('chat'));
create policy chats_ins on public.punpang_chats for insert to authenticated with check (public.punpang_has_perm('chat'));
create policy chats_upd on public.punpang_chats for update to authenticated using (public.punpang_has_perm('chat')) with check (public.punpang_has_perm('chat'));
create policy chats_del on public.punpang_chats for delete to authenticated using (public.punpang_has_perm('manage'));
create policy quotes_read on public.punpang_quotes for select to authenticated using (public.punpang_has_perm('chat'));
create policy quotes_ins on public.punpang_quotes for insert to authenticated with check (public.punpang_has_perm('chat'));
create policy quotes_upd on public.punpang_quotes for update to authenticated using (public.punpang_has_perm('chat')) with check (public.punpang_has_perm('chat'));
create policy quotes_del on public.punpang_quotes for delete to authenticated using (public.punpang_has_perm('manage'));
