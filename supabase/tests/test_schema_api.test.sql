-- ทดสอบว่า schema punpang_test ไม่เปิดให้ API (anon / authenticated) และ public ยังใช้งานได้
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok, test.as_anon, test.rpc_as จากไฟล์นั้น)

-- TS1: บทบาท anon ไม่มีสิทธิ์ USAGE บน schema punpang_test
select test.ok('TS1: anon ไม่มีสิทธิ์เข้า schema punpang_test',
  has_schema_privilege('anon', 'punpang_test', 'USAGE') = false);

-- TS2: บทบาท authenticated ไม่มีสิทธิ์ USAGE บน schema punpang_test
select test.ok('TS2: authenticated ไม่มีสิทธิ์เข้า schema punpang_test',
  has_schema_privilege('authenticated', 'punpang_test', 'USAGE') = false);

-- TS3: ผู้ไม่ล็อกอินเรียกฟังก์ชันใน punpang_test ไม่ได้
select test.ok('TS3: anon เรียก punpang_test.punpang_has_perm ไม่ได้',
  test.as_anon($q$ select punpang_test.punpang_has_perm('manage') $q$) like 'ERR:42501:%');

-- TS4: พนักงานที่ล็อกอินเรียก punpang_test ไม่ได้ (ไม่มี USAGE)
select test.ok('TS4: พนักงานที่ล็อกอินเรียก punpang_test.punpang_has_perm ไม่ได้',
  test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(punpang_test.punpang_has_perm('manage')) $q$)->>'exception' = '42501');

-- TS5: public ยังเรียกได้ตามเดิมสำหรับพนักงานที่ล็อกอิน (ไม่มี exception)
select test.ok('TS5: พนักงานที่ล็อกอินยังเรียก public.punpang_has_perm ได้',
  (test.rpc_as('11111111-1111-1111-1111-111111111111', $q$ select to_jsonb(public.punpang_has_perm('manage')) $q$) ? 'exception') = false);
