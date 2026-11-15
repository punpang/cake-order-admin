-- สถานะพิมพ์และอ่านแล้ว (2 ฝั่ง): ตารางเล็กแยกจาก punpang_chats
-- เหตุผล: สถานะพิมพ์ส่งบ่อย (ทุกไม่กี่วินาที) ถ้าเขียนในแถวแชท จะทำให้ updated_at เปลี่ยนและชนการส่งข้อความ (CAS)
-- ฝั่งลูกค้าเขียนผ่าน Edge Function customer-order (service role) · ฝั่งพนักงานเขียนผ่าน RLS สิทธิ์ chat
-- รันครั้งเดียว: ตารางนี้เป็นของใหม่ จึงสร้าง policy ได้เลยโดยไม่ต้องใช้ drop (ไม่มีคำสั่งทำลาย)

create table if not exists public.punpang_chat_presence (
  chat_id text primary key references public.punpang_chats (id) on delete cascade,
  staff_typing_at timestamptz,
  customer_typing_at timestamptz,
  staff_read_at timestamptz,
  customer_read_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.punpang_chat_presence enable row level security;

revoke all on public.punpang_chat_presence from public, anon, authenticated;
grant select, insert, update on public.punpang_chat_presence to authenticated;

create policy presence_read on public.punpang_chat_presence for select to authenticated using (public.punpang_has_perm('chat'));

create policy presence_ins on public.punpang_chat_presence for insert to authenticated with check (public.punpang_has_perm('chat'));

create policy presence_upd on public.punpang_chat_presence for update to authenticated using (public.punpang_has_perm('chat')) with check (public.punpang_has_perm('chat'));
