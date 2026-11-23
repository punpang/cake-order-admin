-- ส่วนลดเดือนเกิดหน้าร้าน (POS) รอบ 1 (ต่อจาก 20261123140000)
-- 1) punpang__birth_discount_expected: คิดส่วนลดที่ควรได้ที่เซิร์ฟเวอร์ (ลูกค้าเดือนเกิด Active ครบ 30 วัน · LV3 5% / LV4 10% · เพดาน 25 / 50 · เฉพาะรายการสินค้าที่มีหมวดในรายการเค้กของร้าน)
-- 2) punpang_orders_insert_guard: ยอมรับ data.birthdayDiscount ได้เฉพาะช่อง POS · ต้องตรงกับค่าที่เซิร์ฟเวอร์คิด · ห้ามมีคูปองในบิลเดียวกัน (ไม่ซ้อน)
-- ลำดับ deploy: แอป POS ใหม่ก่อน (ส่งฟิลด์นี้) แล้วค่อยรันไฟล์นี้ · ออร์เดอร์เก่าไม่มีฟิลด์นี้จึงไม่กระทบ

create or replace function public.punpang__birth_discount_expected(p_customer text, p_items jsonb)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  st jsonb;
  bv jsonb;
  cats jsonb := coalesce(
    (select k.data->'v'->'cakeCategories' from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels'),
    '[]'::jsonb);
  base numeric := 0;
  amt numeric;
begin
  if cfg->>'mode' <> 'live' or jsonb_typeof(cats) <> 'array' or jsonb_array_length(cats) = 0 then return 0; end if;
  st := public.punpang__member_fold(p_customer, now());
  bv := public.punpang__member_birth_view(st);
  if (bv->>'rate')::numeric <= 0 then return 0; end if;
  select coalesce(sum(
           (case when (it->>'unitPrice') ~ '^-?[0-9]+(\.[0-9]+)?$' then (it->>'unitPrice')::numeric else 0 end)
         * (case when (it->>'qty') ~ '^[0-9]+(\.[0-9]+)?$' then (it->>'qty')::numeric else 0 end)), 0)
    into base
    from jsonb_array_elements(case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end) it
    join public.punpang_items pi on pi.id = it->>'retailId' and pi.kind = 'retail'
   where (pi.data->>'category') in (select jsonb_array_elements_text(cats));
  amt := round(base * (bv->>'rate')::numeric / 100, 2);
  return least(amt, (bv->>'cap')::numeric);
end $$;
revoke all on function public.punpang__birth_discount_expected(text, jsonb) from public, anon;
grant execute on function public.punpang__birth_discount_expected(text, jsonb) to authenticated;

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

    -- 2b) ส่วนลดเดือนเกิด: เฉพาะหน้าร้าน ไม่ซ้อนคูปอง และต้องตรงกับค่าที่เซิร์ฟเวอร์คิด
    if jsonb_typeof(new.data->'birthdayDiscount') = 'object' then
      if coalesce(new.channel, '') <> 'pos' then
        raise exception 'birthday discount is only allowed at the store' using errcode = '42501';
      end if;
      if jsonb_typeof(new.data->'couponsUsed') = 'array' and jsonb_array_length(new.data->'couponsUsed') > 0 then
        raise exception 'birthday discount cannot be combined with coupons' using errcode = '42501';
      end if;
      if (new.data->'birthdayDiscount'->>'amount') !~ '^[0-9]+(\.[0-9]+)?$'
         or abs((new.data->'birthdayDiscount'->>'amount')::numeric
              - public.punpang__birth_discount_expected(new.customer_id, new.data->'items')) > 0.005 then
        raise exception 'birthday discount differs from the server amount' using errcode = '42501';
      end if;
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


-- สำเนาโหมดทดสอบ (ดู supabase/tests/mirror.test.sql)
select punpang_test.punpang_test_sync();
