-- ลบลิงก์รูป/ไฟล์ของ Facebook ที่เก่าเกินกำหนด (ค่าเริ่มต้น 30 วัน) ออกจากแชท
-- เก็บชื่อและชนิดของไฟล์ไว้ ลบเฉพาะฟิลด์ url · ทำงานรายแชทด้วย CAS บน updated_at (ไม่ทับการเขียนที่ชนกัน)
-- ตั้งเวลารันทุกวันด้วย pg_cron: 03:00 UTC (10:00 เวลาไทย)
--   select cron.schedule('punpang-prune-chat-media', '0 3 * * *', $$select public.punpang_prune_chat_media(30)$$);
create or replace function public.punpang_prune_chat_media(p_days int default 30)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  cutoff timestamptz := now() - make_interval(days => p_days);
  new_msgs jsonb;
  changed int := 0;
  n int;
begin
  for r in
    select c.id, c.data, c.updated_at
      from public.punpang_chats c
     where c.data::text like '%"url": "https://%'
  loop
    select coalesce(jsonb_agg(
             case
               when jsonb_typeof(m->'attachments') = 'array'
                and (m->>'at')::timestamptz < cutoff
               then jsonb_set(m, '{attachments}',
                      (select coalesce(jsonb_agg(a - 'url'), '[]'::jsonb)
                         from jsonb_array_elements(m->'attachments') a))
               else m
             end
             order by ord), '[]'::jsonb)
      into new_msgs
      from jsonb_array_elements(r.data->'messages') with ordinality as t(m, ord);

    if new_msgs is distinct from (r.data->'messages') then
      update public.punpang_chats
         set data = jsonb_set(r.data, '{messages}', new_msgs)
       where id = r.id
         and updated_at = r.updated_at;
      get diagnostics n = row_count;
      changed := changed + n;
    end if;
  end loop;
  return changed;
end;
$$;

revoke all on function public.punpang_prune_chat_media(int) from public, anon, authenticated;
