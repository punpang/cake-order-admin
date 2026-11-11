-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108043838) · เนื้อตรงกับที่รันจริง

-- เพจ Facebook ที่เชื่อมอยู่ (1 แถว = 1 เพจ) · token ใช้ได้เฉพาะ service role (Edge Function)
create table if not exists public.punpang_fb_pages (
  page_id text primary key,
  name text not null default '',
  token text not null,
  connected_by uuid,
  connected_at timestamptz not null default now()
);
-- สถานะ OAuth ชั่วคราว (state + เพจที่เลือกได้หลังอนุญาต) หมดอายุเร็ว
create table if not exists public.punpang_fb_oauth (
  nonce_hash text primary key,
  user_id uuid not null,
  expires_at timestamptz not null,
  stage text not null default 'started' check (stage in ('started','pages')),
  pages jsonb not null default '[]'::jsonb
);
alter table public.punpang_fb_pages enable row level security;
alter table public.punpang_fb_oauth enable row level security;
revoke all on public.punpang_fb_pages from anon, authenticated;
revoke all on public.punpang_fb_oauth from anon, authenticated;
