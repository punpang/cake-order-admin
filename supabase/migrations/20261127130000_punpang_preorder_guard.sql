-- สั่งล่วงหน้า: กติกาแคมเปญที่ฐานข้อมูลบังคับเอง (แก้จากรีวิวเฟส 1)
-- 1) แคมเปญที่กำลังเปิดรับ หรือมีโควตาจอง/ออร์เดอร์แล้ว: แก้โครงสร้างไม่ได้ (ช่วงวัน มัดจำ เวลาจ่าย สินค้า เพดาน) · แก้ชื่อและสถานะได้
-- 2) เปิดรับ (สร้างเป็นเปิดรับ หรือเปลี่ยนจากอย่างอื่นเป็นเปิดรับ): ต้องมีสินค้าอย่างน้อย 1 รายการ
--    และทุกรายการต้องเป็นสินค้า POS (kind='retail') ที่เปิดขาย ไม่กำหนดราคาเอง และไม่มีตัวเลือก
-- ทำเป็น security definer เพื่ออ่านแคตาล็อกได้ไม่ว่าผู้แก้จะมีสิทธิ์อ่านสินค้าหรือไม่

create or replace function public.punpang_preorder_campaign_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if tg_op = 'UPDATE' and (
       old.status = 'open'
    or exists (select 1 from public.punpang_preorder_slots s where s.campaign_id = old.id and s.reserved > 0)
    or exists (select 1 from public.punpang_preorder_orders o where o.campaign_id = old.id)) then
    if (old.order_from, old.order_to, old.pickup_from, old.pickup_to, old.deposit_percent, old.pay_due_min, old.data - 'name')
       is distinct from
       (new.order_from, new.order_to, new.pickup_from, new.pickup_to, new.deposit_percent, new.pay_due_min, new.data - 'name') then
      raise exception 'campaign_locked: แก้โครงสร้างแคมเปญที่เปิดรับหรือมีการจองแล้วไม่ได้' using errcode = '23514';
    end if;
  end if;

  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open') then
    if jsonb_typeof(new.data->'items') is distinct from 'array' or jsonb_array_length(new.data->'items') = 0 then
      raise exception 'campaign_no_items: แคมเปญที่เปิดรับต้องมีสินค้าอย่างน้อย 1 รายการ' using errcode = '23514';
    end if;
    select count(*) into n
      from jsonb_array_elements(new.data->'items') it
     where not exists (
       select 1 from public.punpang_items pi
        where pi.id = it->>'retailId' and pi.kind = 'retail' and pi.active
          and not coalesce((pi.data->>'openPrice')::boolean, false)
          and not (pi.data ? 'modifierIds' and jsonb_typeof(pi.data->'modifierIds') = 'array'
                   and jsonb_array_length(pi.data->'modifierIds') > 0));
    if n > 0 then
      raise exception 'campaign_bad_item: สินค้าในแคมเปญต้องเปิดขาย ไม่กำหนดราคาเอง และไม่มีตัวเลือก' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

revoke all on function public.punpang_preorder_campaign_guard() from public, anon, authenticated;

drop trigger if exists punpang_preorder_campaigns_guard on public.punpang_preorder_campaigns;
create trigger punpang_preorder_campaigns_guard before insert or update on public.punpang_preorder_campaigns
  for each row execute function public.punpang_preorder_campaign_guard();

-- ซิงก์สำเนาโหมดทดสอบ (ไม่มีตารางใหม่ แค่ให้สำเนาเห็นนิยามล่าสุด)
select punpang_test.punpang_test_sync();
