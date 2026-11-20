-- คะแนนที่ใช้กับออร์เดอร์ (pointsUsed) ล้างได้ทางเดียว: RPC punpang_remove_points ซึ่งคืนแต้มเข้าสมุดของลูกค้าและล้างค่าในธุรกรรมเดียวกัน
-- เดิมด่านออร์เดอร์ให้ผู้มีสิทธิ์ (useLoyalty / changeBuyer / cancel / posVoid / refundPartial) ล้าง pointsUsed ตรง ๆ ได้ → แต้มหายโดยไม่คืนเข้าสมุด (รายการ L1 ในรายงานบัค)
-- ทำสองส่วน: (1) RPC ตั้งค่าธุรกรรมว่า "กำลังคืนแต้มจากเซิร์ฟเวอร์" (2) ด่านใหม่ยอมให้ล้างได้เฉพาะเมื่อมีค่านี้
-- ด่านเดิมไม่เปลี่ยน (ตั้งค่าใหม่ผ่านเซิร์ฟเวอร์เท่านั้น · สิทธิ์ลบ) · โหมดทดสอบ (punpang_test) ข้ามด่านใหม่ เหมือนด่านอื่นของ punpang_orders

-- (1) RPC คืนแต้ม: กติกาเดิมทั้งหมด เพิ่มการตั้งค่าธุรกรรมก่อนแก้แถวลูกค้าและออร์เดอร์
create or replace function public.punpang_remove_points(p_order text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; pu jsonb; ledger jsonb; new_ledger jsonb; entry jsonb; gmap jsonb;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if role_ is null or not public.punpang_has_perm('useLoyalty') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  pu := o.data->'pointsUsed';
  if pu is null or pu = 'null'::jsonb then return jsonb_build_object('error', 'none'); end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  select e into entry from jsonb_array_elements(ledger) e where e->>'id' = pu->>'entryId';
  if entry is null or coalesce((entry->>'refunded')::boolean, false) then return jsonb_build_object('error', 'invalid'); end if;
  select coalesce(jsonb_object_agg(t->>'lotId', (t->>'n')::int), '{}'::jsonb) into gmap from jsonb_array_elements(coalesce(entry->'takes', '[]'::jsonb)) t;

  select coalesce(jsonb_agg(case
           when e->>'id' = pu->>'entryId' then jsonb_set(e, '{refunded}', 'true'::jsonb)
           when gmap ? (e->>'id') then jsonb_set(e, '{remaining}', to_jsonb(coalesce((e->>'remaining')::int, 0) + (gmap->>(e->>'id'))::int))
           else e end order by ord), '[]'::jsonb)
    into new_ledger from jsonb_array_elements(ledger) with ordinality as t(e, ord);
  new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
    'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -((entry->>'delta')::int), 'reason', 'คืนคะแนน ' || o.code, 'orderId', o.id, 'refund', true));
  perform set_config('punpang.points_removal', 'on', true); -- ค่าเฉพาะธุรกรรมนี้ ให้ด่าน punpang_orders_points_clear ยอมให้ล้างคะแนนค้างได้
  update public.punpang_customers set data = jsonb_set(data, '{ledger}', new_ledger), updated_at = now() where id = c.id;

  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{pointsUsed}', 'null'::jsonb),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowz, 'by', role_, 'text', 'ยกเลิกการใช้ ' || (pu->>'points') || ' คะแนน')))
   where id = o.id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.punpang_remove_points(text) from public, anon;
grant execute on function public.punpang_remove_points(text) to authenticated;

-- (2) ด่าน: การล้าง pointsUsed (มีค่า → ไม่มีค่า) ต้องมาจาก punpang_remove_points เท่านั้น
create or replace function public.punpang_orders_points_clear_guard()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_schema <> 'public' then return new; end if; -- โหมดทดสอบ (punpang_test) ข้าม
  if coalesce(old.data->'pointsUsed', 'null'::jsonb) = 'null'::jsonb then return new; end if; -- ไม่มีคะแนนค้างเดิม
  if coalesce(new.data->'pointsUsed', 'null'::jsonb) <> 'null'::jsonb then return new; end if; -- ยังมีคะแนนค้าง (การตั้งค่าใหม่กันโดยด่านเดิม)
  if coalesce(current_setting('punpang.points_removal', true), '') = 'on' then return new; end if; -- มาจาก punpang_remove_points
  raise exception 'points can only be removed through the server (punpang_remove_points)' using errcode = '42501';
end $$;
revoke all on function public.punpang_orders_points_clear_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_points_clear on public.punpang_orders;
create trigger punpang_orders_points_clear
  before update on public.punpang_orders
  for each row execute function public.punpang_orders_points_clear_guard();

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่เปลี่ยนไปยัง punpang_test
select punpang_test.punpang_test_sync();
