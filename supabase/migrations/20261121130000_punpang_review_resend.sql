-- การจัดการคิวรอตรวจของผู้จัดการ (ทำในฐานข้อมูลทั้งหมด · เฉพาะผู้มีสิทธิ์ manage)
-- 1) punpang_review_resend(p_id, p_confirmed): ส่งซ้ำบิลหน้าร้านจากคิว
--    ไม่ต้องมีสิทธิ์ pos · ไม่รับออร์เดอร์จากเบราว์เซอร์ · ฟังก์ชันนี้เป็น security definer จึงข้ามด่านบทบาทของตารางออร์เดอร์
--    จึงบังคับกติกาเหล่านั้นเอง: แต้ม/สิทธิ์สมาชิก/ใบเสนอ/การคืน/การยกเลิก ปฏิเสธ · ส่วนลดปรับเองต้องมีสิทธิ์ adjustPrice
--    คูปองตรวจด้วยฟังก์ชันตรวจเดิม (คูปองต้องจองไว้กับออร์เดอร์นี้บนเซิร์ฟเวอร์แล้ว ไม่จองซ้ำ) · มีคูปองหรือส่วนลดปรับเอง ต้องยืนยันว่าตรวจแล้ว
--    ด่านของตารางออร์เดอร์ (ยอดเกินบิล บัตร ลูกค้าถูกลบ) ยังทำงาน · ล้มเหลวตรงไหนทั้งธุรกรรมย้อนกลับ
-- 2) punpang_review_close(p_id, p_note): ปิดพร้อมเหตุผล และคืนคูปองที่จองไว้กับออร์เดอร์นี้ (ลูกค้าใช้ได้อีก)
-- 3) punpang__release_coupon_core: ตรรกะคืนคูปองแยกออกจากการตรวจสิทธิ์ · punpang_release_coupon ใช้ตรรกะเดิมทุกบรรทัด

