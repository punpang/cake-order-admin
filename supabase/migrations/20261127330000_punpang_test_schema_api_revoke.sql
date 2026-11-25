-- ปิด schema punpang_test จาก API: ระบบจริงไม่ได้ใช้โหมดทดสอบ (ยืนยันโดยผู้ใช้ 2026-11-25)
-- · ตัดสิทธิ์ USAGE ของบทบาท API (anon, authenticated) ทำให้ /rest/v1/rpc และตารางใน punpang_test เรียกไม่ได้
-- · ไม่ลบ schema และไม่แตะ public · บริการ service_role และการรันเทสต์ฐานข้อมูลไม่ได้รับผลกระทบ
-- · ย้อนกลับ: grant usage on schema punpang_test to anon, authenticated;

revoke usage on schema punpang_test from anon, authenticated;
