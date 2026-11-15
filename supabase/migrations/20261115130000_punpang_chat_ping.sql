-- สัญญาณ "มีข้อความ/สถานะใหม่" ของแชทลูกค้า (Realtime Broadcast) · ส่งเฉพาะสัญญาณ ไม่มีเนื้อหาข้อความ
-- ลูกค้าไม่ได้ล็อกอิน Supabase จึงใช้ช่องสาธารณะที่มีชื่อสุ่มต่อลูกค้า (ออกให้เฉพาะหลังล็อกอิน ใน chat_list)
-- ลูกค้าได้สัญญาณแล้วโหลดข้อความจริงจาก chat_list ทุกครั้ง (ต้องมีเซสชัน) · สัญญาณหาย = หน้าแชทยังโพลล์สำรองอยู่
-- ต้องรันหลัง 20261115120000_punpang_chat_presence (ทริกเกอร์ของตารางสถานะ) · รันซ้ำได้
-- ความล้มเหลวของสัญญาณไม่ทำให้การบันทึกแชท/สถานะล้มเหลว (exception ถูกกลืนในฟังก์ชัน)

-- ชื่อช่องของลูกค้าแต่ละคน: เข้าถึงได้เฉพาะ service role (Edge Function customer-order) และฟังก์ชันทริกเกอร์ด้านล่าง
create table if not exists public.punpang_chat_topics (
  customer_id text primary key references public.punpang_customers (id) on delete cascade,
  topic text not null unique,
  created_at timestamptz not null default now()
);
alter table public.punpang_chat_topics enable row level security;
revoke all on public.punpang_chat_topics from public, anon, authenticated;

-- ส่งสัญญาณหนึ่งครั้งไปยังช่องของลูกค้า (ไม่มีช่อง = ข้าม)
create or replace function public.punpang_chat_ping(p_customer_id text)
returns void
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_topic text;
begin
  if p_customer_id is null then return; end if;
  select t.topic into v_topic from public.punpang_chat_topics t where t.customer_id = p_customer_id;
  if v_topic is null then return; end if;
  begin
    perform realtime.send('{}'::jsonb, 'msg', v_topic, false); -- false = ช่องสาธารณะ (ลูกค้าไม่มี JWT ของ Supabase)
  exception when others then
    null; -- สัญญาณล้มเหลวต้องไม่ทำให้การบันทึกแชทล้มเหลว
  end;
end;
$$;
revoke all on function public.punpang_chat_ping(text) from public, anon, authenticated;

-- กระทู้เว็บเปลี่ยนข้อมูล (ข้อความใหม่/สถานะ) → สัญญาณ · ข้ามแถวที่ข้อมูลไม่เปลี่ยนและช่องอื่นที่ไม่ใช่เว็บ
create or replace function public.punpang_chats_ping()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  if new.channel is distinct from 'web' then return null; end if;
  if tg_op = 'UPDATE' and new.data is not distinct from old.data then return null; end if;
  perform public.punpang_chat_ping(new.customer_id);
  return null;
end;
$$;
revoke all on function public.punpang_chats_ping() from public, anon, authenticated;

create or replace trigger punpang_chats_ping_trg
  after insert or update on public.punpang_chats
  for each row execute function public.punpang_chats_ping();

-- สถานะพิมพ์/อ่านแล้วของพนักงานเปลี่ยน → สัญญาณ (ลูกค้าเห็นเร็วขึ้น) · สถานะของลูกค้าเองไม่ต้องส่ง
create or replace function public.punpang_presence_ping()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_customer text;
begin
  if tg_op = 'UPDATE' and new.staff_typing_at is not distinct from old.staff_typing_at
     and new.staff_read_at is not distinct from old.staff_read_at then
    return null;
  end if;
  if tg_op = 'INSERT' and new.staff_typing_at is null and new.staff_read_at is null then
    return null;
  end if;
  select c.customer_id into v_customer from public.punpang_chats c where c.id = new.chat_id;
  perform public.punpang_chat_ping(v_customer);
  return null;
end;
$$;
revoke all on function public.punpang_presence_ping() from public, anon, authenticated;

create or replace trigger punpang_presence_ping_trg
  after insert or update on public.punpang_chat_presence
  for each row execute function public.punpang_presence_ping();
