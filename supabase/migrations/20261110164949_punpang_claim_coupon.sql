-- จองคูปองส่วนลดแบบอะตอมิก: กันสองเครื่อง/สองพนักงานใช้คูปองใบเดียวกับสองออร์เดอร์พร้อมกัน
-- ล็อกแถวคูปอง (for update) แล้วเปลี่ยน pending/active → used ในธุรกรรมเดียว · เรียกซ้ำด้วยออร์เดอร์เดิม = ok (ลองใหม่ได้)
-- ผลลัพธ์: 'ok' | 'used' (ถูกใช้/มอบ/คืนแต้มแล้ว หรือจองโดยออร์เดอร์อื่น) | 'expired' | 'invalid' | 'missing' (ยังไม่มีแถวในฐานข้อมูล เช่น เพิ่งสร้างและยังไม่ซิงก์ → ฝั่งแอปใช้ต่อได้)
create or replace function public.punpang_claim_coupon(p_coupon text, p_order text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  d jsonb;
  today_th text := to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD');
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_coupon is null or p_order is null or length(p_coupon) > 64 or length(p_order) > 64 then return 'invalid'; end if;

  select * into r from public.punpang_records where collection = 'coupons' and id = p_coupon for update;
  if not found then return 'missing'; end if;
  d := r.data;

  if coalesce(d->>'type', '') <> 'discount' then return 'invalid'; end if;
  if coalesce(d->>'status', '') = 'used' and d->>'orderId' = p_order then return 'ok'; end if;
  if coalesce(d->>'status', '') in ('used', 'delivered', 'refunded', 'lapsed') then return 'used'; end if;
  if nullif(d->>'expiresAt', '') is not null and (d->>'expiresAt') < today_th then return 'expired'; end if;
  if nullif(d->>'activatedUntil', '') is not null and (d->>'activatedUntil')::timestamptz <= now() then return 'expired'; end if;

  update public.punpang_records
     set data = d || jsonb_build_object(
           'status', 'used', 'orderId', p_order,
           'usedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
           'activatedAt', null, 'activatedUntil', null)
   where collection = 'coupons' and id = p_coupon;
  return 'ok';
end
$$;

-- คืนคูปองที่จองไว้ชั่วคราว (เช่น ขาย POS ไม่สำเร็จหลังจองแล้ว) · คืนได้เฉพาะแถวที่จองด้วยรหัสออร์เดอร์นั้น
create or replace function public.punpang_release_coupon(p_coupon text, p_order text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  update public.punpang_records
     set data = data || jsonb_build_object('status', 'pending', 'orderId', null, 'usedAt', null)
   where collection = 'coupons' and id = p_coupon
     and data->>'status' = 'used' and data->>'orderId' = p_order;
  get diagnostics n = row_count;
  return n > 0;
end
$$;

revoke all on function public.punpang_claim_coupon(text, text) from public, anon;
revoke all on function public.punpang_release_coupon(text, text) from public, anon;
grant execute on function public.punpang_claim_coupon(text, text) to authenticated;
grant execute on function public.punpang_release_coupon(text, text) to authenticated;
