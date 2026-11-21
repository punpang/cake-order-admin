-- ด่านบัตรของ POS (แก้ต่อจาก 20261121090000): รายการที่ยืนยันแล้วได้รับการยกเว้นเฉพาะเมื่อวิธีชำระและยอดเหมือนฉบับเดิมทุกค่า
-- เดิมยกเว้นทุกรายการที่รหัสเคยยืนยันแล้ว → แก้ยอดหรือเปลี่ยนวิธีชำระเป็นบัตรได้โดยไม่ยืนยันรับบัตรใหม่ (W-3)
-- แก้: ถ้าวิธีชำระหรือยอดเปลี่ยน ต้องมีธงยืนยันบัตรเหมือนรายการใหม่

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
            and x->'posMethod' is not distinct from p->'posMethod'
            and x->'amount' is not distinct from p->'amount'
       ) then
      raise exception 'punpang_card_unconfirmed: รับชำระด้วยบัตรต้องกดยืนยันรับบัตรแล้วก่อน' using errcode = 'P0001';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.punpang_orders_card_gate() from public, anon, authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
