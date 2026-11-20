-- เพดานการลองรหัส PIN ผิดต่อวันต่อบัญชี (เวลาไทย) · เก็บตัวนับรายวันในแถวเดียวกับตัวนับเดิม (failed / locked_until)
-- day_key = วันที่ของตัวนับ · day_fails = จำนวนครั้งที่ลองผิดติดกันในวันนั้น (เข้าสู่ระบบสำเร็จหรือรีเซ็ตแล้วล้างเป็น 0)
-- ลำดับ deploy: migration นี้ก่อน แล้วค่อย deploy customer-auth (ฟังก์ชันอ่าน/เขียนสองคอลัมน์นี้)
alter table public.punpang_customer_auth
  add column if not exists day_key text,
  add column if not exists day_fails integer not null default 0;
