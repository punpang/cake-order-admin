-- สร้างออร์เดอร์จากใบเสนอแบบอะตอมิก (ธุรกรรมเดียว): ล็อกแถวใบเสนอ → ตรวจกติกาเดิม → แทรกออร์เดอร์ → ผูก order_id และสถานะกับใบเสนอ
-- ตัวล็อกแถวทำหน้าที่จองใบเสนอ: คำขอที่มาพร้อมกันจะรอกันแล้วได้ 'converted' ไม่ใช่ออร์เดอร์ซ้ำ
-- ผลลัพธ์ code: ok | exists (ออร์เดอร์เลขนี้มีแล้ว) | converted (ใบเสนอถูกแปลงแล้ว) | รหัสตรวจใบเสนอเดิม (not_found, not_ready, customer, items, vat, shipping)
-- เรียกได้เฉพาะ service_role (Edge Function order-create) · p_row รูปแบบเดียวกับ orderRowOf (id, code, customer_id, status, fulfillment, channel, pickup_at, balance, data)
-- ลำดับ deploy: migration นี้ → deploy order-create ที่เรียกฟังก์ชันนี้ → migration ดัชนีกันซ้ำ (20261120150000)

create or replace function public.punpang_quote_order_create(p_quote text, p_row jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  qr record;
  oid text := coalesce(p_row->>'id', '');
  res text;
  cname text;
  rowj jsonb;
begin
  if oid = '' then return jsonb_build_object('code', 'invalid'); end if;

  select q.status, q.order_id into qr from public.punpang_quotes q where q.id = p_quote for update;
  if not found then return jsonb_build_object('code', 'not_found'); end if;
  if exists (select 1 from public.punpang_orders o where o.id = oid) then return jsonb_build_object('code', 'exists'); end if;
  if qr.order_id is not null and qr.order_id <> oid then return jsonb_build_object('code', 'converted'); end if;

  res := public.punpang__quote_check(
    p_quote, oid, p_row->>'customer_id', p_row->'data'->'items', p_row->'data'->'vat',
    case when (p_row->'data'->>'shippingFee') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p_row->'data'->>'shippingFee')::numeric else 0 end);
  if res <> 'ok' then return jsonb_build_object('code', res); end if;

  begin
    insert into public.punpang_orders as po (id, code, customer_id, status, fulfillment, channel, pickup_at, balance, data)
    values (
      oid, p_row->>'code', nullif(p_row->>'customer_id', ''), p_row->>'status', p_row->>'fulfillment', nullif(p_row->>'channel', ''),
      nullif(p_row->>'pickup_at', '')::timestamptz, nullif(p_row->>'balance', '')::numeric, coalesce(p_row->'data', '{}'::jsonb))
    returning to_jsonb(po.*) into rowj;
  exception when unique_violation then
    get stacked diagnostics cname = constraint_name;
    if cname = 'punpang_orders_quote_uniq' then return jsonb_build_object('code', 'converted'); end if;
    if cname = 'punpang_orders_pkey' then return jsonb_build_object('code', 'exists'); end if;
    raise; -- เลขออร์เดอร์ซ้ำ (code) ให้ผู้เรียกจัดการเหมือนเดิม (ออกเลขใหม่)
  end;

  update public.punpang_quotes set order_id = oid, status = 'accepted', updated_at = now() where id = p_quote;
  return jsonb_build_object('code', 'ok', 'row', rowj);
end $$;

revoke all on function public.punpang_quote_order_create(text, jsonb) from public, anon, authenticated;
grant execute on function public.punpang_quote_order_create(text, jsonb) to service_role;

-- โหมดทดสอบ: คัดลอกฟังก์ชันไปยัง punpang_test แล้วตั้งสิทธิ์ให้เหมือนกัน
select punpang_test.punpang_test_sync();
revoke all on function punpang_test.punpang_quote_order_create(text, jsonb) from public, anon, authenticated;
grant execute on function punpang_test.punpang_quote_order_create(text, jsonb) to service_role;
