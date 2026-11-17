-- ล้างข้อเสนอแนะจาก Supabase advisor (ไม่เปลี่ยนสิทธิ์และไม่แตะข้อมูล)
-- 1) สคีมาทดสอบมีดัชนีซ้ำ (ชื่อที่สร้างอัตโนมัติตอนคัดลอกโครงสร้าง) · เก็บชื่อที่ตรงกับ public ไว้ ลบตัวซ้ำ
-- 2) นโยบาย punpang_push_devices: ห่อ auth.uid() ด้วย select ให้คำนวณครั้งเดียวต่อคำสั่ง (ผลเหมือนเดิม)

drop index if exists punpang_test.punpang_acct_entries_entry_date_idx;
drop index if exists punpang_test.punpang_acct_frozen_entry_date_idx;
drop index if exists punpang_test.punpang_acct_invoices_order_id_idx;
drop index if exists punpang_test.punpang_chats_customer_id_idx;
drop index if exists punpang_test.punpang_chats_channel_external_id_idx;
drop index if exists punpang_test.punpang_customers_regexp_replace_idx;
drop index if exists punpang_test.punpang_order_changes_order_id_changed_at_idx;
drop index if exists punpang_test.punpang_order_reviews_order_id_reviewed_at_idx;
drop index if exists punpang_test.punpang_orders_data_idx;
drop index if exists punpang_test.punpang_orders_status_pickup_at_idx;
drop index if exists punpang_test.punpang_quotes_chat_id_idx;
drop index if exists punpang_test.punpang_records_collection_created_at_id_idx;
drop index if exists punpang_test.punpang_shifts_expr_idx;
drop index if exists punpang_test.punpang_shifts_opened_at_idx;
drop index if exists punpang_test.punpang_sms_log_user_id_at_idx;

alter policy push_devices_own_read on public.punpang_push_devices using (staff_id = (select auth.uid()));
alter policy push_devices_own_delete on public.punpang_push_devices using (staff_id = (select auth.uid()));
