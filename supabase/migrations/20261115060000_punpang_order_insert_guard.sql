-- รอบแก้ 2026-11-15 (ตอนสร้างออร์เดอร์) · รันหลัง 20261115050000 · รันซ้ำได้ปลอดภัย
-- เดิมการสร้างออร์เดอร์ใหม่ (INSERT) ไม่มีการตรวจ: คะแนนที่ใช้ (pointsUsed) และส่วนลด/ปรับราคา (adjustment) ใส่มาเองได้ ทดสอบแล้ว
-- ตอนนี้ (ผู้จัดการผ่านทุกข้อ):
--   1) คะแนนที่ใช้ต้องเป็นค่าว่างตอนสร้าง (คะแนนที่ใช้ตั้งได้เฉพาะผ่านเซิร์ฟเวอร์ตอนใช้คะแนน)
--   2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
--   3) คูปองที่ใส่มา ต้องผ่านการตรวจเดียวกับฉบับ 20261115050000
-- ตรงกับแอป: การสร้างออร์เดอร์ใหม่ตั้งส่วนลดเป็นศูนย์และคะแนนว่างเสมอ · บิลหน้าร้านให้ส่วนลดเฉพาะผู้ที่มีสิทธิ์ปรับราคา (หน้าจอซ่อนช่องนี้ไว้)
-- ยังไม่ตรวจในรอบนี้: ราคาต่อรายการตอนสร้างออร์เดอร์ (ต้องออกแบบให้ตรวจกับแคตตาล็อกก่อน — ดู docs/security.md)

create or replace function public.punpang_orders_insert_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cp record;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.punpang_has_perm('manage') then return new; end if;

  -- 1) คะแนนที่ใช้ต้องว่างตอนสร้าง
  if new.data->'pointsUsed' is not null and new.data->'pointsUsed' <> 'null'::jsonb then
    raise exception 'points can only be applied through the server' using errcode = '42501';
  end if;

  -- 2) ส่วนลด/ปรับราคาที่ไม่ใช่ศูนย์ต้องมีสิทธิ์ปรับราคา
  if (new.data->'adjustment'->>'amount') is not null
     and (new.data->'adjustment'->>'amount') !~ '^-?0+(\.0+)?$'
     and not public.punpang_has_perm('adjustPrice') then
    raise exception 'no permission to set a discount or adjustment' using errcode = '42501';
  end if;

  -- 3) คูปองที่ใส่มา ต้องผ่านการตรวจ (ฉบับ 20261115050000)
  for cp in
    select v.value as e
      from jsonb_array_elements(case when jsonb_typeof(new.data->'couponsUsed') = 'array' then new.data->'couponsUsed' else '[]'::jsonb end) as v(value)
  loop
    if not public.punpang__coupon_entry_ok(new.id, new.channel, new.customer_id, new.data, cp.e) then
      raise exception 'coupon is not claimed for this order or the discount is too large' using errcode = '42501';
    end if;
  end loop;

  return new;
end $$;
revoke all on function public.punpang_orders_insert_guard() from public, anon, authenticated;
