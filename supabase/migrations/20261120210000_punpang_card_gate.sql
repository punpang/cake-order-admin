-- ด่านบัตรของ POS ฝั่งฐานข้อมูล: รายการชำระด้วยบัตรที่นับเป็นยอดรับ (สถานะยืนยัน) ต้องผ่านการกดยืนยันรับบัตรแล้ว
-- เดิมด่านนี้อยู่ที่หน้าจอ POS อย่างเดียว ฐานข้อมูลรับรายการบัตรที่ยืนยันแล้วได้โดยไม่มีหลักฐานการกดยืนยัน
-- แอปบันทึกธง cardConfirmed = true ในรายการชำระบัตรทุกครั้ง (src/data/store.js · pushPosPayments)
-- ด่านนี้ตรวจเฉพาะรายการชำระที่เพิ่มใหม่ (รหัสไม่เคยอยู่ในแถวเดิม) → รายการเดิมไม่ถูกกระทบ · โหมดทดสอบ (punpang_test) ข้ามด่านนี้

create or replace function public.punpang_orders_card_gate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p jsonb;
  old_ids text[] := '{}';
begin
  if tg_table_schema <> 'public' then return new; end if; -- โหมดทดสอบ (punpang_test) ข้าม
  if jsonb_typeof(new.data->'payments') is distinct from 'array' then return new; end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.data->'payments') = 'array' then
    select coalesce(array_agg(x->>'id'), '{}') into old_ids from jsonb_array_elements(old.data->'payments') x;
  end if;
  for p in select value from jsonb_array_elements(new.data->'payments') loop
    if p->>'posMethod' = 'card' and p->>'status' = 'confirmed'
       and not (p->>'id' is not null and p->>'id' = any(old_ids))
       and not coalesce((p->>'cardConfirmed')::boolean, false) then
      raise exception 'punpang_card_unconfirmed: รับชำระด้วยบัตรต้องกดยืนยันรับบัตรแล้วก่อน' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.punpang_orders_card_gate() from public, anon, authenticated;

drop trigger if exists punpang_orders_card_gate on public.punpang_orders;
create trigger punpang_orders_card_gate
  before insert or update on public.punpang_orders
  for each row execute function public.punpang_orders_card_gate();

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
