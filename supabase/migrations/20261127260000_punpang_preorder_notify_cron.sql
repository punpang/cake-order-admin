-- สั่งล่วงหน้า: ตั้งเวลาแจ้งเตือนลูกค้า (เตือนก่อนหมดเวลา 1 ชม. และแจ้งหมดเวลา) ทุก 5 นาที
-- pg_cron → pg_net → Edge Function preorder-notify · ใช้ค่าลับชุดเดียวกับ scheduled (Edge secret SCHEDULED_KEY และ Vault ชื่อ scheduled_key)
-- ก่อนใช้งาน: deploy ฟังก์ชัน preorder-notify (GitHub Actions → Deploy preorder-notify) · ยังไม่ตั้งค่าลับ = ฟังก์ชันตอบ 403 ไม่เกิดอะไรขึ้น
-- ชื่องานเดิมซ้ำ = ถูกแทนที่ (รันซ้ำได้)
create extension if not exists pg_net;

select cron.schedule(
  'punpang-preorder-notify',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/preorder-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', (select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1)
    ),
    body := '{}'::jsonb
  );
  $$
);
