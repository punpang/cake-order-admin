-- ระบบ Facebook / แชท: เขียนย้อนจากสคีมาที่ใช้งานจริงอยู่ในโปรเจกต์ punpang
-- ใช้ if not exists / drop policy if exists ทั้งหมด → รันซ้ำบนฐานข้อมูลที่มีตารางแล้วไม่เปลี่ยนแปลงข้อมูล
-- ตาราง punpang_fb_pages และ punpang_fb_oauth เก็บ token ของ Facebook: เปิด RLS และ "ไม่มี policy" โดยตั้งใจ
-- → เฉพาะ service role (Edge Functions fb-connect / fb-send / fb-webhook) อ่านเขียนได้ ผู้ใช้ทั่วไปและ anon เข้าไม่ได้

-- ---------- แชท (LINE / Facebook) ----------
create table if not exists public.punpang_chats (
  id text primary key,
  channel text not null check (channel in ('line', 'facebook')),
  external_id text,
  customer_id text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists punpang_chats_external_idx on public.punpang_chats (channel, external_id) where external_id is not null;
create index if not exists punpang_chats_customer_idx on public.punpang_chats (customer_id);
alter table public.punpang_chats enable row level security;

drop policy if exists chats_read on public.punpang_chats;
create policy chats_read on public.punpang_chats for select to authenticated using (punpang_has_perm('chat'::text));
drop policy if exists chats_ins on public.punpang_chats;
create policy chats_ins on public.punpang_chats for insert to authenticated with check (punpang_has_perm('chat'::text));
drop policy if exists chats_upd on public.punpang_chats;
create policy chats_upd on public.punpang_chats for update to authenticated using (punpang_has_perm('chat'::text)) with check (punpang_has_perm('chat'::text));
drop policy if exists chats_del on public.punpang_chats;
create policy chats_del on public.punpang_chats for delete to authenticated using (punpang_has_perm('manage'::text));

-- ---------- ใบเสนอราคาในแชท ----------
create table if not exists public.punpang_quotes (
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
create index if not exists punpang_quotes_chat_idx on public.punpang_quotes (chat_id);
alter table public.punpang_quotes enable row level security;

drop policy if exists quotes_read on public.punpang_quotes;
create policy quotes_read on public.punpang_quotes for select to authenticated using (punpang_has_perm('chat'::text));
drop policy if exists quotes_ins on public.punpang_quotes;
create policy quotes_ins on public.punpang_quotes for insert to authenticated with check (punpang_has_perm('chat'::text));
drop policy if exists quotes_upd on public.punpang_quotes;
create policy quotes_upd on public.punpang_quotes for update to authenticated using (punpang_has_perm('chat'::text)) with check (punpang_has_perm('chat'::text));
drop policy if exists quotes_del on public.punpang_quotes;
create policy quotes_del on public.punpang_quotes for delete to authenticated using (punpang_has_perm('manage'::text));

-- ---------- เพจ Facebook ที่เชื่อมไว้ (เชื่อมได้ครั้งละ 1 เพจ) · token อยู่ที่นี่เท่านั้น ----------
create table if not exists public.punpang_fb_pages (
  page_id text primary key,
  name text not null default '',
  token text not null,
  connected_by uuid,
  connected_at timestamptz not null default now()
);
alter table public.punpang_fb_pages enable row level security;

-- ---------- สถานะการเชื่อม OAuth ชั่วคราว (state เก็บเป็น hash · ใช้ได้ครั้งเดียว) ----------
create table if not exists public.punpang_fb_oauth (
  nonce_hash text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  stage text not null default 'started' check (stage in ('started', 'pages')),
  pages jsonb not null default '[]'::jsonb
);
alter table public.punpang_fb_oauth enable row level security;
