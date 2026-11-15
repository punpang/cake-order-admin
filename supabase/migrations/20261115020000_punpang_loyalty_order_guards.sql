-- รอบแก้ 2026-11-15 (ต่อจาก 20261115000000 · รันหลังไฟล์นั้น · รันซ้ำได้ปลอดภัย)
-- ปิดช่องที่ตรวจพบด้วยการเรียกฐานข้อมูลจริง (supabase/tests/security.test.sql รอบนี้):
--   A) คืนเงินเป็นคะแนน (earn ที่อ้างออร์เดอร์) ซ้ำได้หลังคะแนนถูกใช้ไปแล้ว → เพดานต้องสะสมต่อออร์เดอร์ ไม่นับเฉพาะคะแนนที่ยังไม่ใช้
--   B) ออกคะแนนจากออร์เดอร์ของลูกค้าคนหนึ่งให้ลูกค้าอีกคนได้ → คืนเงินต้องเป็นของผู้ซื้อในออร์เดอร์นั้น
--   C) สิทธิ์หมุนที่อ้างออร์เดอร์เพิ่มได้ไม่จำกัดครั้ง → การโอนสิทธิ์โอนได้เฉพาะที่ตัดจากผู้ซื้อเดิมไว้
--   D) ผู้ใช้แอป (ผ่าน PostgREST) แก้ราคา/จำนวนรายการ ส่วนลด ค่าส่ง VAT ยอดงวดที่ชำระ ผู้ซื้อ คะแนน/คูปองที่ใช้ได้ทุกออร์เดอร์
--      → trigger ตรวจรายฟิลด์ตามสิทธิ์ (ไม่เขียนค่าใหม่ลงแถวออร์เดอร์ เพื่อไม่ให้ updated_at ขยับทำให้แอปขัดแย้งตอนบันทึก)
--
-- หลักการบัญชีของคะแนนและสิทธิ์หมุน (เก็บใน punpang_order_issued แยกจากแถวออร์เดอร์):
--   refund_points  คะแนนที่ออกจาก "คืนเงิน" ของออร์เดอร์ (สะสม · ใช้แล้วยังนับ จึงออกซ้ำไม่ได้ · ลดได้เฉพาะตอนตัดก้อนที่ยังไม่ได้ใช้ออกไป)
--   pending_points / pending_exp   คะแนนที่ถูกตัดจากผู้ซื้อเดิม รอโอนให้ผู้ซื้อใหม่ (โอนได้ไม่เกินยอดที่ตัดจริง)
--   pending_spins  สิทธิ์หมุนที่ถูกตัดจากผู้ซื้อเดิม รอโอนให้ผู้ซื้อใหม่ (เช่นเดียวกัน)
-- ทุกหน่วยที่เข้ามาใหม่มาจากการตัดของเดิมเท่านั้น จึงไม่มีการสร้างคะแนน/สิทธิ์หมุนขึ้นมาเอง

-- ============================================================================
-- 1) ตารางยอดที่ออกจากแต่ละออร์เดอร์ (ไม่มี policy · เข้าถึงผ่านฟังก์ชันฝั่งเซิร์ฟเวอร์เท่านั้น)
-- ============================================================================
create table if not exists public.punpang_order_issued (
  order_id text primary key references public.punpang_orders(id) on delete cascade,
  refund_points integer not null default 0 check (refund_points >= 0),
  pending_points integer not null default 0 check (pending_points >= 0),
  pending_exp text,
  pending_spins integer not null default 0 check (pending_spins >= 0),
  updated_at timestamptz not null default now()
);
alter table public.punpang_order_issued enable row level security;
revoke all on public.punpang_order_issued from anon, authenticated;

-- อ่านแถวของออร์เดอร์ (สร้างถ้ายังไม่มี) พร้อมล็อกแถวเพื่อให้การเพิ่ม/ลดยอดต่อออร์เดอร์เรียงกันทีละรายการ
create or replace function public.punpang__issued_row(p_order text)
returns public.punpang_order_issued
language plpgsql
set search_path = ''
as $$
declare r public.punpang_order_issued;
begin
  insert into public.punpang_order_issued (order_id) values (p_order) on conflict (order_id) do nothing;
  select * into r from public.punpang_order_issued where order_id = p_order for update;
  return r;
end $$;
revoke all on function public.punpang__issued_row(text) from public, anon, authenticated;

