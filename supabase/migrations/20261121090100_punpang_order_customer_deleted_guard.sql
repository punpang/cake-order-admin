-- ด่านลูกค้าที่ถูกลบ (PDPA): ไม่รับออร์เดอร์ใหม่ของลูกค้าที่ถูกลบแล้ว
-- เดิม order-create ตรวจสถานะลูกค้าก่อนแทรกออร์เดอร์โดยไม่ล็อก → ถ้าการลบคอมมิตแทรกกลาง ออร์เดอร์ใหม่จะค้างข้อมูลส่วนตัว
-- แก้: ตอนแทรกล็อกแถวลูกค้าแบบ FOR SHARE · การลบ (punpang_purge_customer) ล็อกแถวเดียวกันแบบ FOR UPDATE
--   ลบคอมมิตก่อน → การแทรกเห็นว่าลบแล้วและถูกปฏิเสธ · แทรกคอมมิตก่อน → การลบเห็นออร์เดอร์เปิดค้างและปฏิเสธ

create or replace function public.punpang_orders_customer_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cdel boolean;
begin
  if tg_table_schema <> 'public' then return new; end if; -- โหมดทดสอบ (punpang_test) ข้าม
  if new.customer_id is null or new.customer_id = '' then return new; end if;
  select coalesce((c.data->>'deleted')::boolean, false) into cdel
    from public.punpang_customers c
   where c.id = new.customer_id
     for share;
  if cdel then
    raise exception 'punpang_customer_deleted: ลูกค้าถูกลบแล้ว รับออร์เดอร์ใหม่ไม่ได้' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.punpang_orders_customer_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_customer_guard on public.punpang_orders;
create trigger punpang_orders_customer_guard
  before insert on public.punpang_orders
  for each row execute function public.punpang_orders_customer_guard();

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่เพิ่มไปยัง punpang_test
select punpang_test.punpang_test_sync();
