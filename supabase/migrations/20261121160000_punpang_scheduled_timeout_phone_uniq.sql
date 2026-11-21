-- ชุดแก้จากรายงานตรวจระบบ 2026-11-21 (B12, B13)

-- B13: งาน punpang-scheduled ใช้ค่าเริ่มต้นของ pg_net (5 วินาที) ขณะที่ฟังก์ชันใช้ราว 4–5 วินาที
-- รอบที่เกิน 5 วินาทีถูกตัดฝั่งฐานข้อมูลและไม่มีผลตอบกลับในตาราง net._http_response
-- เพิ่มเวลารอเป็น 30 วินาที · ตัวงานยังคงเป็นคำสั่งเดิมทุกบรรทัด
do $$ begin perform cron.unschedule('punpang-scheduled'); exception when others then null; end $$;
select cron.schedule(
  'punpang-scheduled',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/scheduled',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1)
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- B12: ดัชนีกันเบอร์ลูกค้าซ้ำ (ตัดอักขระที่ไม่ใช่ตัวเลขออก) · บน production มีดัชนีนี้อยู่แล้วซึ่งสร้างนอก migration
-- if not exists ทำให้ production ไม่เปลี่ยนแปลง · ฐานที่สร้างใหม่จาก migration จะมีด่านนี้ครบ
create unique index if not exists punpang_customers_phone_digits_uniq
  on public.punpang_customers (regexp_replace(coalesce(phone, ''), '\D', '', 'g'))
  where regexp_replace(coalesce(phone, ''), '\D', '', 'g') <> '';

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีดัชนีเดียวกัน (รูปแบบเดียวกับ punpang_customers_trgm)
select punpang_test.punpang_test_sync();
