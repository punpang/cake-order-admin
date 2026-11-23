-- ทดสอบสิทธิประโยชน์สมาชิกอัตโนมัติ (migration 20261123120000)
-- ครอบคลุม: ค่าตั้งต้นตามสเปก · โบนัสต้อนรับ · โบนัสเลื่อนระดับ (ครั้งเดียวตลอดชีพ) · เฉพาะลูกค้าหลัง bonusFrom · เฉพาะโหมดใช้จริง
--           คูปอง LV4 รายเดือน (วันที่ 1 เท่านั้น · ยอดเดือนก่อน ≥150 · Active · ไม่ซ้ำ)
-- ข้อมูลทดสอบใช้รหัสขึ้นต้น mbn_ · ทำในธุรกรรมที่ย้อนกลับ · รันโดย run.sh หลัง member_levels.test.sql

begin;

-- ---------- ตัวช่วย ----------
-- วันทำการ: วันนี้ตามเวลาไทย (ตามจริง) · d = จำนวนวันย้อนหลังจากวันนี้
create function pg_temp.mbn_d(n int) returns date language sql as $$
  select ((now() at time zone 'Asia/Bangkok')::date - n)
$$;
create function pg_temp.mbn_at(d date, t time default '12:00') returns timestamptz language sql immutable
  as $$ select (d + t) at time zone 'Asia/Bangkok' $$;
-- ตั้งค่า: โหมด + เวลาเปิดโบนัส (ค่าเกณฑ์ใช้ค่าตั้งต้นใหม่)
create function pg_temp.mbn_cfg(p_mode text, p_from text) returns void language sql as $$
  insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels',
    jsonb_build_object('v', jsonb_build_object('mode', p_mode, 'bonusFrom', p_from)))
  on conflict (collection, id) do update set data = excluded.data
$$;
create function pg_temp.mbn_cust(p_id text, p_created timestamptz default now()) returns void language sql as $$
  insert into public.punpang_customers (id, name, phone, note, data, created_at, updated_at)
  values (p_id, 'ทดสอบ ' || p_id, '08' || lpad((abs(hashtext(p_id)) % 100000000)::text, 8, '0'), '', '{"ledger":[],"spins":0}'::jsonb, p_created, now())
$$;
create function pg_temp.mbn_ev(p_c text, p_o text, p_day date, p_amt numeric) returns void language sql as $$
  insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values (p_c, p_o, 'spend', pg_temp.mbn_at(p_day), p_day, p_amt, 140, 1)
$$;
create function pg_temp.mbn_lots(p_c text, p_reason text) returns int language sql as $$
  select count(*)::int from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') l
   where c.id = p_c and l->>'reason' = p_reason
$$;
create function pg_temp.mbn_pts(p_c text) returns int language sql as $$
  select coalesce(sum((l->>'delta')::int), 0)::int from public.punpang_customers c, jsonb_array_elements(c.data->'ledger') l where c.id = p_c
$$;
create function pg_temp.mbn_bonus_events(p_c text) returns int language sql as $$
  select count(*)::int from public.punpang_member_events where customer_id = p_c and kind = 'bonus'
$$;

-- ---------- A) ค่าตั้งต้นตามสเปก ----------
delete from public.punpang_kv where collection = 'config' and id = 'memberLevels';
select test.ok('A1 ค่าตั้งต้นเกณฑ์ 0 / 500 / 2500 / 5000 และตัวคูณ 1 / 2 / 3 / 5',
  public.punpang__member_cfg()->'levels' = '[{"name":"LV1","min":0,"mult":1},{"name":"LV2","min":500,"mult":2},{"name":"LV3","min":2500,"mult":3},{"name":"LV4","min":5000,"mult":5}]'::jsonb);
select test.ok('A2 ค่าตั้งต้นยังไม่มีเวลาเปิดโบนัส (ไม่มีโบนัส)', (public.punpang__member_cfg()->>'bonusFrom') is null);
select test.ok('A3 ต่ออายุ 150 บาทรวม VAT 7% = 140 บาทก่อน VAT',
  public.punpang__member_renew_min('{"vat":{"rate":7,"mode":"inclusive"}}'::jsonb, public.punpang__member_cfg()) = 140);

-- ---------- B) โบนัสต้อนรับ ----------
select pg_temp.mbn_cfg('live', '2026-01-01T00:00:00Z');
select pg_temp.mbn_cust('mbn_new');                                  -- สมัครหลังเปิดใช้ (เวลาปัจจุบัน)
select test.ok('B1 สมัครหลังเปิดใช้ได้โบนัสต้อนรับ +100 แต้มครั้งเดียว',
  pg_temp.mbn_lots('mbn_new', 'โบนัสต้อนรับสมาชิก') = 1 and pg_temp.mbn_pts('mbn_new') = 100);
