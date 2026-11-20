-- ด่านยอดชำระเกินบิล (punpang_guard_payment_over_bill): แก้ให้นับค่าส่งของออร์เดอร์จัดส่ง
-- เดิมเรียกยอดบิลจาก data อย่างเดียว แต่การจัดส่งอยู่ที่คอลัมน์ fulfillment → ออร์เดอร์จัดส่งที่มีค่าส่งถูกบล็อกเมื่อยืนยันยอดรวมค่าส่ง
-- ฟังก์ชันคัดลอกจาก 20261117170000_punpang_payment_over_bill.sql แล้วเปลี่ยนบรรทัดยอดบิลเท่านั้น (กติกาอื่นคงเดิม)

create or replace function public.punpang_guard_payment_over_bill()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  paid_new numeric;
  paid_old numeric := 0;
  bill numeric;
begin
  -- โหมดทดสอบ (punpang_test) ข้ามด่านนี้: ข้อมูลจำลองสร้างตามสถานะสุดท้าย และมีออร์เดอร์ที่ยอดชำระเกินยอดบิลหลังลดราคาแล้ว (เกิดได้จริงในแอป)
  if tg_table_schema <> 'public' then return new; end if;
  if tg_op = 'UPDATE' then
    if new.data is not distinct from old.data then return new; end if;
    paid_old := public.punpang__paid_confirmed(old.data);
  end if;
  paid_new := public.punpang__paid_confirmed(new.data);
  if paid_new <= paid_old + 0.005 then return new; end if; -- ยอดยืนยันไม่ได้เพิ่ม
  -- ค่าส่งอยู่ที่คอลัมน์ fulfillment (ไม่อยู่ใน data) จึงใส่เข้าไปก่อนคำนวณยอดบิล ไม่เช่นนั้นออร์เดอร์จัดส่งจะไม่นับค่าส่งและถูกบล็อกผิด
  bill := public.punpang__bill_total(new.data || jsonb_build_object('fulfillment', new.fulfillment));
  if paid_new > bill + 0.01 then
    raise exception 'punpang_over_bill: ยอดที่ยืนยันรวม % บาท เกินยอดบิล % บาท', paid_new, bill using errcode = 'P0001';
  end if;
  return new;
end
$$;
-- สิทธิ์เดิม: ฟังก์ชันด่านใช้ภายในเท่านั้น ไม่เปิดให้ผู้ใช้เรียก
revoke all on function public.punpang_guard_payment_over_bill() from public, anon, authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
