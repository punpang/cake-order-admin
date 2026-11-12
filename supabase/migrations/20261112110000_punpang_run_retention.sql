-- จัดการข้อมูลที่ไม่จำเป็น: ลบข้อมูลเก่าตามจำนวนวันที่ร้านกำหนดในหน้าตั้งค่า (config retention) ทุกวัน 03:30 UTC (10:30 เวลาไทย)
-- หมวดและค่าเริ่มต้น: slipRead 30 วัน · chatMedia 30 วัน (ลิงก์รูป Facebook) เปิดไว้ตามเดิม · aiLog / bell / orderLinks ปิดไว้ก่อน
-- orderLinks ลบเฉพาะลิงก์ที่ถูกเพิกถอนแล้ว (นับจาก revokedAt) · ผลการลบบันทึกเป็น retentionLog และ retentionLog เก่ากว่า 90 วันจะถูกลบเอง
create or replace function public.punpang_run_retention()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  cfg jsonb;
  cat text;
  d int;
  en boolean;
  n int;
  out jsonb := '{}'::jsonb;
  defaults jsonb := '{"slipRead":{"enabled":true,"days":30},"chatMedia":{"enabled":true,"days":30},"aiLog":{"enabled":false,"days":90},"bell":{"enabled":false,"days":90},"orderLinks":{"enabled":false,"days":180}}'::jsonb;
begin
  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'retention';
  cfg := coalesce(cfg, '{}'::jsonb);
  foreach cat in array array['slipRead', 'chatMedia', 'aiLog', 'bell', 'orderLinks'] loop
    en := coalesce((cfg->cat->>'enabled')::boolean, (defaults->cat->>'enabled')::boolean);
    d := least(3650, greatest(1, coalesce((cfg->cat->>'days')::int, (defaults->cat->>'days')::int)));
    if not en then
      continue;
    end if;
    if cat = 'chatMedia' then
      n := public.punpang_prune_chat_media(d);
    elsif cat = 'slipRead' then
      delete from public.punpang_records where collection = 'slipRead' and (data->>'at')::timestamptz < now() - make_interval(days => d);
      get diagnostics n = row_count;
    elsif cat = 'aiLog' then
      delete from public.punpang_records where collection = 'aiLog' and (data->>'at')::timestamptz < now() - make_interval(days => d);
      get diagnostics n = row_count;
    elsif cat = 'bell' then
      delete from public.punpang_records where collection = 'bell' and (data->>'at')::timestamptz < now() - make_interval(days => d);
      get diagnostics n = row_count;
    elsif cat = 'orderLinks' then
      delete from public.punpang_records where collection = 'orderLinks' and (data->>'revokedAt') is not null and (data->>'revokedAt')::timestamptz < now() - make_interval(days => d);
      get diagnostics n = row_count;
    end if;
    out := out || jsonb_build_object(cat, n);
  end loop;
  delete from public.punpang_records where collection = 'retentionLog' and (data->>'at')::timestamptz < now() - interval '90 days';
  insert into public.punpang_records (collection, id, data)
  values ('retentionLog', 'rl' || substr(md5(random()::text || clock_timestamp()::text), 1, 10), jsonb_build_object('at', now(), 'deleted', out));
  return out;
end;
$$;

revoke all on function public.punpang_run_retention() from public, anon, authenticated;

-- ย้ายงานเดิม 2 งานเข้าไปอยู่ในงานเดียว
select cron.unschedule('punpang-prune-slip-read');
select cron.unschedule('punpang-prune-chat-media');
select cron.schedule('punpang-retention', '30 3 * * *', $$select public.punpang_run_retention()$$);
