-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108093035) · เนื้อตรงกับที่รันจริง

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('punpang-chat', 'punpang-chat', false, 10485760, array[
  'image/jpeg','image/png','image/gif','image/webp',
  'video/mp4','audio/mpeg','audio/mp4','audio/aac','audio/x-m4a',
  'application/pdf','text/plain',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
])
on conflict (id) do nothing;

create policy punpang_chat_read on storage.objects for select to authenticated
  using (bucket_id = 'punpang-chat' and public.punpang_has_perm('chat'));

create function public.punpang_chat_bot_claim(p_chat text, p_mid text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare n int;
begin
  if not public.punpang_has_perm('chat') then raise exception 'forbidden'; end if;
  if p_chat is null or p_mid is null or length(p_mid) < 5 or length(p_mid) > 300 then return false; end if;
  update public.punpang_chats
     set data = jsonb_set(coalesce(data, '{}'::jsonb), '{botSeenMid}', to_jsonb(p_mid))
   where id = p_chat
     and channel = 'facebook'
     and coalesce(data->>'botSeenMid', '') <> p_mid;
  get diagnostics n = row_count;
  return n > 0;
end;
$$;
revoke all on function public.punpang_chat_bot_claim(text, text) from public, anon;
grant execute on function public.punpang_chat_bot_claim(text, text) to authenticated;
