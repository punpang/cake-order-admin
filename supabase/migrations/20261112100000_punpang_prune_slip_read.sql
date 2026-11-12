-- ลบผลการอ่านสลิป (collection slipRead) ที่เก่าเกิน 30 วัน · ทุกวัน 03:30 UTC (10:30 เวลาไทย)
-- ผลที่เก็บมีเพียงยอด วัน-เวลา และเวลาที่อ่าน (ไม่มีรูปสลิป) · งานนี้ตั้งด้วย pg_cron แล้วในฐานข้อมูล
select cron.schedule(
  'punpang-prune-slip-read',
  '30 3 * * *',
  $$delete from public.punpang_records where collection = 'slipRead' and (data->>'at')::timestamptz < now() - interval '30 days'$$
);
