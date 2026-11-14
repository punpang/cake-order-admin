-- แจ้งเตือนระบบบนแอป Android (พนักงาน): โทเค็น FCM ต่ออุปกรณ์ + ทริกเกอร์ส่งเมื่อมีกระดิ่งฝั่งพนักงานใหม่
-- อุปกรณ์เก็บโทเค็นผ่านฟังก์ชัน RPC เท่านั้น · พนักงานอ่าน/ลบได้เฉพาะของตัวเอง · ส่งแจ้งเตือนจริงทำโดย Edge Function push-send

create table if not exists public.punpang_push_devices (
  token text primary key,
  staff_id uuid not null references public.punpang_staff(user_id) on delete cascade,
  platform text not null default 'android',
  updated_at timestamptz not null default now()
);

alter table public.punpang_push_devices enable row level security;

drop policy if exists push_devices_own_read on public.punpang_push_devices;
create policy push_devices_own_read on public.punpang_push_devices
  for select to authenticated using (staff_id = auth.uid());

drop policy if exists push_devices_own_delete on public.punpang_push_devices;
create policy push_devices_own_delete on public.punpang_push_devices
  for delete to authenticated using (staff_id = auth.uid());

-- ลงทะเบียนโทเค็นของเครื่องนี้ให้พนักงานที่ล็อกอินอยู่ (โทเค็นเดียวกันของคนก่อนหน้าจะถูกย้ายมาเป็นของคนนี้)
create or replace function public.punpang_register_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.punpang_staff where user_id = auth.uid() and active) then
    raise exception 'not staff';
  end if;
  if coalesce(trim(p_token), '') = '' or length(p_token) > 4096 then raise exception 'invalid token'; end if;
  insert into public.punpang_push_devices (token, staff_id, platform, updated_at)
  values (p_token, auth.uid(), 'android', now())
  on conflict (token) do update set staff_id = excluded.staff_id, updated_at = excluded.updated_at;
end;
$$;

revoke all on function public.punpang_register_push_token(text) from public;
grant execute on function public.punpang_register_push_token(text) to authenticated;

-- กระดิ่งฝั่งพนักงานประเภทที่ต้องแจ้งเตือน → เรียก push-send (ส่งด้วย pg_net แบบไม่รอผล)
create or replace function public.punpang_push_on_bell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.collection = 'bell'
     and new.data->>'audience' = 'staff'
     and new.data->>'event' in ('team_new_order', 'team_customer_paid', 'chat_inbound', 'team_due_soon') then
    perform net.http_post(
      url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
      headers := jsonb_build_object('Content-Type', 'application/json'),
      body := jsonb_build_object('recordId', new.id),
      timeout_milliseconds := 5000
    );
  end if;
  return new;
end;
$$;

drop trigger if exists punpang_push_on_bell on public.punpang_records;
create trigger punpang_push_on_bell
  after insert on public.punpang_records
  for each row execute function public.punpang_push_on_bell();
