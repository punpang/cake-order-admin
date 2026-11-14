-- เปลี่ยนเลขเวอร์ชันจาก 20261114040000 (ซ้ำกับ punpang_tungngern_title) · เนื้อหาไม่เปลี่ยน และรันซ้ำได้ปลอดภัย (if not exists / create or replace)
-- แจ้งเตือนลูกค้าบนแอป Android เมื่อพนักงานตอบกลับในแชท (เว็บ/แอป)
-- โทเค็นผูกกับเซสชันลูกค้า: ออกจากระบบ / หมดอายุ / ออกจากเครื่องอื่น → เซสชันถูกลบ → โทเค็นถูกลบตามอัตโนมัติ (on delete cascade)
-- ทริกเกอร์อยู่ที่ punpang_chats: เมื่อมีข้อความเพิ่มท้ายกระทู้เว็บ และข้อความนั้นเป็นของพนักงาน → เรียก push-send ด้วย chatId
-- push-send ตรวจข้อมูลจากฐานข้อมูลซ้ำอีกชั้น จึงไม่เชื่อค่าที่ทริกเกอร์ส่งมา

create table if not exists public.punpang_customer_push_devices (
  token text primary key,
  customer_id text not null references public.punpang_customers(id) on delete cascade,
  session_hash text not null references public.punpang_customer_sessions(token_hash) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);

create index if not exists punpang_customer_push_devices_cust_idx on public.punpang_customer_push_devices (customer_id);
create index if not exists punpang_customer_push_devices_sess_idx on public.punpang_customer_push_devices (session_hash);

alter table public.punpang_customer_push_devices enable row level security;
revoke all on public.punpang_customer_push_devices from public, anon, authenticated;
-- ไม่มี policy: เข้าถึงได้เฉพาะ service role (Edge Function customer-order / push-send)

create or replace function public.punpang_push_on_chat()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n_new int;
  n_old int := 0;
begin
  if new.channel is distinct from 'web' or new.customer_id is null then return new; end if;
  if jsonb_typeof(new.data->'messages') is distinct from 'array' then return new; end if;
  n_new := jsonb_array_length(new.data->'messages');
  if tg_op = 'UPDATE' then
    if jsonb_typeof(old.data->'messages') = 'array' then
      n_old := jsonb_array_length(old.data->'messages');
    end if;
  end if;
  -- ต้องมีข้อความเพิ่มท้ายกระทู้ และข้อความท้ายสุดนั้นเป็นของพนักงาน
  if n_new <= n_old then return new; end if;
  if (new.data->'messages'->(n_new - 1))->>'from' is distinct from 'staff' then return new; end if;
  perform net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := jsonb_build_object('chatId', new.id),
    timeout_milliseconds := 5000
  );
  return new;
end;
$$;

drop trigger if exists punpang_push_on_chat on public.punpang_chats;
create trigger punpang_push_on_chat
  after insert or update on public.punpang_chats
  for each row execute function public.punpang_push_on_chat();
