-- สัญญาณสด (Realtime) รอบที่ 2
-- 1) เพิ่ม tungngern_transfers และ punpang_chat_presence เข้า publication (พนักงานรับรู้ทันที ตามนโยบาย RLS เดิม)
-- 2) ชื่อช่องต่อออร์เดอร์ + ทริกเกอร์ส่งสัญญาณ (ไม่มีเนื้อหา) เมื่อออร์เดอร์เปลี่ยน · หน้าลิงก์ของลูกค้าโหลดใหม่เงียบ ๆ
-- รันซ้ำได้: ตรวจก่อนเพิ่ม publication · create if not exists / create or replace

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tungngern_transfers') then
    alter publication supabase_realtime add table public.tungngern_transfers;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'punpang_chat_presence') then
    alter publication supabase_realtime add table public.punpang_chat_presence;
  end if;
end $$;

-- ชื่อช่องของแต่ละออร์เดอร์ (สุ่ม): เข้าถึงได้เฉพาะ service role (Edge Function order-link) และทริกเกอร์
create table if not exists public.punpang_order_topics (
  order_id text primary key references public.punpang_orders (id) on delete cascade,
  topic text not null unique,
  created_at timestamptz not null default now()
);
alter table public.punpang_order_topics enable row level security;
revoke all on public.punpang_order_topics from public, anon, authenticated;

-- ออร์เดอร์เปลี่ยนข้อมูลสำคัญ → ส่งสัญญาณไปช่องของออร์เดอร์ (ไม่มีช่อง = ข้าม · ความล้มเหลวไม่กระทบการบันทึกออร์เดอร์)
create or replace function public.punpang_order_ping()
returns trigger
language plpgsql
security definer
set search_path = public, realtime
as $$
declare
  v_topic text;
begin
  -- ทั้งฟังก์ชันอยู่ใน exception: สัญญาณต้องไม่ทำให้การบันทึกออร์เดอร์ล้มเหลว
  begin
    if new.data is not distinct from old.data and new.status is not distinct from old.status
       and new.pickup_at is not distinct from old.pickup_at and new.balance is not distinct from old.balance then
      return null;
    end if;
    select t.topic into v_topic from public.punpang_order_topics t where t.order_id = new.id;
    if v_topic is null then return null; end if;
    perform realtime.send('{}'::jsonb, 'msg', v_topic, false); -- false = ช่องสาธารณะ (ลูกค้าไม่มี JWT ของ Supabase)
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function public.punpang_order_ping() from public, anon, authenticated;

create or replace trigger punpang_orders_ping_trg
  after update on public.punpang_orders
  for each row execute function public.punpang_order_ping();
