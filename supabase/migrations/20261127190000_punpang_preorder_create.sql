-- สั่งล่วงหน้า เฟส 2C: สร้างออร์เดอร์และคืนออร์เดอร์ในธุรกรรมเดียว (service_role เท่านั้น)
-- ลำดับล็อก: ลูกค้า → แคมเปญ → ช่องโควตา → ตัวนับเลขที่ (ทุกเส้นทางเรียงแบบเดียวกัน กันดีดล็อกข้ามกัน)
-- ความล้มเหลวทั้งหมดถูก raise เพื่อให้ธุรกรรมย้อนกลับทั้งชุด (จองโควตา ตัดแต้ม เลขที่) · ไม่มี exception block ครอบส่วนเหล่านี้
-- ข้อความ raise: reserve_failed:<รหัสโควตา> · points:<รหัส> · total_mismatch

create or replace function public.punpang_preorder_create(p_row jsonb, p_lines jsonb, p_points integer, p_amount numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  oid text := p_row->>'id';
  cid text := p_row->>'customer_id';
  cmp text := p_row->>'campaign_id';
  pick date;
  c record; ex record; r jsonb; spend jsonb;
  open_n int; n int; code text; bill numeric;
  ddmmyy text := to_char((now() at time zone 'Asia/Bangkok')::date, 'DDMMYY');
begin
  if oid is null or cid is null or cmp is null or p_row->>'pickup_date' is null or p_row->>'status' is distinct from 'awaiting_payment' then
    return jsonb_build_object('error', 'bad_row');
  end if;
  pick := (p_row->>'pickup_date')::date;

  -- 1) ลูกค้า: ล็อกก่อนทุกอย่าง
  select * into c from public.punpang_customers where id = cid for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;

  -- 2) idempotent ตามรหัสออร์เดอร์
  select * into ex from public.punpang_preorder_orders where id = oid;
  if found then return jsonb_build_object('ok', true, 'already', true, 'code', ex.code); end if;

  -- 3) เพดานออร์เดอร์ค้างจ่ายต่อเบอร์ (3)
  select count(*) into open_n from public.punpang_preorder_orders where customer_id = cid and status not in ('cancelled', 'delivered');
  if open_n >= 3 then return jsonb_build_object('error', 'too_many_open'); end if;

  -- 4) จองโควตา: ไม่ผ่านให้ raise ทันที (ห้ามห่อ exception)
  r := public.punpang_preorder_reserve(cmp, pick, p_lines, true);
  if not coalesce((r->>'ok')::boolean, false) then
    raise exception 'reserve_failed:%', coalesce(r->>'error', 'unknown') using errcode = 'P0001';
  end if;

  -- 5) ตัดแต้ม (เมื่อใช้แต้ม): ใช้ RPC เดียวกับการใช้แต้มของออร์เดอร์ (ล็อกลูกค้าอยู่แล้ว)
  if coalesce(p_points, 0) > 0 then
    spend := public.punpang_preorder_spend_points(oid, cid, p_points, p_amount);
    if spend ? 'error' then raise exception 'points:%', spend->>'error' using errcode = 'P0001'; end if;
  end if;

  -- 6) ยอดที่ส่งมาต้องตรงกับที่คิดในฐานข้อมูล
  bill := round(public.punpang__bill_total(coalesce(p_row->'data', '{}'::jsonb) || jsonb_build_object('fulfillment', p_row->>'fulfillment')), 2);
  if bill is distinct from round((p_row->'data'->>'total')::numeric, 2) then
    raise exception 'total_mismatch' using errcode = 'P0001';
  end if;

  -- 7) เลขที่ PRE (ขั้นสุดท้ายของธุรกรรม)
  n := public.punpang_alloc_numbers_server('PRE', ddmmyy, 1);
  code := 'PRE-' || ddmmyy || '-' || lpad(n::text, 6, '0');

  -- 8) บันทึกออร์เดอร์ (รายการโควตาเก็บไว้ให้การปล่อยโควตาใช้)
  insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, customer_id, data)
    values (oid, cmp, code, 'awaiting_payment', pick, cid,
      coalesce(p_row->'data', '{}'::jsonb) || jsonb_build_object('code', code, 'lines', p_lines, 'pointsUsed', coalesce(p_points, 0)));
  return jsonb_build_object('ok', true, 'already', false, 'code', code);
end $$;

-- 9) ยกเลิกออร์เดอร์: คืนแต้มและปล่อยโควตา (ลำดับล็อกเดียวกัน) · เรียกซ้ำไม่มีผล
create or replace function public.punpang_preorder_cancel_release(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  o record; c record; ret jsonb; rel jsonb;
begin
  select customer_id into o from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;   -- ลูกค้าก่อน
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status = 'cancelled' then return jsonb_build_object('ok', true, 'already', true); end if;
  if o.status = 'delivered' then return jsonb_build_object('error', 'already_delivered'); end if;
  ret := public.punpang_preorder_return_points(p_order);
  rel := public.punpang_preorder_release(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb));
  update public.punpang_preorder_orders set status = 'cancelled' where id = p_order;
  return jsonb_build_object('ok', true, 'already', false, 'points', coalesce(ret->>'points', '0'), 'released', rel->>'ok');
end $$;

revoke all on function public.punpang_preorder_create(jsonb, jsonb, integer, numeric) from public, anon, authenticated;
grant execute on function public.punpang_preorder_create(jsonb, jsonb, integer, numeric) to service_role;
revoke all on function public.punpang_preorder_cancel_release(text) from public, anon, authenticated;
grant execute on function public.punpang_preorder_cancel_release(text) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มี RPC ใหม่
select punpang_test.punpang_test_sync();
