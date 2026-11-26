-- ปิดสิทธิ์ EXECUTE ของ authenticated สำหรับฟังก์ชันเครื่องมือทดสอบที่ไม่มีที่เรียกใช้ในโค้ด
-- · punpang_reset_test_data: เครื่องมือทดสอบ ไม่มีการเรียกจากโค้ด schema punpang_test ว่างแล้ว
-- ไม่แตะ punpang_set_status (ชุดทดสอบ security/status_reversal ใช้เป็นช่องทางสถานะที่ตั้งใจไว้) punpang_acct_can (ใช้ใน RLS) และ punpang__birth_discount_expected (ถูกเรียกจากฟังก์ชันอื่น)
-- ย้อนกลับได้ด้วย grant execute ... to authenticated

revoke execute on function public.punpang_reset_test_data() from authenticated;
