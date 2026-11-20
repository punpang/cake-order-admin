-- ยอดคงค้าง (balance) คำนวณที่ฐานข้อมูลทุกครั้งที่ออร์เดอร์ถูกบันทึก = ยอดบิล − ยอดที่ยืนยันแล้ว (ตามสูตร orderTotals ในแอป)
-- เดิมแอปเป็นผู้คำนวณตอนบันทึกเท่านั้น การยืนยันชำระอัตโนมัติจากสลิปไม่อัปเดตค่านี้ จึงค้างค่าเดิม
-- ทริกเกอร์ชื่อขึ้นต้น zz_ เพื่อให้รันหลังทริกเกอร์ BEFORE อื่น (Postgres รันตามลำดับชื่อ) · สูตรเทียบกับแอปด้วย supabase/tests/balance_sync.test.sql
-- ลำดับ deploy: migration นี้ไม่ต้องคู่กับ Edge Function (ค่าที่ฟังก์ชันเขียนจะถูกคำนวณใหม่ที่ฐานข้อมูลอยู่แล้ว)

-- security definer: ตัวช่วยคำนวณยอดถูกเพิกถอนสิทธิ์จาก authenticated/anon จึงต้องรันด้วยสิทธิ์เจ้าของฟังก์ชัน (ทริกเกอร์ไม่ให้ผู้ใช้เลือกค่าได้)
create or replace function public.punpang_orders_balance_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- การจัดส่งอยู่ที่คอลัมน์ fulfillment (ไม่อยู่ใน data) จึงใส่เข้าไปก่อนคำนวณ ไม่เช่นนั้นค่าส่งจะหายจากยอดบิล
  new.balance := round(public.punpang__bill_total(new.data || jsonb_build_object('fulfillment', new.fulfillment)) - public.punpang__paid_confirmed(new.data), 2);
  return new;
end $$;
revoke all on function public.punpang_orders_balance_sync() from public, anon, authenticated;

drop trigger if exists zz_punpang_orders_balance on public.punpang_orders;
create trigger zz_punpang_orders_balance
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_orders_balance_sync();

-- โหมดทดสอบ: คัดลอกทริกเกอร์และฟังก์ชันไปยัง punpang_test
select punpang_test.punpang_test_sync();
