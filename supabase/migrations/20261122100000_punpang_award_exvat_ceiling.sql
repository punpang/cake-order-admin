-- ขั้น 2: เพดานฐานแต้มตอนส่งมอบ "ก่อน VAT" (รอบ 2026-11-22 · ต่อจากแก้แต้มก่อน VAT ฝั่งแอป)
-- เดิม punpang_award_order ตรวจฐาน ≤ ยอดสินค้ารวม (รวม VAT) → บิล VAT ใน ยังให้ฐานเกินจริงราว 7%
-- ใหม่: VAT ใน หารออกก่อน (สูตรเดียวกับ pointsFor ในแอป) · VAT นอก/ไม่มี VAT = ยอดเดิม · ค่าส่งไม่นับ
-- เปลี่ยนเฉพาะบรรทัดเพดาน · ฟังก์ชันอื่นและออร์เดอร์ที่ให้แต้มแล้วไม่เปลี่ยน (ตรวจ already_awarded ก่อนเสมอ)

-- ยอดสินค้า "ก่อน VAT" ของออร์เดอร์ (ใช้เป็นเพดานฐานแต้ม) · ไม่แตะ punpang__order_goods ที่คูปอง/เพดานยอดใช้ร่วมกัน
create or replace function public.punpang__order_goods_exvat(d jsonb)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when x.r > 0 and coalesce(d->'vat'->>'mode', 'inclusive') <> 'exclusive'
              then x.g * 100 / (100 + x.r) else x.g end
  from (select public.punpang__order_goods(d) as g,
               case when (d->'vat'->>'rate') ~ '^[0-9]+(\.[0-9]+)?$' then (d->'vat'->>'rate')::numeric else 0 end as r) x
$$;

revoke all on function public.punpang__order_goods_exvat(jsonb) from public, anon, authenticated;

create or replace function public.punpang_award_order(p_order text, p_points integer, p_bonus integer, p_spins integer, p_base numeric)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  role_ text := public.punpang__pts_staff();
  o record; c record; ledger jsonb; lot_id text := public.punpang__pts_newid();
  exp_at text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  label text;
  sp integer;
  earn_per numeric := greatest(public.punpang__pts_cfg('earnPer', 100), 0.01);
  spin_per numeric := greatest(public.punpang__pts_cfg('spinPer', 500), 0.01);
  cap_points numeric;
  cap_spins numeric;
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
  if o.status is distinct from 'delivered' then return jsonb_build_object('error', 'not_delivered'); end if;
  if o.data->'loyalty' is not null and o.data->'loyalty' <> 'null'::jsonb then
    return jsonb_build_object('error', 'already_awarded');
  end if;

  -- เพดานจากข้อมูลของออร์เดอร์เอง (ค่าที่ไคลเอนต์ส่งมาต้องไม่เกินที่สูตรของแอปให้ได้) · เผื่อเศษปัดสองตำแหน่ง 0.01
  if p_base > public.punpang__order_goods_exvat(o.data) + 0.01 or p_bonus > p_points then
    return jsonb_build_object('error', 'invalid');
  end if;
  cap_points := floor((p_base + 0.01) * public.punpang__pts_maxmult() / earn_per + 1e-9);
  cap_spins := floor((p_base + 0.01) / spin_per + 1e-9);
  if p_points > cap_points or p_spins > cap_spins then
    return jsonb_build_object('error', 'invalid');
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

revoke all on function public.punpang_award_order(text, integer, integer, integer, numeric) from public, anon;
grant execute on function public.punpang_award_order(text, integer, integer, integer, numeric) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่และฟังก์ชันที่แก้แล้วไปยังสำเนา punpang_test ให้ตรงกับ public (เหมือน migration อื่นที่เพิ่มฟังก์ชัน)
select punpang_test.punpang_test_sync();
