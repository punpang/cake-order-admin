-- ทดสอบว่า authenticated เรียกฟังก์ชันที่ไม่ใช้แล้วไม่ได้ และฟังก์ชันที่ยังต้องใช้ยังเรียกได้
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น)

select test.ok('R1 punpang_set_status ยังให้ authenticated เรียกได้ (ชุดทดสอบสถานะใช้อยู่)',
  has_function_privilege('authenticated', 'public.punpang_set_status(text,text)', 'EXECUTE'));

select test.ok('R2 punpang_reset_test_data ปิดสิทธิ์ authenticated',
  not has_function_privilege('authenticated', 'public.punpang_reset_test_data()', 'EXECUTE'));

select test.ok('R3 punpang_has_perm ยังให้ authenticated เรียกได้ (ฟังก์ชันพื้นฐานของสิทธิ์)',
  has_function_privilege('authenticated', 'public.punpang_has_perm(text)', 'EXECUTE'));

select test.ok('R4 punpang_acct_can ยังให้ authenticated เรียกได้ (ใช้ใน RLS)',
  has_function_privilege('authenticated', 'public.punpang_acct_can(text[])', 'EXECUTE'));
