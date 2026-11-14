-- ตั้งเวลาลบรูปในแชทเว็บ/แอปที่ครบ 90 วัน: pg_cron วันละครั้ง → pg_net → Edge Function chat-photo-prune
-- (เดิมมีฟังก์ชัน แต่ไม่มีงานตั้งเวลาเรียก สัญญา "ลบรูปเมื่อครบ 90 วัน" จึงไม่ทำงาน)
-- ใช้ค่าลับชุดเดียวกับงาน punpang-scheduled: Edge secret SCHEDULED_KEY และ Vault ชื่อ scheduled_key
-- (ดูขั้นตอนตั้งค่าใน 20261113130000_punpang_scheduled_cron.sql) · ยังไม่ตั้งค่าลับ = ฟังก์ชันตอบ 403 ไม่เกิดอะไรขึ้น
-- ก่อนใช้งาน: deploy ฟังก์ชัน chat-photo-prune (GitHub Actions → Deploy chat-photo-prune)
-- เวลา 20:15 UTC = 03:15 เวลาไทย · ชื่องานเดิมซ้ำ = ถูกแทนที่ (รันซ้ำได้)
create extension if not exists pg_net;

select cron.schedule(
  'punpang-chat-photo-prune',
  '15 20 * * *',
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
