-- ตั้งเวลาลบรูปในแชทเว็บ/แอปที่ครบ 90 วัน: pg_cron วันละครั้ง → pg_net → Edge Function chat-photo-prune
-- บันทึกงานที่ production ตั้งไว้แล้ว (ผ่าน SQL Editor) ลงรีโป เพื่อให้สร้างฐานข้อมูลใหม่ได้ตรงกัน · ไม่ต้องรันซ้ำบน production
-- ใช้ค่าลับชุดเดียวกับงาน punpang-scheduled: Edge secret SCHEDULED_KEY และ Vault ชื่อ scheduled_key
-- (ดูขั้นตอนตั้งค่าใน 20261113130000_punpang_scheduled_cron.sql) · ยังไม่ตั้งค่าลับ = ฟังก์ชันตอบ 403 ไม่เกิดอะไรขึ้น
-- ก่อนใช้งาน: deploy ฟังก์ชัน chat-photo-prune (GitHub Actions → Deploy chat-photo-prune)
-- เวลา 03:40 UTC = 10:40 เวลาไทย (ตามที่ตั้งไว้ใน production) · ชื่องานเดิมซ้ำ = ถูกแทนที่ (รันซ้ำได้)
create extension if not exists pg_net;

select cron.schedule(
  'punpang-chat-photo-prune',
  '40 3 * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/chat-photo-prune',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
