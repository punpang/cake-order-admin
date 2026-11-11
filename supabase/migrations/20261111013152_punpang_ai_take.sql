-- บอท AI: ตัวนับจำนวนครั้งที่เรียกโมเดลต่อวัน (อะตอมิก) · เก็บใน punpang_kv collection 'aiUsage' id = วันที่ (เวลาไทย)
-- คืน true เมื่อยังไม่เกินเพดานและนับเพิ่มแล้ว · คืน false เมื่อครบเพดาน (ไม่นับเพิ่ม)
-- เรียกได้เฉพาะ service role (Edge Function fb-webhook) · ผู้ใช้ทั่วไปและ anon เรียกไม่ได้
create or replace function public.punpang_ai_take(p_day text, p_limit integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  ok boolean;
begin
  if p_limit is null or p_limit <= 0 then
    return false;
  end if;
  insert into public.punpang_kv (collection, id, data)
  values ('aiUsage', p_day, jsonb_build_object('n', 1))
  on conflict (collection, id) do update
    set data = jsonb_build_object('n', coalesce((public.punpang_kv.data->>'n')::integer, 0) + 1)
    where coalesce((public.punpang_kv.data->>'n')::integer, 0) < p_limit
  returning true into ok;
  return coalesce(ok, false);
end;
$$;

revoke all on function public.punpang_ai_take(text, integer) from public, anon, authenticated;
grant execute on function public.punpang_ai_take(text, integer) to service_role;
