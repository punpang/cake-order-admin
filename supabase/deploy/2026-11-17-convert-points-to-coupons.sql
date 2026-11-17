-- แปลงคะแนนคงเหลือของลูกค้าทุกคนเป็นคูปองใบเดียวต่อคน (มูลค่าเท่ายอดคะแนน · ใช้ครั้งเดียว · หมดอายุ 30 วันนับจากวันแปลง)
-- ยังไม่ได้รันบน production · รันเฉพาะเมื่อได้รับอนุมัติเท่านั้น · รันได้ครั้งเดียว (กันรันซ้ำด้วยเครื่องหมายใน punpang_kv)
-- ก่อนรัน:
--   (1) รัน supabase/migrations/20261117200000_punpang_credit_coupons.sql ให้เสร็จก่อน (มีฟังก์ชัน punpang__convert_points)
--   (2) สำรองฐานข้อมูล
--   (3) ตรวจยอดก่อนแปลง (รันแยก): ดูหมายเหตุ "ตรวจก่อน" ท้ายไฟล์
-- ทั้งไฟล์อยู่ในธุรกรรมเดียว: ขั้นใดผิดพลาด ทุกอย่างย้อนกลับ ไม่มีผลค้างครึ่งทาง

begin;

do $$
begin
  if exists (select 1 from public.punpang_kv where collection = 'migration' and id = 'points_to_coupons_20261117') then
    raise exception 'เคยแปลงคะแนนเป็นคูปองแล้ว ห้ามรันซ้ำ';
  end if;
end
$$;

do $$
declare
  rec record;
  res jsonb;
  n int := 0;
  total numeric := 0;
begin
  for rec in
    select id from public.punpang_customers
     where coalesce((data->>'deleted')::boolean, false) = false
     order by id
  loop
    res := public.punpang__convert_points(rec.id);
    if (res->>'ok') = 'true' then
      n := n + 1;
      total := total + (res->>'amount')::numeric;
    elsif (res->>'error') = 'no_points' then
      null; -- ไม่มีคะแนนที่ใช้ได้ ข้าม
    else
      raise exception 'แปลงลูกค้า % ไม่สำเร็จ: %', rec.id, res;
    end if;
  end loop;

  raise notice 'แปลงคะแนนเป็นคูปองแล้ว % คน รวม % บาท', n, total;

  insert into public.punpang_kv (collection, id, data)
  values ('migration', 'points_to_coupons_20261117',
          jsonb_build_object('v', jsonb_build_object('customers', n, 'amount', total, 'at', now())));
end
$$;

commit;

-- ตรวจก่อน (รันแยกก่อนเริ่มธุรกรรม · แสดงจำนวนลูกค้าและยอดคะแนนที่จะถูกแปลง):
-- with lots as (
--   select c.id, (e->>'remaining')::int as rem
--     from public.punpang_customers c, jsonb_array_elements(coalesce(c.data->'ledger', '[]'::jsonb)) e
--    where coalesce((c.data->>'deleted')::boolean, false) = false
--      and (e->>'delta')::int > 0 and coalesce((e->>'remaining')::int, 0) > 0
--      and (e->>'expiresAt' is null or e->>'expiresAt' >= to_char((now() at time zone 'Asia/Bangkok')::date, 'YYYY-MM-DD'))
-- )
-- select count(distinct id) as customers, sum(rem) as points from lots;
