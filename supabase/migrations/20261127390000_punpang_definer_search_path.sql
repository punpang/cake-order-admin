-- ตั้ง search_path ของฟังก์ชัน SECURITY DEFINER สองตัวที่ยังเป็น 'public' ให้เป็นค่าว่าง
-- เหมือนฟังก์ชันอื่น เพื่อกันการแทรกชื่อฟังก์ชันจาก schema ที่ไม่ตั้งใจ
-- ตัวฟังก์ชันอ้างชื่อทุกตัวแบบ public./auth. อยู่แล้ว จึงไม่กระทบการทำงาน
alter function public.punpang_chat_bot_claim(text, text) set search_path = '';
alter function public.punpang_register_push_token(text) set search_path = '';
