-- รอบแก้ 2026-11-15 (สิทธิ์ของผู้ไม่ล็อกอิน + ความเร็ว) · รันหลัง 20261115020000 · รันซ้ำได้ปลอดภัย
-- 1) anon เหลือเฉพาะที่หน้าร้านใช้จริง: อ่านสินค้า (active) / ตั้งค่าสาธารณะ / รีวิวที่อนุมัติ + RPC ที่ออกแบบให้เรียกได้
--    (เดิม anon มีสิทธิ์ ALL บน punpang_cake_clicks, punpang_push_devices, tungngern_* แม้ RLS จะกันแถวไว้)
revoke all on all tables in schema public from anon;
grant select on public.punpang_items, public.punpang_kv, public.punpang_records to anon;

revoke all on all functions in schema public from anon;
grant execute on function public.punpang_record_pageview(text) to anon;
grant execute on function public.punpang_click_pairs() to anon;
grant execute on function public.punpang_record_click(text, text) to anon;
grant execute on function public.punpang_resolve_short_link(text) to anon;

-- 2) TRUNCATE / REFERENCES / TRIGGER ไม่ผ่าน RLS (ค่าเริ่มต้นของ Supabase ให้มาทุกตาราง) → ถอนจาก anon และ authenticated
do $$
declare r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relkind in ('r', 'p')
  loop
    execute format('revoke truncate, references, trigger on table public.%I from anon, authenticated', r.relname);
  end loop;
end $$;

-- 3) ดัชนีที่ขาด
--    punpang_push_devices.staff_id เป็น FK แต่ไม่มีดัชนี (ลบพนักงานหรือค้นอุปกรณ์ของพนักงานจะสแกนทั้งตาราง)
--    punpang_orders.data ค้นด้วย @> เมื่อตรวจเลขอ้างอิงการชำระซ้ำ (customer-order) → เดิมสแกนทุกออร์เดอร์
create index if not exists punpang_push_devices_staff_id_idx on public.punpang_push_devices (staff_id);
create index if not exists punpang_orders_data_gin on public.punpang_orders using gin (data jsonb_path_ops);

-- 4) นับคลิกรูปเค้ก: เดิมนับทั้งตารางทุกครั้งที่มีคนกด (count(*) ทั้งตาราง) → ใช้ค่าประมาณจากสถิติของตาราง
--    ผู้เยี่ยมชมคนหนึ่งยังนับผ่านดัชนีคู่ (v, photo_id) ได้จำกัด 300 แถว
create or replace function public.punpang_record_click(p_photo text, p_visitor text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  est bigint;
  removed bigint;
begin
  if p_photo is null or p_visitor is null or p_photo !~ '^[A-Za-z0-9_-]{1,64}$' or char_length(p_visitor) not between 8 and 64 then
    return;
  end if;
  -- ผู้เยี่ยมชมหนึ่งคนไม่เกิน 300 รูป
  if (select count(*) from (select 1 from public.punpang_cake_clicks where v = p_visitor limit 300) s) >= 300 then
    return;
  end if;
  -- ทั้งระบบไม่เกิน 50,000 แถว (ค่าประมาณจากสถิติ) · เต็มแล้วลบแถวที่เก่ากว่า 90 วันก่อน แทนการหยุดบันทึกถาวร
  select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
  if est >= 50000 then
    delete from public.punpang_cake_clicks where at < now() - interval '90 days';
    get diagnostics removed = row_count;
    if removed > 0 then
      -- อัปเดตสถิติเฉพาะตอนที่ลบจริง (ไม่วิเคราะห์ตารางทุกครั้งที่คนกดตอนตารางเต็ม)
      analyze public.punpang_cake_clicks;
      select greatest(c.reltuples::bigint, 0) into est from pg_class c where c.oid = 'public.punpang_cake_clicks'::regclass;
    end if;
    if est >= 50000 then
      return;
    end if;
  end if;
  insert into public.punpang_cake_clicks (v, photo_id) values (p_visitor, p_photo) on conflict do nothing;
end $$;
revoke all on function public.punpang_record_click(text, text) from public;
grant execute on function public.punpang_record_click(text, text) to anon, authenticated;