-- ยกมาจากข้อมูลเดิม: คืนเงินเป็นคะแนนที่เคยออกไปแล้ว (ก้อนที่ไม่ใช่ก้อนของการขาย) นับเป็นยอดที่ออกแล้ว · เกินจริงได้ (ปลอดภัยกว่าต่ำไป)
insert into public.punpang_order_issued (order_id, refund_points)
select s.oid, least(s.issued, 2000000000)::int
  from (
    select g.oid, sum(g.d) as issued
      from (
        select e->>'orderId' as oid,
               e->>'id' as lid,
               case when (e->>'delta') ~ '^[0-9]+$' then (e->>'delta')::int else 0 end as d
          from public.punpang_customers c
          cross join lateral jsonb_array_elements(case when jsonb_typeof(c.data->'ledger') = 'array' then c.data->'ledger' else '[]'::jsonb end) e
         where nullif(e->>'orderId', '') is not null
           and coalesce(e->>'adjust', 'false') <> 'true'
      ) g
      join public.punpang_orders o on o.id = g.oid
     where g.d > 0
       and g.lid is distinct from (o.data->'loyalty'->>'lotId')
     group by g.oid
  ) s
on conflict (order_id) do update set refund_points = excluded.refund_points;

-- ============================================================================
-- 2) สมุดแต้ม/สิทธิ์หมุนหลายรายการ (แทนฉบับ 20261115000000)
--    earn ไม่อ้างออร์เดอร์      → เฉพาะแอดมิน (เหมือนเดิม)
--    earn อ้างออร์เดอร์         → คืนเงิน: ต้องเป็นผู้ซื้อของออร์เดอร์ และสะสมไม่เกินยอดที่ชำระจริง ÷ มูลค่าคะแนน
--    earn อ้างออร์เดอร์ transfer:true → โอน: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้ (ต้องมีสิทธิ์เปลี่ยนผู้ซื้อหรือแอดมิน)
--    spins อ้างออร์เดอร์ (บวก) → โอน: ต้องมี transfer:true และได้ไม่เกินที่ตัดไว้ · ไม่มีการเดาออร์เดอร์จากรายการอื่นในชุดเดียวกันอีก
--    cut / cut_refund / spins (ลบ) ที่อ้างออร์เดอร์ → บันทึกยอดที่รอโอนหรือยอดคืนเงินที่ถูกตัด
--    เกินเพดาน/ไม่ใช่เจ้าของ → error (คืนเงิน) · โอนที่เกินที่ตัดไว้ → โอนเท่าที่มี (ไม่ error)
-- ============================================================================
create or replace function public.punpang_ledger_apply(p_customer text, p_ops jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
  removed integer;
  granted integer;
  lid text;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text;
  new_exp text;
  is_admin boolean;
  is_changer boolean;
  is_refunder boolean;
  oid text;
  lot_oid text;
  orec record;
  iss public.punpang_order_issued;
  pv numeric := greatest(public.punpang__pts_cfg('pointValue', 1), 0.01);
  cap integer;
begin
  if role_ is null or not (public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel') or public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('adjustPoints') or public.punpang_has_perm('manage')) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_ops is null or jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) = 0 or jsonb_array_length(p_ops) > 50 then
    raise exception 'invalid_op';
  end if;
  is_admin := public.punpang_has_perm('manage') or public.punpang_has_perm('adjustPoints');
  is_changer := is_admin or public.punpang_has_perm('changeBuyer');
  is_refunder := is_changer or public.punpang_has_perm('refundPartial') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('cancel');

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
      oid := nullif(op->>'orderId', '');

      if oid is null then
        if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'expiresAt', exp_at, 'remaining', n));
        continue;
      end if;

      select * into orec from public.punpang_orders where id = oid;
      if not found then raise exception 'invalid_op'; end if;
      iss := public.punpang__issued_row(oid);

      if coalesce((op->>'transfer')::boolean, false) then
        -- โอนคะแนนของออร์เดอร์: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้ (ไม่มีการสร้างคะแนนขึ้นใหม่)
        if not is_changer then raise exception 'forbidden' using errcode = '42501'; end if;
        granted := least(n, iss.pending_points);
        if granted <= 0 then continue; end if;
        new_exp := coalesce(iss.pending_exp, exp_at);
        update public.punpang_order_issued
           set pending_points = pending_points - granted,
               pending_exp = case when pending_points - granted > 0 then pending_exp else null end,
               updated_at = now()
         where order_id = oid;
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', granted, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', oid,
          'expiresAt', new_exp, 'remaining', granted, 'src', 'transfer'));
      else
        -- คืนเงินเป็นคะแนน: ต้องเป็นผู้ซื้อของออร์เดอร์ และสะสมทุกครั้งไม่เกินยอดที่ชำระจริง ÷ มูลค่าคะแนน
        if not is_refunder then raise exception 'forbidden' using errcode = '42501'; end if;
        if orec.customer_id is distinct from p_customer then raise exception 'order_customer_mismatch' using errcode = '42501'; end if;
        cap := floor(public.punpang__order_paid(orec.data) / pv)::int + 1;
        if iss.refund_points + n > cap then raise exception 'cap_exceeded'; end if;
        update public.punpang_order_issued set refund_points = refund_points + n, updated_at = now() where order_id = oid;
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', lid, 'at', nowz, 'delta', n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', oid,
          'expiresAt', exp_at, 'remaining', n, 'src', 'refund'));
      end if;

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
      lot_oid := nullif(lot->>'orderId', '');

      if kind = 'cut_refund' then
        n := (op->>'points')::int;
        if n is null or n <= 0 or (lot->>'delta')::int <> n or (lot->>'remaining')::int <> n then raise exception 'lot_used'; end if;
        removed := n;
        ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                     from jsonb_array_elements(ledger) with ordinality as y(x, ord));
        ledger := ledger || jsonb_build_array(jsonb_build_object(
          'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -n, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId',
          'takes', jsonb_build_array(jsonb_build_object('lotId', lid, 'n', n))));
      else
        cut := coalesce((lot->>'remaining')::int, 0);
        removed := cut;
        if cut > 0 then
          ledger := (select coalesce(jsonb_agg(case when x->>'id' = lid then jsonb_set(x, '{remaining}', '0'::jsonb) else x end order by ord), '[]'::jsonb)
                       from jsonb_array_elements(ledger) with ordinality as y(x, ord));
          ledger := ledger || jsonb_build_array(jsonb_build_object(
            'id', public.punpang__pts_newid(), 'at', nowz, 'delta', -cut, 'reason', left(coalesce(op->>'reason', ''), 200), 'orderId', op->>'orderId'));
        end if;
      end if;

      -- บัญชีของออร์เดอร์ที่ก้อนนี้ผูกอยู่: ก้อนของการขาย/โอน → รอโอนต่อ · ก้อนคืนเงิน → ลดยอดที่ออกแล้ว
      if removed > 0 and lot_oid is not null and exists (select 1 from public.punpang_orders where id = lot_oid) then
        iss := public.punpang__issued_row(lot_oid);
        if (lot->>'src') = 'transfer'
           or ((lot->>'src') is null and lid is not distinct from (select o.data->'loyalty'->>'lotId' from public.punpang_orders o where o.id = lot_oid)) then
          update public.punpang_order_issued
             set pending_points = pending_points + removed,
                 pending_exp = least(coalesce(iss.pending_exp, '9999-12-31'), coalesce(lot->>'expiresAt', exp_at)),
                 updated_at = now()
           where order_id = lot_oid;
        else
          update public.punpang_order_issued
             set refund_points = greatest(refund_points - removed, 0), updated_at = now()
           where order_id = lot_oid;
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
      oid := nullif(op->>'orderId', '');

      if n > 0 then
        if oid is null then
          if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
          spins_ := spins_ + n;
        else
          select * into orec from public.punpang_orders where id = oid;
          if not found then raise exception 'invalid_op'; end if;
          if coalesce((op->>'transfer')::boolean, false) then
            -- โอนสิทธิ์หมุนของออร์เดอร์: ได้ไม่เกินที่ตัดจากผู้ซื้อเดิมไว้
            if not is_changer then raise exception 'forbidden' using errcode = '42501'; end if;
            iss := public.punpang__issued_row(oid);
            granted := least(n, iss.pending_spins);
            if granted > 0 then
              update public.punpang_order_issued set pending_spins = pending_spins - granted, updated_at = now() where order_id = oid;
              spins_ := spins_ + granted;
            end if;
          else
            -- สิทธิ์หมุนที่ผูกกับออร์เดอร์โดยตรง (ไม่ใช่การโอน) เป็นของแอดมินเท่านั้น
            if not is_admin then raise exception 'forbidden' using errcode = '42501'; end if;
            spins_ := spins_ + n;
          end if;
        end if;
      else
        removed := least(spins_, -n);
        spins_ := spins_ - removed;
        if oid is not null and removed > 0 then
          select * into orec from public.punpang_orders where id = oid;
          if not found then raise exception 'invalid_op'; end if;
          iss := public.punpang__issued_row(oid);
          update public.punpang_order_issued set pending_spins = pending_spins + removed, updated_at = now() where order_id = oid;
        end if;
      end if;

    else
      raise exception 'invalid_op';
    end if;
  end loop;

  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(spins_)), updated_at = now()
   where id = c.id;
  return jsonb_build_object('ok', true, 'count', jsonb_array_length(p_ops));
