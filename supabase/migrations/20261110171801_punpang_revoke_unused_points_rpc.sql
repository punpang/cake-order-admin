-- ปิดการเรียก RPC แต้มระดับต่ำจากผู้ใช้ที่ล็อกอิน/anon (แอปไม่ได้เรียกใช้ · ใช้ในฐานข้อมูลผ่านฟังก์ชัน punpang_apply/remove/adjust เท่านั้น)
-- ฟังก์ชันเหล่านี้เป็น security definer: ถ้าปล่อยให้ authenticated เรียกได้ ผู้ที่ล็อกอินเป็นพนักงานจะเรียกเพิ่ม/ตัดแต้มลูกค้าโดยตรงได้
revoke all on function public.punpang_points_earn(text, integer, text, text, text, boolean) from public, anon, authenticated;
revoke all on function public.punpang_points_spend(text, integer, text, text, boolean) from public, anon, authenticated;
revoke all on function public.punpang_points_refund(text, text) from public, anon, authenticated;
revoke all on function public.punpang_points_cut(text, text, integer, text, text) from public, anon, authenticated;
revoke all on function public.punpang_points_balance(text) from public, anon, authenticated;