select public.punpang__member_bonus_sync('mbn_new');                -- เรียกซ้ำต้องไม่ให้ซ้ำ
select test.ok('B2 เรียกซ้ำไม่ให้โบนัสต้อนรับซ้ำ', pg_temp.mbn_pts('mbn_new') = 100);
select pg_temp.mbn_cust('mbn_old', '2025-06-01T00:00:00Z');         -- สมัครก่อนเปิดใช้
select public.punpang__member_bonus_sync('mbn_old');
select test.ok('B3 ลูกค้าเดิมก่อน bonusFrom ไม่ได้โบนัสต้อนรับ', pg_temp.mbn_pts('mbn_old') = 0);

-- ---------- C) โบนัสเลื่อนระดับ (ครั้งเดียวตลอดชีพ) ----------
select pg_temp.mbn_cust('mbn_lv');
select pg_temp.mbn_ev('mbn_lv', 'o_lv1', pg_temp.mbn_d(3), 500);     -- ถึง LV2
select test.ok('C1 ถึง LV2 (500) ได้ +50 แต้ม', pg_temp.mbn_lots('mbn_lv', 'โบนัสเลื่อนเป็น LV2') = 1);
select pg_temp.mbn_ev('mbn_lv', 'o_lv2', pg_temp.mbn_d(2), 2000);    -- รวม 2500 ถึง LV3
select test.ok('C2 ถึง LV3 (2500) ได้ +100 แต้ม และ LV2 ไม่ซ้ำ',
  pg_temp.mbn_lots('mbn_lv', 'โบนัสเลื่อนเป็น LV3') = 1 and pg_temp.mbn_lots('mbn_lv', 'โบนัสเลื่อนเป็น LV2') = 1);
select pg_temp.mbn_ev('mbn_lv', 'o_lv3', pg_temp.mbn_d(1), 2500);    -- รวม 5000 ถึง LV4
select test.ok('C3 ถึง LV4 (5000) ได้ +200 แต้ม',
  pg_temp.mbn_lots('mbn_lv', 'โบนัสเลื่อนเป็น LV4') = 1 and pg_temp.mbn_pts('mbn_lv') = 100 + 50 + 100 + 200);
select test.ok('C4 โบนัสระดับบันทึกในประวัติสมาชิก 3 รายการ (ไม่นับเป็นยอดสะสม)', pg_temp.mbn_bonus_events('mbn_lv') = 4);

-- ---------- D) โหมดทดลองไม่ให้โบนัส ----------
select pg_temp.mbn_cfg('shadow', '2026-01-01T00:00:00Z');
select pg_temp.mbn_cust('mbn_sh');
select test.ok('D1 โหมดทดลองไม่ให้โบนัสต้อนรับ', pg_temp.mbn_pts('mbn_sh') = 0);
select pg_temp.mbn_cfg('live', '2026-01-01T00:00:00Z');

-- ---------- E) คูปอง LV4 รายเดือน (ทดสอบด้วยเวลาที่กำหนด) ----------
-- เที่ยงคืนวันที่ 1 ของเดือนถัดไปตามเวลาไทย (ตัวอย่าง: เดือนนี้จบ → วันที่ 1 เดือนหน้า 00:05)
-- เดือนก่อนหน้าของเวลาทดสอบ = เดือนนี้ตามจริง → ยอดซื้อวันแรกของเดือนนี้
create function pg_temp.mbn_first_next() returns timestamptz language sql as $$
  select ((date_trunc('month', now() at time zone 'Asia/Bangkok') + interval '1 month')::date + time '00:05') at time zone 'Asia/Bangkok'
$$;
create function pg_temp.mbn_first_this() returns date language sql as $$
  select date_trunc('month', now() at time zone 'Asia/Bangkok')::date
$$;

select pg_temp.mbn_cust('mbn_e1');
select pg_temp.mbn_ev('mbn_e1', 'oe1', pg_temp.mbn_first_this(), 5000);   -- LV4 Active + ซื้อเดือนก่อนครบ
select test.ok('E1 วันที่ 1 เวลาไทย: มีการออกคูปอง LV4 อย่างน้อย 1 ใบ',
  public.punpang__member_monthly_coupons(pg_temp.mbn_first_next()) >= 1);
-- แยกเป็นคำสั่งถัดไป เพราะคำสั่งเดียวกันไม่เห็นแถวที่เพิ่งเขียน
select test.ok('E1b คูปองของ LV4 ถูกต้อง: ส่วนลดคงที่ 10 บาท แหล่งที่มา member_lv4',
  exists (select 1 from public.punpang_records r where r.collection = 'coupons' and r.data->>'customerId' = 'mbn_e1'
              and (r.data->>'amount')::numeric = 10 and r.data->>'mode' = 'fixed' and r.data->>'source' = 'member_lv4'));