-- ---------- ตรรกะคืนคูปอง (ไม่ตรวจสิทธิ์ · ใช้ได้เฉพาะจากฟังก์ชันฝั่งเซิร์ฟเวอร์) ----------
create or replace function public.punpang__release_coupon_core(p_coupon text, p_order text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  n int;
  r record;
  d jsonb;
  held numeric;
  bal numeric;
begin
  select * into r from public.punpang_records where collection = 'coupons' and id = p_coupon for update;
  if found and coalesce(r.data->>'mode', '') = 'credit' then
    d := r.data;
    if jsonb_typeof(d->'holds') <> 'object' or not (d->'holds' ? p_order) then return false; end if;
    held := (d->'holds'->>p_order)::numeric;
    bal := coalesce(nullif(d->>'balance', '')::numeric, 0);
    d := jsonb_set(d, '{balance}', to_jsonb(round(bal + held, 2)));
    d := jsonb_set(d, '{holds}', (d->'holds') - p_order);
    d := d || jsonb_build_object('status', 'pending');
    update public.punpang_records set data = d where collection = 'coupons' and id = p_coupon;
    return true;
  end if;

  update public.punpang_records
     set data = data || jsonb_build_object('status', 'pending', 'orderId', null, 'usedAt', null)
   where collection = 'coupons' and id = p_coupon
     and data->>'status' = 'used' and data->>'orderId' = p_order;
  get diagnostics n = row_count;
  return n > 0;
end
$$;
revoke all on function public.punpang__release_coupon_core(text, text) from public, anon, authenticated;

-- punpang_release_coupon: พฤติกรรมเดิม (ตรวจสิทธิ์ createOrder/pos แล้วคืนด้วยตรรกะเดียวกัน)
create or replace function public.punpang_release_coupon(p_coupon text, p_order text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return public.punpang__release_coupon_core(p_coupon, p_order);
end
$$;

-- ---------- ส่งซ้ำ ----------
create or replace function public.punpang_review_resend(p_id uuid, p_confirmed boolean default false)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.punpang_sync_review%rowtype;
  src jsonb;
  d jsonb;
  c record;
  has_extra boolean;
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
     or (src->'quoteId' is not null and src->>'quoteId' <> '')
     or (jsonb_typeof(src->'returns') = 'array' and jsonb_array_length(src->'returns') > 0)
     or (src->'cancel' is not null and src->'cancel' <> 'null'::jsonb) then
    raise exception 'punpang_review: มีแต้ม สิทธิ์สมาชิก ใบเสนอ การคืน หรือการยกเลิก ส่งซ้ำจากคิวไม่ได้ ให้ปิดพร้อมเหตุผลแล้วบันทึกใหม่' using errcode = '22023';
  end if;
  d := src - 'id' - 'code' - 'customerId' - 'status' - 'fulfillment' - 'channel';
  has_extra := (jsonb_typeof(src->'couponsUsed') = 'array' and jsonb_array_length(src->'couponsUsed') > 0)
            or coalesce(src->'adjustment'->>'amount', '0') !~ '^-?0+(\.0+)?$';
  if coalesce(src->'adjustment'->>'amount', '0') !~ '^-?0+(\.0+)?$' and not public.punpang_has_perm('adjustPrice') then
    raise exception 'punpang_review: ส่วนลดปรับเองต้องมีสิทธิ์ปรับราคา' using errcode = '42501';
  end if;
  if has_extra and not coalesce(p_confirmed, false) then
    raise exception 'punpang_review: ต้องยืนยันว่าตรวจคูปองและส่วนลดของรายการนี้แล้ว' using errcode = '22023';
  end if;
  for c in select v.value as e from jsonb_array_elements(case when jsonb_typeof(src->'couponsUsed') = 'array' then src->'couponsUsed' else '[]'::jsonb end) as v(value) loop
    if not public.punpang__coupon_entry_ok(r.order_id, 'pos', nullif(src->>'customerId', ''), d, c.e) then
      raise exception 'punpang_review: คูปองไม่ผ่านการตรวจ (อาจถูกใช้ไปแล้วหรือไม่ได้จองไว้กับออร์เดอร์นี้) ส่งซ้ำไม่ได้' using errcode = '22023';
    end if;
  end loop;
  if exists (select 1 from public.punpang_orders where id = r.order_id) then
    raise exception 'punpang_review: ออร์เดอร์นี้มีอยู่ในระบบแล้ว' using errcode = '23505';
  end if;
  -- แมปให้ตรงกับ orderRowOf ในแอป (balance คำนวณโดย trigger ฝั่งฐานข้อมูลอยู่แล้ว)
  insert into public.punpang_orders (id, code, customer_id, status, fulfillment, channel, pickup_at, data)
  values (
    src->>'id', src->>'code', nullif(src->>'customerId', ''), src->>'status', src->>'fulfillment',
    nullif(src->>'channel', ''), nullif(src->>'pickupAt', '')::timestamptz, d
  );
  update public.punpang_sync_review set status = 'resent' where id = r.id;
  return 'resent';
end $$;

-- ---------- ปิดพร้อมเหตุผล + คืนคูปองที่จองไว้กับออร์เดอร์นี้ ----------
create or replace function public.punpang_review_close(p_id uuid, p_note text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.punpang_sync_review%rowtype;
  c record;
  note text := btrim(coalesce(p_note, ''));
begin
  if not public.punpang_has_perm('manage') then
    raise exception 'punpang_review: ต้องมีสิทธิ์ผู้จัดการ' using errcode = '42501';
  end if;
  if note = '' then
    raise exception 'punpang_review: ต้องระบุเหตุผลการปิดรายการ' using errcode = '22023';
  end if;
  select * into r from public.punpang_sync_review where id = p_id and status = 'open' for update;
  if not found then
    raise exception 'punpang_review: ไม่พบรายการที่รอตรวจ (อาจถูกเปลี่ยนไปแล้ว)' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.punpang_orders where id = r.order_id) then
    raise exception 'punpang_review: ออร์เดอร์นี้มีอยู่ในระบบแล้ว ปิดจากคิวไม่ได้' using errcode = '23505';
  end if;
  for c in
    select r2.id from public.punpang_records r2
     where r2.collection = 'coupons'
       and ((r2.data->>'orderId' = r.order_id and coalesce(r2.data->>'status', '') = 'used')
         or (jsonb_typeof(r2.data->'holds') = 'object' and r2.data->'holds' ? r.order_id))
  loop
    perform public.punpang__release_coupon_core(c.id, r.order_id);
  end loop;
  update public.punpang_sync_review set status = 'closed', resolution_note = note where id = r.id;
  return 'closed';
end $$;

revoke all on function public.punpang_review_resend(uuid, boolean) from public, anon;
grant execute on function public.punpang_review_resend(uuid, boolean) to authenticated;
revoke all on function public.punpang_review_close(uuid, text) from public, anon;
grant execute on function public.punpang_review_close(uuid, text) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่เข้า punpang_test (ตามข้อตกลงของ migration ที่เพิ่มฟังก์ชันสาธารณะ)
select punpang_test.punpang_test_sync();
