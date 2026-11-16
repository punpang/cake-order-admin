-- โหมดทดสอบ: แถวตั้งต้นของสถานะปิดงวดบัญชี (punpang_acct_state id = 1)
-- การล้างข้อมูลทดสอบ truncate ตารางนี้ด้วย แอปต้องมีแถวนี้เสมอ ไม่เช่นนั้นโหลดข้อมูลบัญชีไม่สำเร็จ
-- ไฟล์นี้ (1) เติมแถวให้สำเนาที่ถูกล้างไปแล้ว และ (2) ปรับปุ่มล้างข้อมูลทดสอบให้เติมแถวนี้ทุกครั้งหลัง truncate
-- รันซ้ำได้: ไม่ลบข้อมูลทดสอบ และไม่แตะข้อมูลจริง

insert into punpang_test.punpang_acct_state (id) values (1) on conflict (id) do nothing;

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
  insert into punpang_test.punpang_acct_state (id) values (1) on conflict (id) do nothing; -- แถวตั้งต้นของสถานะปิดงวด
  perform punpang_test.punpang_test_seed(); -- ชุดตัวอย่าง ~90 วัน (migration 20261116140000)
end $$;

revoke all on function public.punpang_reset_test_data() from public, anon;
grant execute on function public.punpang_reset_test_data() to authenticated, service_role;
