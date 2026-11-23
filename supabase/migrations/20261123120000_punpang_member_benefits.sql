-- สิทธิประโยชน์สมาชิกอัตโนมัติ (สเปก 4 ระดับ · ระบบอัตโนมัติ 100%)
-- 1) เกณฑ์ระดับก่อน VAT 0 / 500 / 2,500 / 5,000 · ตัวคูณ x1 / x2 / x3 / x5 · ต่ออายุ 150 บาทรวม VAT (ตั้งค่า renewGross เดิม)
-- 2) โบนัสต้อนรับ +100 แต้ม และโบนัสเลื่อนระดับ +50 / +100 / +200 แต้ม (ครั้งเดียวตลอดชีพ)
--    เฉพาะลูกค้าที่สมัครหลังเวลา bonusFrom และเฉพาะโหมดใช้จริง · แต้มมีอายุเท่าแต้มทั่วไป
-- 3) คูปองส่วนลด 10 บาทของ LV4 ทุกวันที่ 1 เวลาไทย 00:05 น. (เฉพาะสถานะ Active ที่ซื้อเดือนก่อนครบ 150 บาทก่อน VAT) หมดอายุสิ้นเดือน
-- ไม่รวมสิทธิวันเกิด (รอแก้ประกาศความเป็นส่วนตัวก่อน)

-- ---------- 1) ตั้งค่า: ค่าเริ่มต้นตามสเปก + bonusFrom (เวลาเปิดใช้โบนัส · ไม่มี = ไม่มีโบนัส) ----------
create or replace function public.punpang__member_cfg()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  c jsonb := jsonb_build_object(
    'mode', 'off',
    'levels', '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":500,"mult":2},{"name":"LV3","min":2500,"mult":3},{"name":"LV4","min":5000,"mult":5}]'::jsonb,
    'renewGross', 150, 'inactiveDays', 90, 'goldenDays', 14, 'downgradeDays', 365, 'bigBill', 500, 'bonusFrom', null);
  kv jsonb;
  lv jsonb;
begin
  select k.data->'v' into kv from public.punpang_kv k where k.collection = 'config' and k.id = 'memberLevels';
  if jsonb_typeof(kv) = 'object' then c := c || kv; end if;
  -- ตรวจชนิดข้อมูลก่อนแปลงเป็นตัวเลขทุกครั้ง
  if coalesce(c->>'mode', '') not in ('off', 'shadow', 'live')
     or jsonb_typeof(c->'levels') is distinct from 'array'
     or jsonb_typeof(c->'renewGross') is distinct from 'number' or jsonb_typeof(c->'inactiveDays') is distinct from 'number'
     or jsonb_typeof(c->'goldenDays') is distinct from 'number' or jsonb_typeof(c->'downgradeDays') is distinct from 'number'
     or jsonb_typeof(c->'bigBill') is distinct from 'number'
     or coalesce(jsonb_typeof(c->'bonusFrom'), 'null') not in ('null', 'string') then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  lv := c->'levels';
  if jsonb_array_length(lv) not between 1 and 10 then return jsonb_set(c, '{mode}', '"off"'::jsonb); end if;
  if exists (select 1 from jsonb_array_elements(lv) e
              where not (case when jsonb_typeof(e) = 'object' and jsonb_typeof(e->'min') = 'number' and jsonb_typeof(e->'mult') = 'number'
                              then (e->>'min')::numeric >= 0 and (e->>'mult')::numeric >= 1
                              else false end)) then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  -- ขั้นแรกต้องเริ่มที่ 0 และเกณฑ์ยอดสะสมต้องเพิ่มขึ้นทุกขั้น
  if (lv->0->>'min')::numeric <> 0 or exists (
       select 1 from (select (e->>'min')::numeric as m, lag((e->>'min')::numeric) over (order by o) as pm
                        from jsonb_array_elements(lv) with ordinality x(e, o)) s
        where s.pm is not null and s.m <= s.pm) then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  -- ลดขั้นต้องหลังช่วงใช้งาน (ค่ามากกว่า inactiveDays ซึ่งต้องอย่างน้อย 1 อยู่แล้ว) มิฉะนั้นสถานะจะผิด
  if (c->>'renewGross')::numeric <= 0 or (c->>'inactiveDays')::numeric < 1 or (c->>'goldenDays')::numeric < 0
     or (c->>'downgradeDays')::numeric <= (c->>'inactiveDays')::numeric or (c->>'bigBill')::numeric < 0 then
    return jsonb_set(c, '{mode}', '"off"'::jsonb);
  end if;
  return c;
