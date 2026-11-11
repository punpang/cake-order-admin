-- แลกของ/หมุนกาชาของลูกค้า ทำบนเซิร์ฟเวอร์ (เดิมทำในเบราว์เซอร์อย่างเดียว · รีโหลดแล้วหาย)
-- เรียกได้จาก service role เท่านั้น (Edge Function customer-loyalty ตรวจเซสชันลูกค้าก่อนเรียก) · ไม่ให้ anon/authenticated เรียกตรง
-- ตรรกะเหมือนฝั่งแอป: ตัดคะแนนจากก้อนที่ใกล้หมดอายุก่อน (FIFO) · คูปองตามรูปแบบ newCoupon · สุ่มรางวัลแบบถ่วงน้ำหนักเหมือน pickPrize
-- ตั้งค่า rewards / gachaPrizes ยังไม่เคยถูกซิงก์ขึ้นฐานข้อมูล (แอปใช้ค่าตั้งต้น) → seed ค่าเดียวกับค่าตั้งต้นของแอป (on conflict do nothing: ไม่ทับค่าที่ร้านแก้แล้ว)

insert into public.punpang_kv (collection, id, data) values
  ('config', 'rewards', '{"v": [
    {"id": "rw1", "name": "เทียนวันเกิดเซ็ต", "points": 30, "active": true},
    {"id": "rw2", "name": "คัพเค้ก 1 ชิ้น", "points": 80, "active": true},
    {"id": "rw3", "name": "เค้ก 1 ปอนด์", "points": 500, "active": true},
    {"id": "rw4", "name": "คูปองส่วนลด 50 บาท (ตัวอย่าง)", "kind": "coupon", "points": 100, "amount": 50, "minSpend": 200, "validDays": 30, "active": true}
  ]}'::jsonb),
  ('config', 'gachaPrizes', '{"v": [
    {"id": "gp1", "name": "10 คะแนน", "type": "points", "value": 10, "chance": 30, "active": true},
    {"id": "gp2", "name": "50 คะแนน", "type": "points", "value": 50, "chance": 10, "active": true},
    {"id": "gp3", "name": "คัพเค้ก 1 ชิ้น", "type": "reward", "rewardId": "rw2", "chance": 10, "active": true},
    {"id": "gp4", "name": "ส่วนลด 50 บาท", "type": "discount", "value": 50, "chance": 15, "active": true},
    {"id": "gp5", "name": "เสียใจด้วย", "type": "none", "chance": 35, "active": true}
  ]}'::jsonb)
on conflict (collection, id) do nothing;

