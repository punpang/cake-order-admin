-- รอบตรวจความปลอดภัย (ข้อ 1, 5, 7): ลดสิทธิ์ที่แอปไม่ได้ใช้ และกันรีวิวซ้ำต่อออร์เดอร์
-- ไม่แตะฟังก์ชันที่แอปเรียกผ่าน RPC/pointsHook, ฟังก์ชันที่ RLS ใช้ (punpang_has_perm, punpang_acct_can, punpang_rec_can),
-- และฟังก์ชันที่ trigger แบบ SECURITY INVOKER เรียก (punpang__coupon_entry_ok, punpang__quote_check, punpang_apply_points, punpang_set_status)

-- 1) ฟังก์ชัน trigger ไม่ควรถูกเรียกผ่าน RPC (trigger ยังทำงานตามปกติ)
revoke execute on function public.punpang_push_on_bell() from public, anon, authenticated;
revoke execute on function public.punpang_push_on_chat() from public, anon, authenticated;

-- 2) ชุดทดสอบใน schema punpang_test: แอปไม่เรียกตรง (public.punpang_reset_test_data ยังเรียกได้ตามเดิม และทำงานเป็นเจ้าของฟังก์ชัน)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'punpang_test'
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- 3) รีวิวหนึ่งรายการต่อหนึ่งออร์เดอร์ (ตอนเพิ่มดัชนีไม่มีรีวิวซ้ำในระบบ)
create unique index if not exists punpang_records_review_order_uidx
  on public.punpang_records ((data->>'orderId'))
  where collection = 'reviews';
