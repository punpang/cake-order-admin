-- ลูกค้าสร้างคูปองลดเป็นบาทจากคะแนนเอง (หน้าสมาชิก) · ใช้ครั้งเดียว · อายุ 15 วันนับจากวันที่สร้าง
-- กติกา: มูลค่าขั้นต่ำ 10 บาท เป็นทวีคูณของ 10 · ไม่จำกัดเพดาน · คะแนน = มูลค่า ÷ pointValue ต้องเป็นจำนวนเต็มพอดี (ไม่ลงตัว = ไม่ให้แลก)
-- เรียกผ่าน edge function customer-loyalty (service role) เท่านั้น · ล็อกแถวลูกค้าเหมือนการแลกของรางวัล

create or replace function public.punpang_cust_make_coupon(p_customer text, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; cfg jsonb; pv numeric; pts_num numeric; pts integer; sp jsonb; cp_id text; cdata jsonb;
  today_ text := public.punpang__pts_today();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  data_ jsonb;
begin
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'loyalty';
  if cfg is null then return jsonb_build_object('error', 'config_missing'); end if;

  if p_amount is null or p_amount < 10 or mod(p_amount, 10) <> 0 then return jsonb_build_object('error', 'invalid'); end if;
  pv := public.punpang__pts_cfg('pointValue', 1);
  if pv is null or pv <= 0 then return jsonb_build_object('error', 'config_missing'); end if;
  pts_num := p_amount / pv;
  if pts_num <> trunc(pts_num) then return jsonb_build_object('error', 'not_divisible'); end if;
  if pts_num > 2147483647 then return jsonb_build_object('error', 'invalid'); end if;
  pts := pts_num::integer;

  sp := public.punpang__cust_spend(coalesce(c.data->'ledger', '[]'::jsonb), pts, today_,
                                   'สร้างคูปองจากคะแนน ' || trunc(p_amount)::text || ' บาท', nowz);
  if sp ? 'error' then return sp; end if;

  data_ := jsonb_build_object('type', 'discount', 'mode', 'fixed', 'amount', p_amount, 'minSpend', 0,
                              'pct', 0, 'cap', 0, 'productId', '', 'productName', '',
                              'name', 'คูปองจากคะแนน ' || trunc(p_amount)::text || ' บาท',
                              'source', 'points_coupon', 'points', pts,
                              'expiresAt', to_char(today_::date + 15, 'YYYY-MM-DD'));
  cp_id := public.punpang__cust_new_coupon(p_customer, data_, '{}'::jsonb, today_);

  update public.punpang_customers set data = jsonb_set(c.data, '{ledger}', sp->'ledger'), updated_at = now() where id = c.id;
  select jsonb_build_object('id', r.id) || r.data into cdata from public.punpang_records r where r.collection = 'coupons' and r.id = cp_id;
  return jsonb_build_object('ok', true, 'coupon', cdata, 'balance', (sp->>'balance')::int - pts);
end $$;

revoke all on function public.punpang_cust_make_coupon(text, numeric) from public, anon, authenticated;
grant execute on function public.punpang_cust_make_coupon(text, numeric) to service_role;

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีฟังก์ชันใหม่ด้วย (ดู supabase/tests/mirror.test.sql ข้อ A6)
select punpang_test.punpang_test_sync();
