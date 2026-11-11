-- พนักงานที่มีสิทธิ์ chat อัปโหลดรูปที่จะส่งให้ลูกค้าในแชท · จำกัดเฉพาะโฟลเดอร์ staff/ ของ bucket punpang-chat
-- (การอ่านมีอยู่แล้วจาก punpang_chat_read · ไฟล์ที่ลูกค้าส่งเข้ามาอยู่โฟลเดอร์ fb/ ซึ่งพนักงานอัปโหลดทับไม่ได้)
drop policy if exists punpang_chat_staff_insert on storage.objects;
create policy punpang_chat_staff_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'punpang-chat' and name like 'staff/%' and punpang_has_perm('chat'));
