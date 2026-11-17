-- แจ้งเตือนพนักงานบนมือถือ: ส่ง push ครบทุกประเภทของกระดิ่งทีม (เดิมส่งเพียง 4 ประเภท)
-- · ข้อความลูกค้าจากเว็บ/แอป (team_customer_message) งานชำระ/ขอขยายเวลา/เกินกำหนด ขออนุมัติ แจ้งลูกค้าไม่สำเร็จ บอทส่งต่อ สลิป
--   และประเภทฝั่งบัญชี/POS/ผู้จัดการ จะถึงมือถือด้วย (กติกาสิทธิ์ตรงกับกระดิ่งในแอป)
-- · เปลี่ยนเฉพาะรายการประเภทในตัวกรองของทริกเกอร์ · ฟังก์ชันอื่นคงเดิม (SECURITY DEFINER, search_path ว่าง, กลืนข้อผิดพลาดของ pg_net)
-- · ประเภทที่ไม่อยู่ในรายการยังไม่ยิง push (เช่น some_other_event)
-- ลำดับ deploy: 1) deploy Edge Function push-send ก่อน (มีกติกาของประเภทใหม่ · ถ้าไม่ deploy ประเภทใหม่จะถูกข้ามอย่างเงียบ ๆ)
--               2) รันไฟล์นี้บนฐานข้อมูลจริง
-- ทดสอบ: supabase/tests/security.test.sql (D10) · Deno: supabase/functions/_shared/pushrules.test.ts

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
       'team_vat_due', 'team_expense_missing', 'team_installment_due'
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
