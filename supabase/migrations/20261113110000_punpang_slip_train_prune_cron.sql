-- ลบรูปสลิปชุดเทรนที่เก่าเกิน 30 วัน: pg_cron เรียกฟังก์ชัน slip-train-prune ทุกวัน 03:40 UTC (10:40 เวลาไทย) ผ่าน pg_net
-- ก่อนรันไฟล์นี้ต้องทำสองอย่าง: (1) เก็บคีย์ service role ไว้ใน Vault ชื่อ service_role_key ครั้งเดียว (ไม่เก็บคีย์ในไฟล์นี้) และ (2) deploy ฟังก์ชัน slip-train-prune แล้ว
-- ถ้ายังไม่มีคีย์หรือยังไม่ deploy การเรียกจะได้ 401 หรือ 404 และไม่ลบอะไร
create extension if not exists pg_net;

select cron.schedule(
  'punpang-slip-train-prune',
  '40 3 * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/slip-train-prune',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  )
  $$
);
