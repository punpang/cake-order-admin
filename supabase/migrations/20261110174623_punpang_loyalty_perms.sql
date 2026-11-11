-- สิทธิ์ของ RPC แต้มสะสม (ตรวจรายการ ไม่ใช่แค่ว่าเป็นพนักงาน active)
-- award/undo/ledger_apply เดิมตรวจแค่ punpang__pts_staff() · ตอนนี้ตรวจสิทธิ์ตามการกระทำ (แอดมิน manage ใช้ได้เสมอ)
-- รันแล้วในฐานข้อมูลเป็นเวอร์ชัน 20261110174623 · ไฟล์นี้กู้คืนจาก statements ในประวัติ migration ให้ตรงกับที่รันจริง (ฉบับเดิม 20261110280000 ต่างกันเฉพาะลำดับ REVOKE/GRANT)
-- แต้มสะสม ขั้น 2b-2 (ส่วนที่ 1): ได้แต้ม/สิทธิ์หมุนตอนส่งมอบ และถอนเมื่อย้อนสถานะ — ทำบนเซิร์ฟเวอร์แบบอะตอมิกและกันซ้ำ
-- ล็อกลูกค้า → ล็อกออร์เดอร์ → ตรวจ data.loyalty ของออร์เดอร์ (มีแล้ว = ไม่ให้ซ้ำ) → เขียนสมุดแต้ม + สิทธิ์หมุน + data.loyalty ของออร์เดอร์ ในธุรกรรมเดียว
-- คำนวณแต้มจากยอดสินค้า/โปรคะแนน (pointsFor) ยังทำที่แอปแล้วส่งค่ามา · เซิร์ฟเวอร์รับผิดชอบความถูกต้องของการเขียนและการกันซ้ำ

-- ให้แต้มตอนส่งมอบ
create or replace function public.punpang_award_order(p_order text, p_points integer, p_bonus integer, p_spins integer, p_base numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; ledger jsonb; lot_id text := public.punpang__pts_newid();
  exp_at text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  label text;
  sp integer;
begin
  if role_ is null or not (public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('deliverPickup') or public.punpang_has_perm('pos') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('manage')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_points is null or p_points < 0 or p_points > 1000000 or p_spins is null or p_spins < 0 or p_spins > 10000
     or p_bonus is null or p_bonus < 0 or p_base is null or p_base < 0 then
    return jsonb_build_object('error', 'invalid');
  end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;     -- คิวต่อลูกค้า
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  if o.data->'loyalty' is not null and o.data->'loyalty' <> 'null'::jsonb then
    return jsonb_build_object('error', 'already_awarded');
  end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  label := 'ออร์เดอร์ ' || o.code || case when p_bonus > 0 then ' (รวมโบนัสโปรคะแนน)' else '' end;
  if p_points > 0 then
    exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
    ledger := ledger || jsonb_build_array(jsonb_build_object(
      'id', lot_id, 'at', nowz, 'delta', p_points, 'reason', label, 'orderId', o.id, 'expiresAt', exp_at, 'remaining', p_points));
  end if;
  sp := coalesce((c.data->>'spins')::int, 0) + p_spins;
  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(sp)), updated_at = now()
   where id = c.id;

  update public.punpang_orders
     set data = jsonb_set(
           jsonb_set(o.data, '{loyalty}', jsonb_build_object(
             'points', p_points, 'bonus', p_bonus, 'spins', p_spins, 'base', round(p_base, 2),
             'lotId', case when p_points > 0 then lot_id else null end)),
           '{history}', coalesce(o.data->'history', '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', nowz, 'by', role_, 'text', 'ได้ ' || p_points || ' คะแนน' || case when p_bonus > 0 then ' (โบนัสโปร +' || p_bonus || ')' else '' end || case when p_spins > 0 then ' + สิทธิ์หมุน ' || p_spins || ' ครั้ง' else '' end)))
   where id = o.id;
  return jsonb_build_object('ok', true, 'lotId', case when p_points > 0 then lot_id else null end, 'points', p_points, 'spins', p_spins);
end $$;