-- ตัดคะแนนจากก้อนที่ใกล้หมดอายุก่อน → คืน { ledger, balance } หรือ { error: 'insufficient', balance }
create or replace function public.punpang__cust_spend(p_ledger jsonb, p_points integer, p_today text, p_reason text, p_nowz text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  bal integer; takes jsonb; nmap jsonb; out_ jsonb;
begin
  with lots as (
    select ord::int as ord, e->>'id' as id, (e->>'remaining')::int as rem, coalesce(e->>'expiresAt', '9999') as exp
      from jsonb_array_elements(p_ledger) with ordinality as t(e, ord)
     where (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0 and (e->>'expiresAt' is null or e->>'expiresAt' >= p_today)
  ), cum as (
    select ord, id, rem, coalesce(sum(rem) over (order by exp, ord rows between unbounded preceding and 1 preceding), 0) as before from lots
  ), tk as (
    select ord, id, least(rem, greatest(p_points - before, 0)) as k from cum
  )
  select coalesce((select sum(rem) from lots), 0),
         (select jsonb_agg(jsonb_build_object('lotId', id, 'n', k) order by ord) from tk where k > 0),
         (select jsonb_object_agg(ord::text, k) from tk where k > 0)
    into bal, takes, nmap;
  if bal < p_points then return jsonb_build_object('error', 'insufficient', 'balance', bal); end if;
  select coalesce(jsonb_agg(case when nmap ? (ord::text)
                                 then jsonb_set(e, '{remaining}', to_jsonb((e->>'remaining')::int - (nmap->>(ord::text))::int))
                                 else e end order by ord), '[]'::jsonb)
    into out_ from jsonb_array_elements(p_ledger) with ordinality as t(e, ord);
  out_ := out_ || jsonb_build_array(jsonb_build_object(
    'id', public.punpang__pts_newid(), 'at', p_nowz, 'delta', -p_points, 'reason', p_reason, 'orderId', null, 'takes', takes));
  return jsonb_build_object('ledger', out_, 'balance', bal);
end $$;

-- สร้างคูปองลูกค้า (รูปแบบเดียวกับ newCoupon ฝั่งแอป) → คืนรหัสคูปอง
create or replace function public.punpang__cust_new_coupon(p_customer text, p_data jsonb, p_cfg jsonb, p_today text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  cid text := 'cp' || public.punpang__pts_newid();
  cp jsonb;
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  cp := jsonb_build_object('customerId', p_customer, 'status', 'pending', 'createdAt', nowz,
          'expiresAt', to_char(p_today::date + coalesce((p_cfg->>'couponExpireDays')::int, 30), 'YYYY-MM-DD'))
        || p_data;
  insert into public.punpang_records (collection, id, data) values ('coupons', cid, cp);
  return cid;
end $$;

-- แลกของ: ตัดคะแนนตามราคาของรางวัล + สร้างคูปอง/ของรางวัล (ธุรกรรมเดียว · ไม่พอ = ไม่แก้อะไร)
create or replace function public.punpang_cust_redeem(p_customer text, p_reward text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; cfg jsonb; rewards jsonb; rw jsonb; pts integer; sp jsonb; cp_id text; cdata jsonb;
  today_ text := public.punpang__pts_today();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  data_ jsonb;
begin
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'loyalty';
  select data->'v' into rewards from public.punpang_kv where collection = 'config' and id = 'rewards';
  if cfg is null or rewards is null then return jsonb_build_object('error', 'config_missing'); end if;
  select e into rw from jsonb_array_elements(rewards) e where e->>'id' = p_reward and coalesce((e->>'active')::boolean, true) limit 1;
  if rw is null then return jsonb_build_object('error', 'no_reward'); end if;
  pts := coalesce((rw->>'points')::int, 0);
  if pts <= 0 then return jsonb_build_object('error', 'invalid'); end if;

  sp := public.punpang__cust_spend(coalesce(c.data->'ledger', '[]'::jsonb), pts, today_, 'แลก ' || (rw->>'name'), nowz);
  if sp ? 'error' then return sp; end if;

  if rw->>'kind' = 'coupon' then
    data_ := jsonb_build_object('type', 'discount', 'rewardId', rw->>'id', 'points', pts, 'name', rw->>'name',
                                'amount', coalesce((rw->>'amount')::numeric, 0), 'minSpend', coalesce((rw->>'minSpend')::numeric, 0), 'source', 'redeem');
    if coalesce((rw->>'validDays')::int, 0) > 0 then
      data_ := data_ || jsonb_build_object('expiresAt', to_char(today_::date + (rw->>'validDays')::int, 'YYYY-MM-DD'));
    end if;
  else
    data_ := jsonb_build_object('type', 'reward', 'rewardId', rw->>'id', 'points', pts, 'name', rw->>'name', 'source', 'redeem');
  end if;
  cp_id := public.punpang__cust_new_coupon(p_customer, data_, cfg, today_);

  update public.punpang_customers set data = jsonb_set(c.data, '{ledger}', sp->'ledger'), updated_at = now() where id = c.id;
  select jsonb_build_object('id', r.id) || r.data into cdata from public.punpang_records r where r.collection = 'coupons' and r.id = cp_id;
  return jsonb_build_object('ok', true, 'coupon', cdata, 'balance', (sp->>'balance')::int - pts);
end $$;

-- หมุนกาชา: ใช้สิทธิ์หมุน (spins) หรือคะแนน (spinCost) · เลือกรางวัลก่อนตัดอะไร (ไม่มีรางวัล = ไม่ตัด)
create or replace function public.punpang_cust_spin(p_customer text, p_use_points boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c record; cfg jsonb; prizes jsonb; rewards jsonb; prize jsonb; rw jsonb; cost integer := 0; spins_ integer;
  v integer; ledger jsonb; sp jsonb; cp_id text;
  today_ text := public.punpang__pts_today();
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  select * into c from public.punpang_customers where id = p_customer for update;
  if not found or coalesce((c.data->>'deleted')::boolean, false) then return jsonb_build_object('error', 'no_customer'); end if;
  select data->'v' into cfg from public.punpang_kv where collection = 'config' and id = 'loyalty';
  select data->'v' into prizes from public.punpang_kv where collection = 'config' and id = 'gachaPrizes';
  select data->'v' into rewards from public.punpang_kv where collection = 'config' and id = 'rewards';
  if cfg is null or prizes is null or rewards is null then return jsonb_build_object('error', 'config_missing'); end if;

  spins_ := coalesce((c.data->>'spins')::int, 0);
  if p_use_points then
    cost := coalesce((cfg->>'spinCost')::int, 0);
    if cost <= 0 then return jsonb_build_object('error', 'invalid'); end if;
  elsif spins_ <= 0 then
    return jsonb_build_object('error', 'no_spin');
  end if;

  -- สุ่มรางวัล: ถ่วงน้ำหนัก (เหมือน pickPrize) · รางวัลที่ปิดหรือโอกาส 0 ไม่นับ
  select q.e into prize from (
    select e, ord, sum((e->>'chance')::numeric) over (order by ord) as upto, sum((e->>'chance')::numeric) over () as total
      from jsonb_array_elements(prizes) with ordinality as t(e, ord)
     where coalesce((e->>'active')::boolean, true) and coalesce((e->>'chance')::numeric, 0) > 0
  ) q
  where q.upto > random() * q.total
  order by q.ord limit 1;
  if prize is null then return jsonb_build_object('error', 'no_prize'); end if;

  ledger := coalesce(c.data->'ledger', '[]'::jsonb);
  if p_use_points then
    sp := public.punpang__cust_spend(ledger, cost, today_, 'หมุนกาชา', nowz);
    if sp ? 'error' then return sp; end if;
    ledger := sp->'ledger';
  else
    spins_ := spins_ - 1;
  end if;

  -- ให้รางวัล (เหมือนฝั่งแอป)
  v := round(coalesce((prize->>'value')::numeric, 0))::int;
  if prize->>'type' = 'points' and v > 0 then
    ledger := ledger || jsonb_build_array(jsonb_build_object(
      'id', public.punpang__pts_newid(), 'at', nowz, 'delta', v, 'reason', 'กาชา: ' || (prize->>'name'), 'orderId', null,
      'expiresAt', to_char(today_::date + coalesce((cfg->>'pointExpireDays')::int, 365), 'YYYY-MM-DD'), 'remaining', v));
  elsif prize->>'type' = 'reward' then
    select e into rw from jsonb_array_elements(rewards) e where e->>'id' = prize->>'rewardId' limit 1;
    cp_id := public.punpang__cust_new_coupon(p_customer,
      jsonb_build_object('type', 'reward', 'rewardId', prize->>'rewardId', 'name', coalesce(rw->>'name', prize->>'name'), 'source', 'gacha'), cfg, today_);
  elsif prize->>'type' = 'discount' then
    cp_id := public.punpang__cust_new_coupon(p_customer,
      jsonb_build_object('type', 'discount', 'amount', coalesce((prize->>'value')::numeric, 0), 'name', prize->>'name', 'source', 'gacha'), cfg, today_);
  end if;

  update public.punpang_customers
     set data = jsonb_set(jsonb_set(c.data, '{ledger}', ledger), '{spins}', to_jsonb(spins_)), updated_at = now()
   where id = c.id;
  insert into public.punpang_records (collection, id, data) values ('spinLog', 'sp' || public.punpang__pts_newid(),
    jsonb_build_object('customerId', p_customer, 'at', nowz, 'prizeId', prize->>'id', 'prizeName', prize->>'name',
                       'via', case when p_use_points then 'points' else 'spin' end));
  return jsonb_build_object('ok', true, 'prize', prize, 'couponId', cp_id);
end $$;

revoke all on function public.punpang__cust_spend(jsonb, integer, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.punpang__cust_new_coupon(text, jsonb, jsonb, text) from public, anon, authenticated, service_role;
revoke all on function public.punpang_cust_redeem(text, text) from public, anon, authenticated;
revoke all on function public.punpang_cust_spin(text, boolean) from public, anon, authenticated;
grant execute on function public.punpang_cust_redeem(text, text) to service_role;
grant execute on function public.punpang_cust_spin(text, boolean) to service_role;