select test.ok('E2 รันซ้ำในเดือนเดียวกันไม่ออกคูปองซ้ำ',
  public.punpang__member_monthly_coupons(pg_temp.mbn_first_next()) = 0);
select test.ok('E3 วันที่ 2 ไม่ออกคูปอง',
  public.punpang__member_monthly_coupons(pg_temp.mbn_first_next() + interval '1 day') = 0);

select pg_temp.mbn_cust('mbn_e2');
select pg_temp.mbn_ev('mbn_e2', 'oe2', pg_temp.mbn_first_this(), 149);    -- LV1 ไม่ถึง LV4
select test.ok('E4 ซื้อเดือนก่อนไม่ถึง 150 หรือไม่ถึง LV4 ไม่ได้คูปอง',
  not exists (select 1 from public.punpang_records r where r.collection = 'coupons' and r.data->>'customerId' = 'mbn_e2'));

-- ---------- F) ตัวคูณและแต้มปกติไม่เปลี่ยนจากโบนัส ----------
select test.ok('F1 โบนัสไม่เข้าการคำนวณระดับ (ระดับของ mbn_lv ยังเป็น 4 จากยอดซื้อจริง)',
  (public.punpang__member_fold('mbn_lv', now())->>'level')::int = 4);

-- ---------- G) สิทธิวันเกิด ----------
-- เดือนเกิดของทดสอบ = เดือนปัจจุบัน (เวลาไทย) · เดือนอื่น = เดือนถัดไป
create function pg_temp.mbn_month_other() returns int language sql as $$
  select (extract(month from (now() at time zone 'Asia/Bangkok'))::int % 12) + 1
$$;
create function pg_temp.mbn_backdate(p_c text, p_days int) returns void language sql as $$
  update public.punpang_customers
     set data = jsonb_set(data, '{birth,setAt}', to_jsonb(((now() - make_interval(days => p_days)) at time zone 'utc')::text))
   where id = p_c
$$;
create function pg_temp.mbn_bday_coupons(p_c text) returns int language sql as $$
  select count(*)::int from public.punpang_records r
   where r.collection = 'coupons' and r.data->>'customerId' = p_c and r.data->>'source' = 'member_birthday'
$$;

select pg_temp.mbn_cfg('live', '2026-01-01T00:00:00Z');
select pg_temp.mbn_cust('mbn_b1');
select test.ok('G1 ไม่ยินยอมหรือเดือนไม่ถูกต้องบันทึกไม่ได้',
  (public.punpang_cust_set_birth('mbn_b1', 5, false)->>'ok')::boolean = false
  and (public.punpang_cust_set_birth('mbn_b1', 13, true)->>'ok')::boolean = false);
select test.ok('G2 บันทึกเดือนเกิดพร้อมยินยอมได้',
  (public.punpang_cust_set_birth('mbn_b1', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true)->>'ok')::boolean = true);
-- เพิ่งกรอก → ยังไม่ใช้สิทธิ (ต้องครบ 30 วัน)
select pg_temp.mbn_ev('mbn_b1', 'ob1a', pg_temp.mbn_d(2), 600);
select test.ok('G3 กรอกไม่ถึง 30 วัน ยังไม่มีสิทธิเดือนเกิด', (public.punpang__member_fold('mbn_b1', now())->>'birthOk')::boolean = false);
select pg_temp.mbn_backdate('mbn_b1', 31);
select test.ok('G4 ครบ 30 วันแล้ว สิทธิเดือนเกิดเปิด (LV2 เป็น x4)',
  (public.punpang__member_fold('mbn_b1', now())->>'birthOk')::boolean = true
  and public.punpang__member_bill_mult(public.punpang__member_fold('mbn_b1', now()), 100, 140, public.punpang__member_cfg()) = 4);
select test.ok('G5 บิลที่ไม่ถึงเดือนเกิดยังได้ตัวคูณระดับปกติ (x2 ที่ LV2)',
  public.punpang__member_bill_mult(public.punpang__member_fold('mbn_b1', now()), 100, 140, public.punpang__member_cfg()) >= 2);
-- แยกคำสั่ง: คำสั่งเดียวกันไม่เห็นการเขียนที่เพิ่งทำ
select test.ok('G6a เปลี่ยนเดือนเกิดสำเร็จ', (public.punpang_cust_set_birth('mbn_b1', pg_temp.mbn_month_other(), true)->>'ok')::boolean = true);
select test.ok('G6b เปลี่ยนเดือนเกิดแล้วเริ่มนับ 30 วันใหม่ (ยังไม่มีสิทธิ)',
  (public.punpang__member_fold('mbn_b1', now())->>'birthOk')::boolean = false);

