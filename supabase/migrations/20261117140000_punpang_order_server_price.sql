-- ราคาออร์เดอร์คิดที่เซิร์ฟเวอร์ (บัค: ราคารายการตอนสร้างออร์เดอร์ไม่ถูกบังคับ — พนักงานขายตั้งราคา 1 บาทได้)
-- · ออร์เดอร์ใหม่ที่ไม่ใช่ POS ต้องสร้างผ่าน Edge Function order-create (บทบาทบริการ คิดราคาเอง)
--   เดิม trigger punpang_orders_insert_guard ยอมให้แอปเขียนตรง → เพิ่มด่านสุดท้าย: ถ้าบทบาทของแอป (authenticated/anon)
--   เขียนออร์เดอร์ที่ไม่ใช่ POS → ปฏิเสธ (รวมผู้จัดการ) · POS คงเขียนตรงได้ตามเดิม (ระบบขายหน้าร้านตรวจหลังบันทึกแล้ว)
-- · กติกาเดิมทั้งหมดคงอยู่ตามลำดับเดิม (ผู้จัดการยังข้ามกติกาเดิมตามที่ออกแบบไว้)
-- · บริการ (service role) ไม่ผ่าน trigger นี้ → order-create ตรวจกติกาเดียวกันเองใน _shared/schedlib/orderCreate.js
-- ลำดับ deploy: deploy Edge Function order-create และหน้าเว็บใหม่ก่อน แล้วค่อยรันไฟล์นี้ (แอปเก่าจะสร้างออร์เดอร์ไม่ได้หลังรัน)
-- ทดสอบซ้ำได้: supabase/tests/security.test.sql (ตรวจว่า authenticated เขียนออร์เดอร์ที่ไม่ใช่ POS ไม่ได้)

create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
  qid text;
  qres text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;

  if not public.punpang_has_perm('manage') then
    -- 1) คะแนนที่ใช้ต้องว่างตอนสร้าง
    if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
      raise exception 'points can only be applied through the server' using errcode = '42501';
    end if;

    -- 2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
    if (new.data->'adjustment'->>'amount') is not null
       and (new.data->'adjustment'->>'amount') !~ '^-?0+(\.0+)?$'
       and not public.punpang_has_perm('adjustPrice') then
      raise exception 'no permission to set a discount or adjustment' using errcode = '42501';
    end if;

    -- 3) คูปองที่ใส่มา ต้องผ่านการตรวจ
    for cp in
      select v.value as e
        from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
    loop
      if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
        raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
      end if;
    end loop;

    -- 4) ออร์เดอร์จากใบเสนอ: ตรวจผ่านฟังก์ชันของเจ้าของ
    qid := coalesce(new.data->>'quoteId', '');
    if qid <> '' then
      qres := public.punpang__quote_check(
        qid, new.id, new.customer_id, new.data->'items', new.data->'vat',
        case when (new.data->>'shippingFee') ~ '^-?[0-9]+(\.[0-9]+)?$' then (new.data->>'shippingFee')::numeric else 0 end);
      if qres = 'not_found' then raise exception 'quote not found' using errcode = '42501';
      elsif qres = 'not_ready' then raise exception 'quote is not ready to convert' using errcode = '42501';
      elsif qres = 'converted' then raise exception 'quote already converted' using errcode = '42501';
      elsif qres = 'customer' then raise exception 'quote customer mismatch' using errcode = '42501';
      elsif qres = 'items' then raise exception 'order items differ from the quote' using errcode = '42501';
      elsif qres = 'vat' then raise exception 'order VAT differs from the quote' using errcode = '42501';
      elsif qres = 'shipping' then raise exception 'order shipping fee differs from the quote' using errcode = '42501';
      end if;
    end if;
  end if;

  -- 5) ด่านใหม่ (ทุกบทบาทของแอป รวมผู้จัดการ): ออร์เดอร์ที่ไม่ใช่ POS ต้องผ่าน order-create ที่คิดราคาเอง
  if coalesce(new.channel, '') <> 'pos' then
    raise exception 'orders must be created through the server (order-create)' using errcode = '42501';
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;
