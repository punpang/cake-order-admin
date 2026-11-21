-- ด่านลูกค้าที่ถูกลบ (แก้ต่อจาก 20261121090100): ล็อกแถวลูกค้าแบบ FOR KEY SHARE แทน FOR SHARE (W-4)
-- FOR SHARE ชนกับ NO KEY UPDATE ที่การแก้ลูกค้าทั่วไปใช้ → การแก้ลูกค้าต้องรอออร์เดอร์ที่กำลังแทรก และเสี่ยง deadlock เมื่อข้ามลูกค้า
-- FOR KEY SHARE ไม่ชนกับ NO KEY UPDATE แต่ยังชนกับ FOR UPDATE ของการลบ (punpang_purge_customer) จึงยังกันการแทรกกลางการลบได้เหมือนเดิม

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
     for key share;
  if cdel then
    raise exception 'punpang_customer_deleted: ลูกค้าถูกลบแล้ว รับออร์เดอร์ใหม่ไม่ได้' using errcode = 'P0001';
  end if;
  return new;
end $$;
revoke all on function public.punpang_orders_customer_guard() from public, anon, authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันไปยัง punpang_test
select punpang_test.punpang_test_sync();
