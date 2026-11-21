-- ด่านลูกค้าที่ถูกลบ (แก้ต่อจาก 20261121100100): ออร์เดอร์ที่มีอยู่ถูกย้ายไปหาลูกค้าที่ถูกลบแล้วต้องถูกบล็อกด้วย (I-2)
-- เดิมด่านตรวจเฉพาะการแทรกออร์เดอร์ใหม่ → UPDATE ที่เปลี่ยน customer_id ไปหาลูกค้าที่ถูกลบผ่านได้
--   (ord_upd อนุญาตทุกคอลัมน์ให้ผู้มีสิทธิ์บางบทบาท และแอปมีการเปลี่ยนผู้ซื้อ)
-- แก้: ตรวจเฉพาะเมื่อค่า customer_id เปลี่ยนจริง → แก้ข้อมูลอื่นของออร์เดอร์เดิมได้ และแอปที่ส่งค่าเดิมซ้ำไม่ถูกบล็อก
-- ล็อกแถวลูกค้าแบบ FOR KEY SHARE เหมือนด่านการแทรก (การลบใช้ FOR UPDATE จึงยังกันการย้ายระหว่างลบได้)

create or replace function public.punpang_orders_customer_move_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  cdel boolean;
begin
  if tg_table_schema <> 'public' then return new; end if; -- โหมดทดสอบ (punpang_test) ข้าม
  if new.customer_id is not distinct from old.customer_id then return new; end if; -- ไม่ได้เปลี่ยนลูกค้า
  if new.customer_id is null or new.customer_id = '' then return new; end if;
  select coalesce((c.data->>'deleted')::boolean, false) into cdel
    from public.punpang_customers c
   where c.id = new.customer_id
     for key share;
  if cdel then
    raise exception 'punpang_customer_deleted: ลูกค้าถูกลบแล้ว ย้ายออร์เดอร์ไปหาไม่ได้' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.punpang_orders_customer_move_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_customer_move_guard on public.punpang_orders;
create trigger punpang_orders_customer_move_guard
  before update of customer_id on public.punpang_orders
  for each row execute function public.punpang_orders_customer_move_guard();

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่เพิ่มไปยัง punpang_test
select punpang_test.punpang_test_sync();
