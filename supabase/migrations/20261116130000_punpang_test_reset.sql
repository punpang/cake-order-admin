-- โหมดทดสอบ: ปุ่มล้างข้อมูลทดสอบ (ล้างเฉพาะสำเนา punpang_test แล้วใส่ชุดตัวอย่าง ~90 วัน · ข้อมูลจริงและข้อมูลร่วมไม่ถูกแตะ)
-- เฉพาะพนักงานที่มีสิทธิ์ manage · สำเนาใน punpang_test ถูกสร้างใหม่โดย punpang_test_sync ท้ายไฟล์นี้
create or replace function public.punpang_reset_test_data() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'เฉพาะแอดมินล้างข้อมูลทดสอบได้' using errcode = '42501';
  end if;
  truncate table punpang_test.punpang_records, punpang_test.punpang_customers,
    punpang_test.punpang_orders, punpang_test.punpang_chats, punpang_test.punpang_chat_presence,
    punpang_test.punpang_chat_topics, punpang_test.punpang_order_topics,
    punpang_test.punpang_order_audits, punpang_test.punpang_order_changes,
    punpang_test.punpang_order_issued, punpang_test.punpang_order_reviews,
    punpang_test.punpang_quotes, punpang_test.punpang_shifts, punpang_test.punpang_payments,
    punpang_test.punpang_counters, punpang_test.punpang_acct_entries,
    punpang_test.punpang_acct_invoices, punpang_test.punpang_acct_counters,
    punpang_test.punpang_acct_state, punpang_test.punpang_acct_frozen,
    punpang_test.punpang_sms_log, punpang_test.punpang_tg_log, punpang_test.punpang_cake_clicks
    restart identity;
  perform punpang_test.punpang_test_seed(); -- ชุดตัวอย่าง ~90 วัน (migration 20261116140000)
end $$;

revoke all on function public.punpang_reset_test_data() from public, anon;
grant execute on function public.punpang_reset_test_data() to authenticated, service_role;

select punpang_test.punpang_test_sync();
