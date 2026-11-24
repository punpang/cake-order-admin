-- สั่งล่วงหน้า เฟส 1: RPC จอง/ปล่อยโควตาแบบ atomic (ใช้ได้เฉพาะ service_role ฝั่งเซิร์ฟเวอร์)
-- หลักการ: ล็อกแถวแคมเปญก่อน แล้วล็อกแถวช่องตามลำดับคงที่ (ยอดรวมต่อวัน item_id='' ก่อน แล้วรหัสสินค้าเรียงตามตัวอักษร)
--   → ทุกธุรกรรมล็อกตามลำดับเดียวกัน กันดีดล็อกข้ามกัน · ตรวจทั้งหมดก่อนเขียน (ล้มแล้วตัวนับไม่เปลี่ยน)
-- รหัสผิดพลาด: not_found · closed · outside_order_window · bad_date · bad_qty · bad_item · empty · item_full · day_full
-- p_enforce_window=false ข้ามเฉพาะ closed/outside_order_window (ใช้ตอนอนุมัติขยายเวลาแล้วจองกลับ)

-- แยกรายการจองให้เป็นรูปเดียว: รวมรหัสซ้ำ ตรวจจำนวนเป็นจำนวนเต็ม 1–10000 และรหัสไม่ว่าง
create or replace function public.punpang_preorder_parse_lines(p_lines jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare ln jsonb; k text; n numeric; need jsonb := '{}'::jsonb;
begin
  if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) = 0 then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;
  for ln in select value from jsonb_array_elements(p_lines) loop
    if coalesce(jsonb_typeof(ln->'qty'), '') <> 'number' then
      return jsonb_build_object('ok', false, 'error', 'bad_qty');
    end if;
    n := (ln->>'qty')::numeric;
    if n <> trunc(n) or n < 1 or n > 10000 then
      return jsonb_build_object('ok', false, 'error', 'bad_qty');
    end if;
    k := coalesce(ln->>'itemId', '');
    if k = '' then
      return jsonb_build_object('ok', false, 'error', 'bad_item');
    end if;
    need := jsonb_set(need, array[k], to_jsonb(coalesce((need->>k)::integer, 0) + n::integer));
  end loop;
  return jsonb_build_object('ok', true, 'need', need);
end $$;

revoke all on function public.punpang_preorder_parse_lines(jsonb) from public, anon, authenticated;

create or replace function public.punpang_preorder_reserve(
  p_campaign text, p_pickup date, p_lines jsonb, p_enforce_window boolean default true
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.punpang_preorder_campaigns%rowtype;
  parsed jsonb; need jsonb; k text;
  q integer; total integer := 0; cap integer; cur integer; day_cur integer; day_cap integer;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  select * into c from public.punpang_preorder_campaigns where id = p_campaign for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'not_found'); end if;
  if p_enforce_window then
    if c.status <> 'open' then return jsonb_build_object('ok', false, 'error', 'closed'); end if;
    if today < c.order_from or today > c.order_to then
      return jsonb_build_object('ok', false, 'error', 'outside_order_window');
    end if;
  end if;
  if p_pickup < c.pickup_from or p_pickup > c.pickup_to then
    return jsonb_build_object('ok', false, 'error', 'bad_date');
  end if;
  parsed := public.punpang_preorder_parse_lines(p_lines);
  if not (parsed->>'ok')::boolean then return parsed; end if;
  need := parsed->'need';
  for k in select key from jsonb_each(need) loop total := total + (need->>k)::integer; end loop;

  -- ด่าน 1: ยอดรวมต่อวัน (แถว item_id='' ล็อกก่อนเสมอ)
  insert into public.punpang_preorder_slots (campaign_id, pickup_date, item_id, reserved)
    values (c.id, p_pickup, '', 0) on conflict do nothing;
  select reserved into day_cur from public.punpang_preorder_slots
    where campaign_id = c.id and pickup_date = p_pickup and item_id = '' for update;
  day_cap := (c.data->>'dayCap')::integer;
  if day_cap is not null and day_cur + total > day_cap then
    return jsonb_build_object('ok', false, 'error', 'day_full', 'left', greatest(day_cap - day_cur, 0));
  end if;

  -- ด่าน 2: รายสินค้า (ล็อกตามรหัสเรียง)
  for k in select key from jsonb_each(need) order by key loop
    q := (need->>k)::integer;
    select (e.value->>'dayCap')::integer into cap
      from jsonb_array_elements(coalesce(c.data->'items', '[]'::jsonb)) as e(value)
      where e.value->>'retailId' = k;
    if not found then return jsonb_build_object('ok', false, 'error', 'bad_item', 'itemId', k); end if;
    insert into public.punpang_preorder_slots (campaign_id, pickup_date, item_id, reserved)
      values (c.id, p_pickup, k, 0) on conflict do nothing;
    select reserved into cur from public.punpang_preorder_slots
      where campaign_id = c.id and pickup_date = p_pickup and item_id = k for update;
    if cap is not null and cur + q > cap then
      return jsonb_build_object('ok', false, 'error', 'item_full', 'itemId', k, 'left', greatest(cap - cur, 0));
    end if;
  end loop;

  -- ผ่านทุกด่านแล้วจึงเขียน (ล็อกถืออยู่แล้วจากขั้นตรวจ)
  for k in select key from jsonb_each(need) order by key loop
    update public.punpang_preorder_slots set reserved = reserved + (need->>k)::integer
      where campaign_id = c.id and pickup_date = p_pickup and item_id = k;
  end loop;
  update public.punpang_preorder_slots set reserved = reserved + total
    where campaign_id = c.id and pickup_date = p_pickup and item_id = '';
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.punpang_preorder_release(
  p_campaign text, p_pickup date, p_lines jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare parsed jsonb; need jsonb; k text; total integer := 0;
begin
  if not exists (select 1 from public.punpang_preorder_campaigns where id = p_campaign) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  parsed := public.punpang_preorder_parse_lines(p_lines);
  if not (parsed->>'ok')::boolean then return parsed; end if;
  need := parsed->'need';
  for k in select key from jsonb_each(need) loop total := total + (need->>k)::integer; end loop;
  -- ลำดับล็อกเหมือนการจอง: ยอดรวมก่อน แล้วรายสินค้าเรียงรหัส · ตัวนับไม่ต่ำกว่า 0
  update public.punpang_preorder_slots set reserved = greatest(reserved - total, 0)
    where campaign_id = p_campaign and pickup_date = p_pickup and item_id = '';
  for k in select key from jsonb_each(need) order by key loop
    update public.punpang_preorder_slots set reserved = greatest(reserved - (need->>k)::integer, 0)
      where campaign_id = p_campaign and pickup_date = p_pickup and item_id = k;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.punpang_preorder_reserve(text, date, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.punpang_preorder_reserve(text, date, jsonb, boolean) to service_role;
revoke all on function public.punpang_preorder_release(text, date, jsonb) from public, anon, authenticated;
grant execute on function public.punpang_preorder_release(text, date, jsonb) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มี RPC ใหม่ด้วย
select punpang_test.punpang_test_sync();
