-- ด่านบัตรของ POS (แก้ต่อจาก 20261120210000): ข้ามการตรวจเฉพาะรายการที่สถานะเดิมยืนยันอยู่แล้วเท่านั้น
-- เดิมข้ามทุกรายการที่รหัสเคยอยู่ในแถวเดิม → เปลี่ยนรายการบัตรจาก reported เป็น confirmed โดยไม่มีธงยืนยันบัตรได้
-- แก้: รายการบัตรที่เป็นยอดรับต้องมีธง cardConfirmed เว้นแต่รายการเดิมนั้นยืนยันอยู่แล้ว (นับเป็นยอดรับอยู่แล้ว)

create or replace function public.punpang_orders_card_gate()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  p jsonb;
  old_payments jsonb := '[]'::jsonb;
begin
  if tg_table_schema <> 'public' then return new; end if; -- โหมดทดสอบ (punpang_test) ข้าม
  if jsonb_typeof(new.data->'payments') is distinct from 'array' then return new; end if;
  if tg_op = 'UPDATE' and jsonb_typeof(old.data->'payments') = 'array' then
    old_payments := old.data->'payments';
  end if;
  for p in select value from jsonb_array_elements(new.data->'payments') loop
    if p->>'posMethod' = 'card' and p->>'status' = 'confirmed'
       and not coalesce((p->>'cardConfirmed')::boolean, false)
       and not exists (
         select 1 from jsonb_array_elements(old_payments) x
          where p->>'id' is not null and x->>'id' = p->>'id' and x->>'status' = 'confirmed'
       ) then
      raise exception 'punpang_card_unconfirmed: รับชำระด้วยบัตรต้องกดยืนยันรับบัตรแล้วก่อน' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.punpang_orders_card_gate() from public, anon, authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
