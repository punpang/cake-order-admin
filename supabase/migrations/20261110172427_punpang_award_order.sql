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
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
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
  if role_ is null then raise exception 'forbidden' using errcode = '42501'; end if;
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

revoke all on function public.punpang_award_order(text, integer, integer, integer, numeric) from public, anon;
revoke all on function public.punpang_undo_award(text) from public, anon;
grant execute on function public.punpang_award_order(text, integer, integer, integer, numeric) to authenticated;
grant execute on function public.punpang_undo_award(text) to authenticated;