end $$;
revoke all on function public.punpang__member_cfg() from public, anon, authenticated;

-- ค่าที่ร้านตั้งไว้แล้วบน production: เปลี่ยนเกณฑ์ระดับเป็นตามสเปก และบันทึกเวลาเปิดโบนัส (ตั้งครั้งเดียวตอนปล่อยงาน)
update public.punpang_kv
   set data = jsonb_set(jsonb_set(data, '{v,levels}',
         '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":500,"mult":2},{"name":"LV3","min":2500,"mult":3},{"name":"LV4","min":5000,"mult":5}]'::jsonb),
         '{v,bonusFrom}', to_jsonb(to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
 where collection = 'config' and id = 'memberLevels' and jsonb_typeof(data->'v') = 'object';

-- ---------- 2) โบนัสแต้ม: ประเภท bonus ในบันทึกสมาชิก (ไม่เข้าการคำนวณระดับ) ----------
alter table public.punpang_member_events drop constraint if exists punpang_member_events_kind_check;
alter table public.punpang_member_events add constraint punpang_member_events_kind_check check (kind in ('spend', 'undo', 'bonus'));

-- เพิ่มก้อนแต้มเข้ากระเป๋าแต้มของลูกค้า (รูปแบบเดียวกับก้อนแต้มจากออร์เดอร์)
create or replace function public.punpang__member_bonus_lot(p_customer text, p_pts integer, p_label text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  nowz text := to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  exp_at text := to_char((now() at time zone 'Asia/Bangkok')::date + (public.punpang__pts_cfg('pointExpireDays', 365))::int, 'YYYY-MM-DD');
  lot_id text := 'bn_' || substr(md5(p_customer || p_label || clock_timestamp()::text), 1, 16);
  lot jsonb := jsonb_build_object('id', lot_id, 'at', nowz, 'delta', p_pts, 'reason', p_label, 'orderId', null,
                                  'expiresAt', exp_at, 'remaining', p_pts);
begin
  update public.punpang_customers
     set data = jsonb_set(data, '{ledger}', coalesce(data->'ledger', '[]'::jsonb) || jsonb_build_array(lot)), updated_at = now()
   where id = p_customer;
end $$;
revoke all on function public.punpang__member_bonus_lot(text, integer, text) from public, anon, authenticated;

-- ตรวจและให้โบนัสที่ยังไม่เคยได้ (ทำซ้ำได้ไม่ให้ซ้ำ)
create or replace function public.punpang__member_bonus_sync(p_customer text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  bf timestamptz := nullif(cfg->>'bonusFrom', '')::timestamptz;
  cust record;
  st jsonb;
  lvl int;
  l int;
  amt int;
  today date := (now() at time zone 'Asia/Bangkok')::date;
begin
  if bf is null or cfg->>'mode' <> 'live' then return; end if;
  select c.created_at, coalesce((c.data->>'deleted')::boolean, false) as del into cust
    from public.punpang_customers c where c.id = p_customer;
  if not found or cust.del or cust.created_at < bf then return; end if;
  if not exists (select 1 from public.punpang_member_events where customer_id = p_customer and order_id = 'bonus:welcome') then
    insert into public.punpang_member_events (customer_id, order_id, kind, day, amount)
      values (p_customer, 'bonus:welcome', 'bonus', today, 0);
    perform public.punpang__member_bonus_lot(p_customer, 100, 'โบนัสต้อนรับสมาชิก');
  end if;
  st := public.punpang__member_fold(p_customer, now());
  lvl := (st->>'level')::int;
  for l in 2..lvl loop
    if not exists (select 1 from public.punpang_member_events where customer_id = p_customer and order_id = 'bonus:level:' || l) then
      insert into public.punpang_member_events (customer_id, order_id, kind, day, amount)
        values (p_customer, 'bonus:level:' || l, 'bonus', today, 0);
      amt := case l when 2 then 50 when 3 then 100 when 4 then 200 else 0 end;
      if amt > 0 then perform public.punpang__member_bonus_lot(p_customer, amt, 'โบนัสเลื่อนเป็น LV' || l); end if;
    end if;
  end loop;
end $$;
revoke all on function public.punpang__member_bonus_sync(text) from public, anon, authenticated;

create or replace function public.punpang__member_bonus_on_spend()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.punpang__member_bonus_sync(new.customer_id);
  return null;
end $$;
revoke all on function public.punpang__member_bonus_on_spend() from public, anon, authenticated;
drop trigger if exists punpang_member_events_bonus on public.punpang_member_events;
create trigger punpang_member_events_bonus after insert on public.punpang_member_events
  for each row when (new.kind = 'spend')
  execute function public.punpang__member_bonus_on_spend();

create or replace function public.punpang__member_bonus_on_customer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.punpang__member_bonus_sync(new.id);
  return null;
end $$;
revoke all on function public.punpang__member_bonus_on_customer() from public, anon, authenticated;
drop trigger if exists punpang_customers_member_bonus on public.punpang_customers;
create trigger punpang_customers_member_bonus after insert on public.punpang_customers
  for each row execute function public.punpang__member_bonus_on_customer();

-- ---------- 3) คูปอง LV4 รายเดือน (ทำงานทุกวัน แต่ออกคูปองเฉพาะวันที่ 1 เวลาไทย) ----------
create or replace function public.punpang__member_monthly_coupons(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare
  cfg jsonb := public.punpang__member_cfg();
  today date := (p_now at time zone 'Asia/Bangkok')::date;
  prev_start date := (date_trunc('month', today) - interval '1 month')::date;
  month_end date := (date_trunc('month', today) + interval '1 month' - interval '1 day')::date;
  top int := jsonb_array_length(cfg->'levels');
  cust record;
  st jsonb;
  spent numeric;
  cid text;
  n int := 0;
begin
  if cfg->>'mode' <> 'live' or extract(day from today) <> 1 then return 0; end if;
  for cust in select c.id from public.punpang_customers c where not coalesce((c.data->>'deleted')::boolean, false) loop
    st := public.punpang__member_fold(cust.id, p_now);
    if st->>'status' <> 'active' or (st->>'level')::int <> top then continue; end if;
    select coalesce(sum(e.amount), 0) into spent from public.punpang_member_events e
     where e.customer_id = cust.id and e.kind = 'spend' and e.day >= prev_start and e.day < today
       and not exists (select 1 from public.punpang_member_events u
                        where u.order_id = e.order_id and u.customer_id = e.customer_id and u.kind = 'undo' and u.id > e.id);
    if spent < 150 then continue; end if;
    cid := 'lv4m-' || to_char(today, 'YYYYMM') || '-' || cust.id;
    insert into public.punpang_records (collection, id, data)
      values ('coupons', cid, jsonb_build_object(
        'id', cid, 'customerId', cust.id, 'type', 'discount', 'mode', 'fixed',
        'name', 'คูปองสมาชิก LV4 ส่วนลด 10 บาท', 'amount', 10, 'minSpend', 0, 'pct', 0, 'cap', 0,
        'productId', '', 'productName', '', 'status', 'pending', 'source', 'member_lv4',
        'expiresAt', to_char(month_end, 'YYYY-MM-DD'),
        'createdAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
      on conflict (collection, id) do nothing;
    if found then n := n + 1; end if;
  end loop;
  return n;
end $$;
revoke all on function public.punpang__member_monthly_coupons(timestamptz) from public, anon, authenticated;

-- 00:05 เวลาไทย = 17:05 UTC ของวันก่อนหน้า
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    perform cron.schedule('punpang-member-lv4-coupons', '5 17 * * *', $c$select public.punpang__member_monthly_coupons()$c$);
  end if;
end $$;

-- โหมดทดสอบ: คัดลอกฟังก์ชันและทริกเกอร์ที่แก้แล้วไปยังสำเนา punpang_test
select punpang_test.punpang_test_sync();
