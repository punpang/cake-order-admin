-- สั่งล่วงหน้า เฟส 2B: guard ฐานข้อมูลบังคับน้ำหนัก/ขนาดของสินค้าที่เปิดส่งพัสดุ (ตอนเปิดรับเท่านั้น)
-- นิยาม punpang_preorder_campaign_guard คัดลอกจาก 20261127130000 และเพิ่มด่าน parcel (ไม่มีตารางใหม่)

-- สินค้าพัสดุครบหรือไม่: น้ำหนักเป็นจำนวนเต็มกรัม 1–50000 และขนาดสามด้านเป็นตัวเลข >0 ถึง 200 ซม. (ตรงกับแอป hasParcelDims)
create or replace function public.punpang_preorder_parcel_ok(p_data jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare g numeric; w numeric; l numeric; h numeric;
begin
  if jsonb_typeof(p_data->'weightG') is distinct from 'number' then return false; end if;
  g := (p_data->>'weightG')::numeric;
  if g <> trunc(g) or g < 1 or g > 50000 then return false; end if;
  if jsonb_typeof(p_data->'dimsCm') is distinct from 'object' then return false; end if;
  if jsonb_typeof(p_data->'dimsCm'->'w') is distinct from 'number'
     or jsonb_typeof(p_data->'dimsCm'->'l') is distinct from 'number'
     or jsonb_typeof(p_data->'dimsCm'->'h') is distinct from 'number' then return false; end if;
  w := (p_data->'dimsCm'->>'w')::numeric;
  l := (p_data->'dimsCm'->>'l')::numeric;
  h := (p_data->'dimsCm'->>'h')::numeric;
  return w > 0 and w <= 200 and l > 0 and l <= 200 and h > 0 and h <= 200;
end $$;

revoke all on function public.punpang_preorder_parcel_ok(jsonb) from public, anon, authenticated;

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

  -- เปิดส่งพัสดุ: ทุกสินค้าต้องมีน้ำหนักและขนาดครบ (ตรวจเฉพาะตอนเปิดรับ)
  if new.status = 'open' and (tg_op = 'INSERT' or old.status is distinct from 'open')
     and new.data->'parcel'->>'enabled' = 'true' then
    select count(*) into n
      from jsonb_array_elements(new.data->'items') it
      left join public.punpang_items pi on pi.id = it->>'retailId'
     where pi.id is null or not public.punpang_preorder_parcel_ok(pi.data);
    if n > 0 then
      raise exception 'campaign_parcel_dims: สินค้าที่เปิดส่งพัสดุต้องมีน้ำหนักและขนาดครบ' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

-- ซิงก์สำเนาโหมดทดสอบให้ใช้นิยามใหม่
select punpang_test.punpang_test_sync();
