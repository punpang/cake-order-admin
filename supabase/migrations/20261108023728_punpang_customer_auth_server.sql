-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108023728) · เนื้อตรงกับที่รันจริง

alter table public.punpang_customer_auth add column if not exists phone text;
alter table public.punpang_customer_auth add column if not exists pin_algo text not null default 'pbkdf2-sha256-210000';
alter table public.punpang_customer_auth add column if not exists created_at timestamptz not null default now();
create unique index if not exists punpang_customer_auth_phone_key on public.punpang_customer_auth (phone) where phone is not null;

create table public.punpang_otps (
  id text primary key,
  phone text not null,
  purpose text not null check (purpose in ('register','reset')),
  code_hash text not null,
  salt text not null,
  sent_at timestamptz not null default now(),
  expires_at timestamptz not null,
  attempts int not null default 0,
  verified_until timestamptz,
  used boolean not null default false,
  ip text not null default ''
);
create index punpang_otps_phone_idx on public.punpang_otps (phone, purpose, sent_at desc);
create index punpang_otps_ip_idx on public.punpang_otps (ip, sent_at desc);

create table public.punpang_customer_sessions (
  token_hash text primary key,
  customer_id text not null references public.punpang_customers(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_used timestamptz not null default now()
);
create index punpang_customer_sessions_cust_idx on public.punpang_customer_sessions (customer_id);

alter table public.punpang_otps enable row level security;
alter table public.punpang_customer_sessions enable row level security;
revoke all on public.punpang_otps, public.punpang_customer_sessions from public, anon, authenticated;
-- ไม่มี policy: เข้าถึงได้เฉพาะ service role (Edge Function customer-auth) เท่านั้น
