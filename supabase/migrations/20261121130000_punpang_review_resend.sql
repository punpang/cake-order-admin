-- ส่งซ้ำรายการในคิวรอตรวจ (ผู้จัดการ): ฐานข้อมูลอ่านต้นฉบับหรือฉบับที่แก้จากคิวเอง แล้วเพิ่มออร์เดอร์และปิดคิวในธุรกรรมเดียว
-- ไม่ต้องมีสิทธิ์ pos · ไม่รับออร์เดอร์จากเบราว์เซอร์ · ด่านของตารางออร์เดอร์ (ยอดเกินบิล บัตร ลูกค้าถูกลบ) ยังทำงานตามเดิม
-- ฟังก์ชันนี้เป็น security definer จึงข้ามด่าน insert ที่ตรวจตามบทบาท: ด่านคะแนน/คูปอง/ส่วนลดจึงบังคับที่ฟังก์ชันนี้เอง (ปฏิเสธถ้ามี)
create or replace function public.punpang_review_resend(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.punpang_sync_review%rowtype;
  src jsonb;
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'punpang_review: ต้องมีสิทธิ์ผู้จัดการ' using errcode = '42501';
  end if;
  select * into r from public.punpang_sync_review where id = p_id and status = 'open' for update;
  if not found then
    raise exception 'punpang_review: ไม่พบรายการที่รอตรวจ (อาจถูกเปลี่ยนไปแล้ว)' using errcode = 'P0002';
  end if;
  if r.channel is distinct from 'pos' then
    raise exception 'punpang_review: ส่งซ้ำได้เฉพาะบิลหน้าร้าน' using errcode = '22023';
  end if;
  src := coalesce(r.edited_payload, r.payload);
  if src->>'id' is distinct from r.order_id then
    raise exception 'punpang_review: รหัสออร์เดอร์ในคิวไม่ตรงกับต้นฉบับ' using errcode = '22023';
  end if;
  if (src->'pointsUsed' is not null and src->'pointsUsed' <> 'null'::jsonb)
     or (src->'loyalty' is not null and src->'loyalty' <> 'null'::jsonb)
     or (jsonb_typeof(src->'couponsUsed') = 'array' and jsonb_array_length(src->'couponsUsed') > 0)
     or coalesce(src->'adjustment'->>'amount', '0') !~ '^-?0+(\.0+)?$' then
    raise exception 'punpang_review: มีแต้ม คูปอง หรือส่วนลด ส่งซ้ำจากคิวไม่ได้ ให้ปิดพร้อมเหตุผลแล้วบันทึกใหม่' using errcode = '22023';
  end if;
  if exists (select 1 from public.punpang_orders where id = r.order_id) then
    raise exception 'punpang_review: ออร์เดอร์นี้มีอยู่ในระบบแล้ว' using errcode = '23505';
  end if;
  -- แมปให้ตรงกับ orderRowOf ในแอป (balance คำนวณโดย trigger ฝั่งฐานข้อมูลอยู่แล้ว)
  insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, pickup_at, data)
  values (
    src->>'id', src->>'code', nullif(src->>'customerId', ''), src->>'status', src->>'fulfillment',
    nullif(src->>'channel', ''), nullif(src->>'pickupAt', '')::timestamptz,
    src - 'id' - 'code' - 'customerId' - 'status' - 'fulfillment' - 'channel'
  );
  update public.punpang_sync_review set status = 'resent' where id = r.id;
  return 'resent';
end $$;

revoke all on function public.punpang_review_resend(uuid) from public, anon;
grant execute on function public.punpang_review_resend(uuid) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่เข้า punpang_test (ตามข้อตกลงของทุก migration ที่เพิ่มฟังก์ชันสาธารณะ)
select punpang_test.punpang_test_sync();
