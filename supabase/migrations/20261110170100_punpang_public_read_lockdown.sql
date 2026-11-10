-- ขั้นตอนที่ 2 จาก 2: รันหลัง deploy หน้าเว็บที่ใช้ punpang_resolve_short_link แล้วเท่านั้น
-- (ก่อนหน้านี้ผู้ไม่ล็อกอินอ่านลิงก์ย่อทั้งหมดได้ รวมปลายทางและหมายเหตุ → ห้ามเก็บโทเคนลิงก์ออร์เดอร์ไว้ในปลายทางลิงก์ย่อ)
drop policy if exists rec_public_read on public.punpang_records;
create policy rec_public_read on public.punpang_records
  for select to anon, authenticated
  using (collection = 'reviews' and (data->>'status') = 'approved');

-- ค้นหาออร์เดอร์ใช้เฉพาะพนักงานที่ล็อกอิน (security invoker + RLS กันไว้แล้ว ถอนสิทธิ์เรียกของผู้ไม่ล็อกอินเพิ่มอีกชั้น)
revoke execute on function public.punpang_order_search(text) from public, anon;
grant execute on function public.punpang_order_search(text) to authenticated;