-- ถอนแต้ม/สิทธิ์หมุนที่ได้จากการส่งมอบ (ตอนย้อนสถานะ) · ไม่มีการได้แต้มค้างอยู่ = ไม่ทำอะไร (ซ้ำได้ปลอดภัย)
create or replace function public.punpang_undo_award(p_order text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; ly jsonb; ledger jsonb; lot jsonb; cut integer := 0; lot_ok boolean := false;
  new_ledger jsonb; sp integer;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if role_ is null or not (public.punpang_has_perm('revertStatus') or public.punpang_has_perm('cancel') or public.punpang_has_perm('manage')) then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into o from public.punpang_orders where id = p_order;
  if not found or o.customer_id is null then return jsonb_build_object('error', 'no_order'); end if;
  select * into c from public.punpang_customers where id = o.customer_id for update;
  if not found then return jsonb_build_object('error', 'no_customer'); end if;
  select * into o from public.punpang_orders where id = p_order for update;
  ly := o.data->'loyalty';
  if ly is null or ly = 'null'::jsonb then return jsonb_build_object('ok', true, 'skipped', true); end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  select e into lot from jsonb_array_elements(ledger) e where e->>'id' = ly->>'lotId' limit 1;
  new_ledger := ledger;
  if lot is not null then
    lot_ok := true;
    cut := coalesce((lot->>'remaining')::int, 0);
    new_ledger := (select coalesce(jsonb_agg(case when e->>'id' = ly->>'lotId' then jsonb_set(e, '{remaining}', '0'::jsonb) else e end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as t(e, ord));
    if cut > 0 then
      new_ledger := new_ledger || jsonb_build_array(jsonb_build_object(
        'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -cut, 'reason', 'ตัดคะแนน ' || o.code || ' (ยกเลิก)', 'orderId', o.id));
    end if;
  end if;
  sp := greatest(coalesce((c.data->>'spins')::int, 0) - coalesce((ly->>'spins')::int, 0), 0);
  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', new_ledger), '{spins}', to_jsonb(sp)), updated_at = now()
   where id = c.id;
  update public.punpang_orders set data = jsonb_set(o.data, '{loyalty}', 'null'::jsonb) where id = o.id;
  return jsonb_build_object('ok', true, 'cut', cut, 'lotFound', lot_ok);
end $$;

-- แต้มสะสม ขั้น 2b-2 (ส่วนที่ 2): แก้สมุดแต้มของลูกค้าหลายรายการในธุรกรรมเดียว
-- ใช้กับ: คืนเงินเป็นคะแนน · ยกเลิกการคืนเงิน · โอนผู้ซื้อ · คืนคะแนนจากคูปอง · ยกเลิกการใช้คะแนนตอนยกเลิกออร์เดอร์ (ผ่าน punpang_remove_points แยก)
-- ล็อกแถวลูกค้า → ทำทุกรายการตามลำดับ → เขียนกลับครั้งเดียว · ผิดพลาดรายการใดก็ raise = ย้อนทั้งชุด
-- รายการ (p_ops = jsonb array):
--   {op:'earn', id, points, reason, orderId}                ก้อนใหม่ · id สร้างฝั่งแอป (ใช้อ้างอิงทันที) · หมดอายุตามตั้งค่าร้าน
--   {op:'cut', lotId, reason, orderId}                     ตัดส่วนที่เหลือของก้อน (ไม่มีก้อน = ข้าม เหมือนโอนเดิม)
--   {op:'cut_refund', lotId, points, label, reason, orderId} ยกเลิกคะแนนที่คืนให้ · ก้อนต้องยังไม่ถูกใช้ (remaining = delta = points) · ไม่มี lotId = หาจาก orderId+label+points
--   {op:'refund_spend', entryId, reason}                   คืนคะแนนที่ตัดไปตอนใช้เป็นส่วนลด (ตามค่า takes ของรายการนั้น) · ทำซ้ำไม่ได้
--   {op:'spins', delta}                                    ปรับสิทธิ์หมุน (ไม่ติดลบ)
-- ข้อผิดพลาด (raise): forbidden · no_customer · invalid_op · dup_id · lot_missing · lot_used · entry_missing (ไม่ใช้แล้ว)
create or replace function public.punpang_ledger_apply(p_customer text, p_ops jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  c record;
  ledger jsonb;
  spins_ integer;
  op jsonb;
  t jsonb;
  kind text;
  lot jsonb;
  n integer;
  cut integer;
  lid text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text;
begin
  if role_ is null or not (public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel') or public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('adjustPoints') or public.punpang_has_perm('manage')) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 50 then
    raise exception 'invalid_op';
  end if;
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then raise exception 'no_customer'; end if;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  spins_ := coalesce((c.data->>'spins')::int, 0);
  exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');

  for op in select value from jsonb_array_elements(p_ops) loop
    kind := op->>'op';

    if kind = 'earn' then
      n := (op->>'points')::int;
      lid := op->>'id';
      if n is null or n <= 0 or n > 1000000 or lid is null or lid = '' or length(lid) > 64 then raise exception 'invalid_op'; end if;
      if exists (select 1 from jsonb_array_elements(ledger) x where x->>'id' = lid) then raise exception 'dup_id'; end if;
      ledger := ledger || jsonb_build_array(jsonb_build_object(
        'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
        'expiresAt', exp_at, 'remaining', n));

    elsif kind in ('cut', 'cut_refund') then
      lot := null;
      if op->>'lotId' is not null then
        select x into lot from jsonb_array_elements(ledger) x where x->>'id' = op->>'lotId' limit 1;
      elsif kind = 'cut_refund' and op->>'label' is not null and op->>'points' is not null then
        select x into lot from jsonb_array_elements(ledger) x
         where x->>'orderId' is not distinct from op->>'orderId' and x->>'reason' = op->>'label' and (x->>'delta')::int = (op->>'points')::int
         limit 1;
      end if;
      if lot is null then
        if kind = 'cut' then continue; end if; -- โอนผู้ซื้อ: ไม่มีก้อนเดิมให้ตัด = ข้าม (เหมือนเดิม)
        raise exception 'lot_missing';
      end if;
      lid := lot->>'id';

      if kind = 'cut_refund' then
        n := (op->>'points')::int;
        if n is null or n <= 0 or (lot->>'delta')::int <> n or (lot->>'remaining')::int <> n then raise exception 'lot_used'; end if;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
          'takes', jsonb_build_array(jsonb_build_object('lotId', lid, 'n', n))));
      else
        cut := coalesce((lot->>'remaining')::int, 0);
        if cut > 0 then
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
          ledger := ledger || jsonb_build_array(jsonb_build_object(
            'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -cut, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId'));
        end if;
      end if;

    elsif kind = 'refund_spend' then
      select x into lot from jsonb_array_elements(ledger) x where x->>'id' = op->>'entryId' limit 1;
      if lot is not null and coalesce((lot->>'refunded')::boolean, false) = false and (lot->>'delta')::int < 0 then
        for t in select value from jsonb_array_elements(coalesce(lot->'takes', '[]'::jsonb)) loop
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = t->>'lotId'
                                                  then jsonb_set(x, '{remaining}', to_jsonb((x->>'remaining')::int + (t->>'n')::int))
                                                  else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        end loop;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = op->>'entryId' then jsonb_set(x, '{refunded}', 'true'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -((lot->>'delta')::int), 'reason', left(coalesce(op->>'reason', ''), 200),
          'orderId', lot->'orderId', 'refund', true));
      end if;

    elsif kind = 'spins' then
      n := (op->>'delta')::int;
      if n is null or abs(n) > 10000 then raise exception 'invalid_op'; end if;
      spins_ := greatest(spins_ + n, 0);

    else
      raise exception 'invalid_op';
    end if;
  end loop;

  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(spins_)), updated_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_ops));
end $$;

revoke all on function public.punpang_award_order(text, integer, integer, integer, numeric) from public, anon;
revoke all on function public.punpang_undo_award(text) from public, anon;
grant execute on function public.punpang_award_order(text, integer, integer, integer, numeric) to authenticated;
grant execute on function public.punpang_undo_award(text) to authenticated;
revoke all on function public.punpang_ledger_apply(text, jsonb) from public, anon;
grant execute on function public.punpang_ledger_apply(text, jsonb) to authenticated;
