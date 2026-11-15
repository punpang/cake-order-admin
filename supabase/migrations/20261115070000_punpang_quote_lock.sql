-- รอบแก้ 2026-11-15 (ราคาตามใบเสนอ — ล็อก) · รันหลัง 20261115060000 · รันซ้ำได้ปลอดภัย
-- ตัดสินใจแล้ว (ทางเลือก A): ราคาในใบเสนอที่ส่งให้ลูกค้าแล้วคือราคาที่ตกลง
--   1) ข้อมูลของใบเสนอ (data.payload: รายการ ราคา VAT ค่าส่ง) แก้ไม่ได้หลังบันทึก · ลูกค้าและแชทของใบเสนอเปลี่ยนไม่ได้
--      (ทำได้เฉพาะเปลี่ยนสถานะ ผูกออร์เดอร์ และคำตอบ)
--   2) ออร์เดอร์ที่สร้างจากใบเสนอ (data.quoteId) ต้องเป็นใบเสนอที่ลูกค้ายืนยันแล้วและยังไม่ถูกแปลงซ้ำ
--      และรายการ VAT และค่าส่งต้องเท่ากับที่ลูกค้าเห็นในใบเสนอ · ลูกค้าต้องเป็นคนเดียวกัน
-- ยังไม่ครบในรอบนี้: ราคาตอนส่งใบเสนอยังไม่ถูกคิดซ้ำกับแคตตาล็อกที่เซิร์ฟเวอร์ (ผู้มีสิทธิ์แชทที่ส่งผ่าน API ตั้งราคาได้ตั้งแต่ต้น)
--   ต้องแยกการคิดราคาโปรโมชันออกจากหน้าร้านก่อน ดู docs/security.md

-- ============================================================================
-- 1) ใบเสนอ: ข้อมูลที่ส่งแล้วแก้ไม่ได้ · ลูกค้า/แชทของใบเสนอเปลี่ยนไม่ได้
-- ============================================================================
create or replace function public.punpang_quotes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'UPDATE' then
    if (old.data->'payload') is distinct from (new.data->'payload') then
      raise exception 'quote terms are locked after they are saved' using errcode = '42501';
    end if;
    if old.customer_id is distinct from new.customer_id or old.chat_id is distinct from new.chat_id then
      raise exception 'quote customer or chat cannot be changed' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;
revoke all on function public.punpang_quotes_guard() from public, anon, authenticated;

drop trigger if exists punpang_quotes_guard on public.punpang_quotes;
create trigger punpang_quotes_guard
  before update on public.punpang_quotes
  for each row execute function public.punpang_quotes_guard();

-- ============================================================================
-- 0) ตรวจออร์เดอร์กับใบเสนอ (ทำงานด้วยสิทธิ์เจ้าของ เพื่อไม่ให้สิทธิ์การมองเห็นของผู้ใช้กั้นการตรวจ) · คืนเฉพาะรหัสผลลัพธ์
-- ============================================================================
create or replace function public.punpang__quote_check(
  p_quote text,
  p_order text,
  p_customer text,
  p_items jsonb,
  p_vat jsonb,
  p_shipping numeric
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  qr record;
begin
  select q.status, q.order_id, q.customer_id, q.data->'payload' as pl into qr
    from public.punpang_quotes q where q.id = p_quote;
  if not found then return 'not_found'; end if;
  if qr.status not in ('customer_ok', 'converting', 'need_phone', 'accepted') then return 'not_ready'; end if;
  if qr.order_id is not null and qr.order_id <> p_order then return 'converted'; end if;
  if qr.customer_id is distinct from p_customer then return 'customer'; end if;
  if (qr.pl->'items') is distinct from p_items then return 'items'; end if;
  if (qr.pl->'vat') is distinct from p_vat then return 'vat'; end if;
  if (case when (qr.pl->>'shippingFee') ~ '^-?[0-9]+(\.[0-9]+)?$' then (qr.pl->>'shippingFee')::numeric else 0 end)
     is distinct from coalesce(p_shipping, 0) then return 'shipping'; end if;
  return 'ok';
end
$$;
revoke all on function public.punpang__quote_check(text, text, text, jsonb, jsonb, numeric) from public, anon;
grant execute on function public.punpang__quote_check(text, text, text, jsonb, jsonb, numeric) to authenticated;

-- ============================================================================
-- 2) ตอนสร้างออร์เดอร์: ฉบับ 20261115060000 + ตรวจออร์เดอร์ที่มาจากใบเสนอ
-- ============================================================================
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
  if public.punpang_has_perm('manage') then return new; end if;

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

  -- 3) คูปองที่ใส่มา ต้องผ่านการตรวจ (ฉบับ 20261115050000)
  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;

  -- 4) ออร์เดอร์จากใบเสนอ: ตรวจผ่านฟังก์ชันของเจ้าของ (ผู้ใช้ทั่วไปมองไม่เห็นใบเสนอที่ไม่มีสิทธิ์แชท) และคืนเฉพาะรหัสผลลัพธ์
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

  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;
