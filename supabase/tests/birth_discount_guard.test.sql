-- ทดสอบการกันการดูส่วนลดวันเกิดของลูกค้าคนอื่น (migration 20261127290000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ
-- ฟิกซ์เจอร์เดียวกับ birthday_pos.test.sql (ลูกค้าที่ควรได้ส่วนลด 50 บาท) ใช้ ID ของตัวเอง
-- B1: ผู้ใช้ที่ล็อกอินแต่ไม่ใช่พนักงาน ได้ 0 แม้รหัสลูกค้าเป็นของคนอื่นที่มีสิทธิ์
-- B2: พนักงานที่ใช้งานอยู่ได้ค่าเดิม (50)
-- B3: ผู้เรียกฝั่งเซิร์ฟเวอร์ (ไม่มีผู้ใช้ล็อกอิน) ได้ค่าเดิม (50)

begin;

insert into public.punpang_kv (collection, id, data) values ('config', 'memberLevels',
  jsonb_build_object('v', jsonb_build_object('mode', 'live', 'bonusFrom', '2026-01-01T00:00:00Z', 'cakeCategories', jsonb_build_array('bg-เค้กเต็มใบ'))))
on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_items (id, kind, name, price, active, data) values
  ('bg_cake', 'retail', 'เค้กทดสอบกันส่วนลด', 500, true, '{"category":"bg-เค้กเต็มใบ"}');

insert into auth.users (id, email) values
  ('d8000000-0000-4000-8000-000000000001', 'bg_customer@example.test'),
  ('d8000000-0000-4000-8000-000000000002', 'bg_staff@example.test')
on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values
  ('d8000000-0000-4000-8000-000000000002', 'พนักงานทดสอบกันส่วนลด', 'sales', '{pos,createOrder}')
on conflict do nothing;

insert into public.punpang_customers (id, name, phone, note, data, created_at, updated_at) values
  ('bg_c1', 'ทดสอบ bg', '0899990011', '', '{"ledger":[],"spins":0}'::jsonb, now(), now());
select public.punpang_cust_set_birth('bg_c1', extract(month from (now() at time zone 'Asia/Bangkok'))::int, true);
update public.punpang_customers set data = jsonb_set(data, '{birth,setAt}', to_jsonb(((now() - interval '31 days') at time zone 'utc')::text)) where id = 'bg_c1';
insert into public.punpang_member_events (customer_id, order_id, kind, at, day, amount, renew_min, mult)
  values ('bg_c1', 'bg_ev1', 'spend', now() - interval '40 days', ((now() at time zone 'Asia/Bangkok')::date - 40), 5000, 140, 1);

do $$
declare
  r numeric;
  items jsonb := '[{"retailId":"bg_cake","unitPrice":500,"qty":2}]'::jsonb;
begin
  -- ค่าที่ควรได้จริงสำหรับลูกค้า bg_c1 (ทางเซิร์ฟเวอร์) ต้องไม่เป็น 0 มิฉะนั้นเทสต์ไม่มีความหมาย
  r := public.punpang__birth_discount_expected('bg_c1', items);
  if r is distinct from 50 then
    raise exception 'ฟิกซ์เจอร์ผิด: ผู้เรียกฝั่งเซิร์ฟเวอร์ได้ % (คาด 50)', r;
  end if;

  -- B1: ผู้ใช้ล็อกอินที่ไม่ใช่พนักงาน ต้องได้ 0
  perform set_config('request.jwt.claim.sub', 'd8000000-0000-4000-8000-000000000001', true);
  execute 'set local role authenticated';
  r := public.punpang__birth_discount_expected('bg_c1', items);
  execute 'reset role';
  if r is distinct from 0 then
    raise exception 'B1 ล้มเหลว: ผู้ใช้ที่ไม่ใช่พนักงานเห็นส่วนลดของลูกค้าคนอื่น = %', r;
  end if;

  -- B2: พนักงานที่ใช้งานอยู่ ได้ค่าเดิม
  perform set_config('request.jwt.claim.sub', 'd8000000-0000-4000-8000-000000000002', true);
  execute 'set local role authenticated';
  r := public.punpang__birth_discount_expected('bg_c1', items);
  execute 'reset role';
  if r is distinct from 50 then
    raise exception 'B2 ล้มเหลว: พนักงานได้ % (คาด 50)', r;
  end if;

  -- B3: ผู้เรียกฝั่งเซิร์ฟเวอร์ (ไม่มี uid) ได้ค่าเดิม
  perform set_config('request.jwt.claim.sub', '', true);
  r := public.punpang__birth_discount_expected('bg_c1', items);
  if r is distinct from 50 then
    raise exception 'B3 ล้มเหลว: ผู้เรียกฝั่งเซิร์ฟเวอร์ได้ % (คาด 50)', r;
  end if;
end $$;

select 'birth_discount_guard ผ่านทั้งหมด' as birth_discount_guard_tests;

rollback;