end $$;

revoke all on function public.punpang_ledger_apply(text, jsonb) from public, anon;
grant execute on function public.punpang_ledger_apply(text, jsonb) to authenticated;

-- ============================================================================
-- 3) ตรวจรายฟิลด์ของออร์เดอร์ที่ผู้ใช้แอปแก้ผ่าน PostgREST (RPC และ Edge Function ไม่ถูกกั้นที่นี่)
--    ผู้มีสิทธิ์ manage ผ่านทุกข้อ (เหมือนเดิม) · ข้อที่ไม่ตรงสิทธิ์ → 42501
-- ============================================================================
create or replace function public.punpang__items_money(d jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(s.k, s.v), '{}'::jsonb)
    from (
      select coalesce(t.i->>'id', '#' || t.n::text) as k,
             jsonb_build_object('u', t.i->'unitPrice', 'r', t.i->'regularPrice', 'q', t.i->'qty', 'p', t.i->'retailPrice') as v
        from jsonb_array_elements(case when jsonb_typeof(d->'items') = 'array' then d->'items' else '[]'::jsonb end) with ordinality as t(i, n)
    ) s
$$;

create or replace function public.punpang_orders_field_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  pr record;
  np jsonb;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op <> 'UPDATE' then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- ราคา/จำนวน/รายการ: แอดมินแก้รายการ หรือผู้ปรับราคา หรือผู้สร้างออร์เดอร์ตอนยังเป็นร่าง/รอชำระ
  if public.punpang__items_money(old.data) is distinct from public.punpang__items_money(new.data) then
    if not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
            or (public.punpang_has_perm('createOrder') and old.status in ('draft', 'awaiting_payment'))) then
      raise exception 'no permission to change item prices or quantities' using errcode = '42501';
    end if;
  end if;

  -- ปรับราคา/ส่วนลด (adjustment) → ผู้ปรับราคาเท่านั้น
  if old.data->'adjustment' is distinct from new.data->'adjustment' and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to change adjustment' using errcode = '42501';
  end if;

  -- ค่าส่ง/VAT
  if (old.data->'shippingFee' is distinct from new.data->'shippingFee' or old.data->'vat' is distinct from new.data->'vat')
     and not (public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
              or public.punpang_has_perm('createOrder') or public.punpang_has_perm('editPickup')) then
    raise exception 'no permission to change shipping fee or VAT' using errcode = '42501';
  end if;

  -- จำนวนเงินของงวดที่มีอยู่แล้ว: งวดที่ยืนยันแล้วต้องมีสิทธิ์ยืนยัน/ยกเลิกยืนยัน/คืนเงิน · งวดที่แจ้งต้องมีสิทธิ์แจ้งยอด/ยืนยัน
  for pr in
    select v.value as p
      from jsonb_array_elements(case when jsonb_typeof(old.data->'payments') = 'array' then old.data->'payments' else '[]'::jsonb end) as v(value)
  loop
    if pr.p->>'id' is null then continue; end if;
    select x.value into np
      from jsonb_array_elements(case when jsonb_typeof(new.data->'payments') = 'array' then new.data->'payments' else '[]'::jsonb end) as x(value)
     where x.value->>'id' = pr.p->>'id'
     limit 1;
    if np is not null and (pr.p->'amount') is distinct from (np->'amount') then
      if pr.p->>'status' = 'confirmed' then
        if not (public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial')) then
          raise exception 'no permission to change a confirmed payment amount' using errcode = '42501';
        end if;
      elsif not (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
        raise exception 'no permission to change a payment amount' using errcode = '42501';
      end if;
    end if;
  end loop;

  -- ผู้ซื้อของออร์เดอร์ (เปลี่ยนผู้ซื้อ)
  if new.customer_id is distinct from old.customer_id and not public.punpang_has_perm('changeBuyer') then
    raise exception 'no permission to change the buyer' using errcode = '42501';
  end if;

  -- คะแนนที่ใช้: ตั้งค่าใหม่ต้องผ่านเซิร์ฟเวอร์ (RPC punpang_apply_points) · ลบออกได้ตามสิทธิ์
  if old.data->'pointsUsed' is distinct from new.data->'pointsUsed' then
    if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
      raise exception 'points can only be applied through the server' using errcode = '42501';
    end if;
    if not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
            or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
      raise exception 'no permission to remove points from the order' using errcode = '42501';
    end if;
  end if;

  -- คูปองที่ใช้ในออร์เดอร์ (ส่วนลด)
  if old.data->'couponsUsed' is distinct from new.data->'couponsUsed'
     and not (public.punpang_has_perm('useLoyalty') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('cancel')
              or public.punpang_has_perm('posVoid') or public.punpang_has_perm('refundPartial')) then
    raise exception 'no permission to change coupons on the order' using errcode = '42501';
  end if;

  return new;
end $$;
revoke all on function public.punpang_orders_field_guard() from public, anon, authenticated;

drop trigger if exists punpang_orders_field_guard on public.punpang_orders;
create trigger punpang_orders_field_guard
  before update on public.punpang_orders
  for each row execute function public.punpang_orders_field_guard();
