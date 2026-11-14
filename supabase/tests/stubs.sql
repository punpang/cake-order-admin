-- สภาพแวดล้อมจำลองของ Supabase สำหรับทดสอบ migration บน Postgres ธรรมดา (ไม่ใช่ส่วนหนึ่งของ migration จริง)
-- ใช้กับ supabase/tests/run.sh เท่านั้น · จำลอง: role, auth.uid(), storage, realtime, pg_cron, pg_net, vault และฟังก์ชันของแพลตฟอร์ม

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

create schema storage;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid default gen_random_uuid() primary key, bucket_id text, name text, owner uuid);
alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, service_role;
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;

create publication supabase_realtime;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase ให้สิทธิ์เริ่มต้นกับทุกตาราง/ฟังก์ชันใน public (migration จึงต้อง revoke เอง) · จำลองให้เหมือนกัน
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;

-- ฟังก์ชันของแพลตฟอร์ม Supabase ที่ migration อ้างถึงแต่รีโปไม่ได้สร้าง
create function public.rls_auto_enable() returns void language sql as 'select 1';

create schema cron;
create function cron.schedule(text, text, text) returns bigint language sql as 'select 1::bigint';
create function cron.unschedule(text) returns boolean language sql as 'select true';

create schema vault;
create view vault.decrypted_secrets as select 'scheduled_key'::text as name, 'test-secret'::text as decrypted_secret;

-- pg_net จำลอง: บันทึกคำเรียกไว้ให้เทสต์ตรวจ · ตั้ง test.net_fail = 'on' เพื่อจำลองว่าเรียกไม่สำเร็จ
create schema test;
create table test.net_calls (id bigserial primary key, at timestamptz default now(), url text, body jsonb);
create schema net;
create function net.http_post(url text, headers jsonb default '{}', body jsonb default '{}', timeout_milliseconds int default 1000)
returns bigint language plpgsql as $$
begin
  if current_setting('test.net_fail', true) = 'on' then
    raise exception 'simulated pg_net failure';
  end if;
  insert into test.net_calls (url, body) values (url, body);
  return 1;
end $$;