-- คูปองเดือนเกิด LV4: ซื้อครบ 300 ในเดือนเกิด → 30 บาท (ออกทันทีที่ยอดถึง)
select pg_temp.mbn_cust('mbn_b2');
select public.punpang_cust_set_birth('mbn_b2', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true);
select pg_temp.mbn_backdate('mbn_b2', 31);
select pg_temp.mbn_ev('mbn_b2', 'ob2a', pg_temp.mbn_d(40), 5000);      -- ถึง LV4 ก่อนเดือนเกิด (ไม่นับในเดือนเกิด)
select test.ok('G7 ยอดเดือนเกิดยังไม่ถึง 300 ไม่ได้คูปอง', pg_temp.mbn_bday_coupons('mbn_b2') = 0);
select pg_temp.mbn_ev('mbn_b2', 'ob2b', pg_temp.mbn_d(0), 299);
select test.ok('G8 ยอดเดือนเกิด 299 ยังไม่ได้คูปอง', pg_temp.mbn_bday_coupons('mbn_b2') = 0);
select pg_temp.mbn_ev('mbn_b2', 'ob2c', pg_temp.mbn_d(0), 1);
select test.ok('G9 ยอดเดือนเกิดครบ 300 ได้คูปอง 30 บาท 1 ใบ',
  pg_temp.mbn_bday_coupons('mbn_b2') = 1 and exists (select 1 from public.punpang_records r
    where r.collection = 'coupons' and r.data->>'customerId' = 'mbn_b2' and r.data->>'source' = 'member_birthday'
      and (r.data->>'amount')::numeric = 30 and r.data->>'mode' = 'fixed'));
select test.ok('G10 เรียกซ้ำในปีเดียวกันไม่ออกซ้ำ', public.punpang__member_birth_coupon('mbn_b2', now()) = 0);

-- ยอดเดือนก่อนหน้าไม่นับเป็นยอดเดือนเกิด
select pg_temp.mbn_cust('mbn_b3');
select public.punpang_cust_set_birth('mbn_b3', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true);
select pg_temp.mbn_backdate('mbn_b3', 31);
select pg_temp.mbn_ev('mbn_b3', 'ob3a', pg_temp.mbn_d(40), 5000);
select pg_temp.mbn_ev('mbn_b3', 'ob3b', pg_temp.mbn_d(0), 100);
select test.ok('G11 ยอดซื้อนอกเดือนเกิดไม่นับ และยอดเดือนเกิดไม่ถึง 300 จึงไม่ได้คูปอง', pg_temp.mbn_bday_coupons('mbn_b3') = 0);

-- ---------- H) มุมมองสิทธิวันเกิด · บัตร · ถอนเดือนเกิด ----------
select pg_temp.mbn_cust('mbn_h1');
select public.punpang_cust_set_birth('mbn_h1', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true);
select pg_temp.mbn_backdate('mbn_h1', 31);
select pg_temp.mbn_ev('mbn_h1', 'oh1', pg_temp.mbn_d(40), 5000);                 -- LV4 (ก่อนเดือนเกิด)
select test.ok('H1 LV4 ครบ 30 วัน: มุมมองเดือนเกิดให้ส่วนลดเค้ก 10% เพดาน 50 และตัวคูณเดือนเกิด 10',
  (public.punpang__member_birth_view(public.punpang__member_fold('mbn_h1', now())) ->> 'rate')::int = 10
  and (public.punpang__member_birth_view(public.punpang__member_fold('mbn_h1', now())) ->> 'cap')::int = 50
  and (public.punpang__member_birth_view(public.punpang__member_fold('mbn_h1', now())) ->> 'birthMult')::numeric = 10);
select test.ok('H2 บัตรลูกค้า (โหมดใช้จริง) แสดงตัวคูณรวมเดือนเกิด = 10',
  (public.punpang_member_card('mbn_h1') ->> 'mult')::numeric = 10);
select test.ok('H3 ยังไม่ครบ 30 วัน: ไม่มีส่วนลดเดือนเกิด (rate 0)',
  (public.punpang__member_birth_view(public.punpang__member_fold('mbn_b1', now())) ->> 'rate')::int = 0);
select public.punpang_cust_clear_birth('mbn_h1');
select test.ok('H4 ถอนเดือนเกิดแล้วไม่มีข้อมูลเดือนเกิดในบัญชี',
  not exists (select 1 from public.punpang_customers c where c.id = 'mbn_h1' and c.data ? 'birth'));
select test.ok('H5 ถอนแล้วตัวคูณเดือนเกิดหายไป (ตัวคูณระดับปกติ 5)',
  (public.punpang_member_card('mbn_h1') ->> 'mult')::numeric = 5);

rollback;
select 'ผ่านทั้งหมด' as member_benefits_tests;
