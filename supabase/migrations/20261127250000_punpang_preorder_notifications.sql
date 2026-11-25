-- สั่งล่วงหน้า: กันการแจ้งเตือนซ้ำ (แผนการแจ้งเตือนลูกค้า Task 1)
-- ตาราง punpang_preorder_notifications เก็บการจองสิทธิ์ส่ง (pending) และผลส่งแล้ว (sent) ต่อออเดอร์+เหตุการณ์
-- ดัชนีไม่ซ้ำเฉพาะแถวที่ยังจองอยู่ (pending/sent) จึงกันการส่งซ้ำได้ และการส่งล้มเหลวปลดการจองให้ลองใหม่ได้
-- ตารางนี้เข้าถึงได้เฉพาะ service_role ผ่านฟังก์ชันด้านล่าง

create table if not exists public.punpang_preorder_notifications (
  id bigserial primary key,
  order_id text not null,
  event text not null,
  channel text check (channel in ('line', 'sms')),
  status text not null check (status in ('pending', 'sent')),
  created_at timestamptz not null default now()
);

create unique index if not exists punpang_preorder_notifications_open_uq
  on public.punpang_preorder_notifications (order_id, event)
  where status in ('pending', 'sent');

alter table public.punpang_preorder_notifications enable row level security;
revoke all on public.punpang_preorder_notifications from public, anon, authenticated;

-- จองสิทธิ์ส่ง: true = ได้สิทธิ์ส่งครั้งนี้ · false = เคยจองหรือส่งแล้ว
create or replace function public.punpang_preorder_notify_claim(p_order text, p_event text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into public.punpang_preorder_notifications (order_id, event, status)
    values (p_order, p_event, 'pending')
    on conflict (order_id, event) where status in ('pending', 'sent') do nothing;
  return found;
end $$;

-- ส่งไม่สำเร็จ: ปลดการจองให้รอบถัดไปลองใหม่ได้
create or replace function public.punpang_preorder_notify_release(p_order text, p_event text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  delete from public.punpang_preorder_notifications where order_id = p_order and event = p_event and status = 'pending';
  return found;
end $$;

-- ส่งสำเร็จ: บันทึกช่องทางและล็อกไม่ให้ส่งซ้ำ
create or replace function public.punpang_preorder_notify_mark_sent(p_order text, p_event text, p_channel text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if p_channel not in ('line', 'sms') then return false; end if;
  update public.punpang_preorder_notifications set status = 'sent', channel = p_channel
    where order_id = p_order and event = p_event and status = 'pending';
  return found;
end $$;

revoke all on function public.punpang_preorder_notify_claim(text, text) from public, anon, authenticated;
revoke all on function public.punpang_preorder_notify_release(text, text) from public, anon, authenticated;
revoke all on function public.punpang_preorder_notify_mark_sent(text, text, text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_notify_claim(text, text) to service_role;
grant execute on function public.punpang_preorder_notify_release(text, text) to service_role;
grant execute on function public.punpang_preorder_notify_mark_sent(text, text, text) to service_role;

-- โหมดทดสอบ: ตารางการแจ้งเตือนเป็น iso (ไม่ซิงก์ข้อมูลจริง) แล้วซิงก์นิยามใหม่
do $$
declare d text; n text; pat text := '''punpang_preorder_sessions''];';
begin
  d := pg_get_functiondef('punpang_test.punpang_test_sync()'::regprocedure);
  if position('''punpang_preorder_notifications''' in d) > 0 then return; end if;
  if (length(d) - length(replace(d, pat, ''))) / length(pat) <> 1 then
    raise exception 'ไม่พบรายการ iso ที่คาดไว้ใน punpang_test_sync (ตรวจ migration โหมดทดสอบ)';
  end if;
  n := replace(d, pat, '''punpang_preorder_sessions'', ''punpang_preorder_notifications''];');
  execute n;
end $$;
select punpang_test.punpang_test_sync();
