-- ตั้งเวลาเตือนตามเวลาบนเซิร์ฟเวอร์: pg_cron ทุก 15 นาที → pg_net → Edge Function scheduled
-- ค่าลับไม่อยู่ในไฟล์นี้ ต้องตั้งเองก่อนเปิดใช้งาน (ครั้งเดียว):
--   1) Edge secret SCHEDULED_KEY = ค่าสุ่มยาว ๆ (เช่น openssl rand -hex 32)
--   2) Vault: select vault.create_secret('<ค่าเดียวกับ SCHEDULED_KEY>', 'scheduled_key');
--   3) เปิดใช้งาน: ให้ config/scheduled = {"server": true} ใน punpang_kv
-- ยังไม่ตั้ง config/scheduled → Edge Function ตอบ skipped และแอปพนักงานยังทำเตือนเองเหมือนเดิม
create extension if not exists pg_net;

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
    body := '{}'::jsonb
  );
  $$
);
