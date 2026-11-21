-- แจ้งกระดิ่งผู้จัดการเมื่อมีออร์เดอร์เข้าคิวรอตรวจ (ประเภท team_order_review)
-- · ทริกเกอร์ AFTER INSERT บน punpang_sync_review แทรกแถวกระดิ่ง (collection bell) แล้วทริกเกอร์ punpang_push_on_bell ส่ง push ต่อเอง
-- · ข้อความมีเฉพาะรหัสออร์เดอร์ ไม่มีชื่อลูกค้า ยอดเงิน หรือ payload เพราะช่องทาง staff แสดงบนหน้าจอล็อก
-- · การแทรกกระดิ่งล้มเหลวได้โดยไม่ทำให้การเพิ่มคิวล้มเหลว (exception block)
-- · ลำดับ deploy: 1) deploy Edge Function push-send ก่อน (มีกติกาของประเภทใหม่ · ถ้าไม่ deploy ประเภทใหม่จะถูกข้ามอย่างเงียบ ๆ)
--                2) รันไฟล์นี้บนฐานข้อมูลจริง
-- · ประเภทใหม่ถูกเพิ่มในรายการของ punpang_push_on_bell (นิยามเดิมจาก 20261117150000 คงทุกส่วนเดิม)
-- · ทดสอบ: supabase/tests/sync_review.test.sql (SR26–SR28) · Deno: supabase/functions/_shared/pushrules.test.ts

create or replace function public.punpang_sync_review_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    insert into public.punpang_records (collection, id, data)
    values (
      'bell',
      'bl_rv_' || replace(new.id::text, '-', ''),
      jsonb_build_object(
        'audience', 'staff',
        'event', 'team_order_review',
        'title', 'ออร์เดอร์รอตรวจ',
        'text', coalesce(nullif(new.order_code, ''), 'ออร์เดอร์') || ' · รอผู้จัดการตรวจ',
        'readBy', '[]'::jsonb,
        'at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      )
    )
    on conflict do nothing;
  exception when others then
    null; -- แจ้งเตือนไม่ออก ไม่ทำให้การเพิ่มคิวล้ม
  end;
  return new;
end;
$$;

revoke all on function public.punpang_sync_review_notify() from public, anon, authenticated;

drop trigger if exists punpang_sync_review_notify on public.punpang_sync_review;
create trigger punpang_sync_review_notify
  after insert on public.punpang_sync_review
  for each row execute function public.punpang_sync_review_notify();

create or replace function public.punpang_push_on_bell()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  k text;
begin
  if new.collection = 'bell'
     and new.data->>'audience' = 'staff'
     and new.data->>'event' in (
       'team_customer_paid', 'team_customer_message', 'team_pay_extend_request', 'team_pay_overdue',
       'team_new_order', 'team_approval_request', 'team_due_soon', 'chat_inbound', 'notify_failed',
       'bot_handoff', 'slip_check', 'team_photo_optout', 'deletion_request', 'team_coupon_shown',
       'team_vat_due', 'team_expense_missing', 'team_installment_due', 'team_order_review'
     ) then
    begin
      select s.decrypted_secret into k from vault.decrypted_secrets s where s.name = 'push_send_key' limit 1;
      perform net.http_post(
        url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/push-send',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-key', coalesce(k, '')),
        body := jsonb_build_object('recordId', new.id),
        timeout_milliseconds := 5000
      );
    exception when others then
      null; -- แจ้งเตือนไม่ออก ไม่ทำให้การเพิ่มกระดิ่งล้ม
    end;
  end if;
  return new;
end;
$$;

revoke all on function public.punpang_push_on_bell() from public, anon, authenticated;

-- ให้สำเนาทดสอบ (punpang_test) ได้นิยามใหม่ของฟังก์ชันและทริกเกอร์ด้วย
select punpang_test.punpang_test_sync();
