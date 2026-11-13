-- ผลอ่านสลิป (slipRead: เลขอ้างอิงที่จำไว้ + ผลจาก AI) เก็บ 180 วัน
-- ค่าเริ่มต้นของหมวด slipRead เป็น 180 วัน และปรับค่าที่ร้านบันทึกไว้เดิม (30 วัน) เป็น 180 วัน (ถ้าร้านตั้งค่าอื่นไว้แล้วจะไม่แตะ)
-- ฟังก์ชันเหมือนเดิมทุกประการ ยกเว้นค่าเริ่มต้นของ slipRead · รูปสลิปชุดเทรนไม่อยู่ในไฟล์นี้ (ต้องลบผ่าน Storage API)
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
  defaults jsonb := '{"slipRead":{"enabled":true,"days":180},"chatMedia":{"enabled":true,"days":30},"aiLog":{"enabled":false,"days":90},"bell":{"enabled":false,"days":90},"orderLinks":{"enabled":false,"days":180}}'::jsonb;
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

update public.punpang_kv
   set data = jsonb_set(data, '{v,slipRead,days}', '180'::jsonb)
 where collection = 'config' and id = 'retention' and (data->'v'->'slipRead'->>'days') = '30';
