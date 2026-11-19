-- ค้นลูกค้าที่เซิร์ฟเวอร์ (ชื่อ ILIKE '%คำ%' · เบอร์ LIKE '%เลข%') ให้ใช้ดัชนี ไม่ต้องอ่านทั้งตาราง
-- ทดสอบกับชื่อภาษาไทย 200,000 แถว (ctype UTF-8): ใช้ดัชนี trigram ได้ ~0.2 ms
-- ส่วนขยายอยู่ใน schema extensions ตามแนวทาง Supabase (มีอยู่แล้วบน Supabase · สร้างไว้สำหรับฐานข้อมูลทดสอบ)
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create index if not exists punpang_customers_name_trgm_idx on public.punpang_customers using gin (name extensions.gin_trgm_ops);
create index if not exists punpang_customers_phone_trgm_idx on public.punpang_customers using gin (phone extensions.gin_trgm_ops);

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีดัชนีใหม่ด้วย
select punpang_test.punpang_test_sync();
