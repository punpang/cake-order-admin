-- สั่งล่วงหน้า เฟส 4: ได้แต้มและสิทธิ์หมุนตอนส่งมอบ (ตามสเปกข้อ 13 เฟส 4)
-- สูตรเดียวกับออเดอร์ปกติ (pointsFor ในแอป): ฐาน = ยอดสินค้าสุทธิก่อน VAT ของสินค้าที่คิดแต้ม (ไม่รวมค่าส่ง)
--   · ไม่รวมโปรคะแนนพิเศษ (ตัดสินใจไว้: ไม่ใช้กับสั่งล่วงหน้าในเฟสนี้)
--   · รวมตัวคูณระดับสมาชิก เมื่อโหมดสมาชิกเป็น live (เหมือน punpang_award_order)
-- ฟังก์ชันคำนวณฝั่งเซิร์ฟเวอร์เองจากข้อมูลออร์เดอร์ ไม่รับตัวเลขแต้มจากผู้เรียก
-- กันให้ซ้ำ: ออร์เดอร์ที่มี data.loyalty แล้วจะไม่ให้อีก · เรียกซ้ำได้ปลอดภัย
-- เรียกได้เฉพาะ service_role (Edge Function preorder-admin หลังส่งมอบสำเร็จ)

create or replace function public.punpang_preorder_award_delivery(p_order text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; c record;
  items jsonb; sub numeric := 0; bill numeric := 0; k numeric := 1;
  vr numeric; vmode text; base numeric := 0; base_r numeric;
  earn_per numeric := greatest(public.punpang__pts_cfg('earnPer', 100), 0.01);
  spin_per numeric := greatest(public.punpang__pts_cfg('spinPer', 500), 0.01);
  mcfg jsonb := public.punpang__member_cfg();
  mst jsonb := null; mrmin numeric := null; mmult numeric := 1; cap_mult numeric := 1;
  pts integer; spins integer; sp integer;
  lot_id text := public.punpang__pts_newid();
  exp_at text; label text; ledger jsonb;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  -- ล็อกลูกค้าก่อนออร์เดอร์ (ลำดับเดียวกับ punpang_preorder_mark_delivered)
  if cid is not null then perform 1 from public.punpang_customers where id = cid for update; end if;
  select * into o from public.punpang_preorder_orders where id = p_order for update;

  if o.status is distinct from 'delivered' then return jsonb_build_object('error', 'not_delivered'); end if;
  if o.data->'loyalty' is not null and o.data->'loyalty' <> 'null'::jsonb then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  if cid is null then return jsonb_build_object('ok', true, 'already', false, 'skipped', 'no_customer'); end if;
  select * into c from public.punpang_customers where id = cid;
  if not found then return jsonb_build_object('ok', true, 'already', false, 'skipped', 'no_customer'); end if;

  -- ฐานแต้ม: ยอดสุทธิรายสินค้า (หักส่วนลดทั้งออร์เดอร์ตามสัดส่วน) แล้วตัด VAT ออก ไม่รวมค่าส่งและสินค้า noPoints
  items := coalesce(o.data->'items', '[]'::jsonb);
  select coalesce(sum((x->>'unitPrice')::numeric * (x->>'qty')::numeric), 0) into sub from jsonb_array_elements(items) x;
  bill := greatest(0, -coalesce((o.data->'adjustment'->>'amount')::numeric, 0))
        + coalesce((o.data->'pointsUsed'->>'amount')::numeric, 0)
        + coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(coalesce(o.data->'couponsUsed', '[]'::jsonb)) x), 0);
  if sub > 0 then k := greatest(0, 1 - bill / sub); else k := 0; end if;
  vr := coalesce((o.data->'vat'->>'rate')::numeric, 0);
  vmode := o.data->'vat'->>'mode';
  select coalesce(sum(
           case when vr > 0 and vmode is distinct from 'exclusive'
                then ((x->>'unitPrice')::numeric * (x->>'qty')::numeric * k) * 100 / (100 + vr)
                else ((x->>'unitPrice')::numeric * (x->>'qty')::numeric * k) end), 0)
    into base
    from jsonb_array_elements(items) x
   where not coalesce((x->>'noPoints')::boolean, false);
  base_r := round(base, 2);

  -- ตัวคูณระดับสมาชิก (เฉพาะโหมด live เหมือนออเดอร์ปกติ) · ลูกค้าที่ถูกลบไม่คิด
  if mcfg->>'mode' <> 'off' and not coalesce((c.data->>'deleted')::boolean, false) then
    mst := public.punpang__member_fold(cid, clock_timestamp());
    mrmin := public.punpang__member_renew_min(o.data, mcfg);
    mmult := public.punpang__member_bill_mult(mst, base_r, mrmin, mcfg);
  end if;
  cap_mult := case when mcfg->>'mode' = 'live' then mmult else 1 end;

  pts := floor(base_r * cap_mult / earn_per + 1e-9);
  spins := floor(base_r / spin_per + 1e-9);

  label := 'สั่งล่วงหน้า ' || o.code;
  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  if pts > 0 then
    exp_at := to_char(((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int), 'YYYY-MM-DD');
    ledger := ledger || jsonb_build_array(jsonb_build_object(
      'id', lot_id, 'at', nowz, 'delta', pts, 'reason', label, 'orderId', p_order, 'expiresAt', exp_at, 'remaining', pts));
  end if;
  sp := coalesce((c.data->>'spins')::int, 0) + spins;
  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(sp)), updated_at = now()
   where id = cid;

  update public.punpang_preorder_orders
     set data = jsonb_set(o.data, '{loyalty}', jsonb_build_object(
           'points', pts, 'bonus', 0, 'spins', spins, 'base', base_r,
           'lotId', case when pts > 0 then lot_id else null end)),
         updated_at = now()
   where id = p_order;

  if mst is not null then
    insert into public.punpang_member_events (customer_id, order_id, kind, day, amount, renew_min, mult)
      values (cid, p_order, 'spend', (now() at time zone 'Asia/Bangkok')::date, base_r, mrmin, mmult);
  end if;
  return jsonb_build_object('ok', true, 'already', false, 'points', pts, 'spins', spins);
end $$;

revoke all on function public.punpang_preorder_award_delivery(text, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_award_delivery(text, timestamptz) to service_role;
