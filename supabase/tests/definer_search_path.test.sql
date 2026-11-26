-- ทดสอบว่าฟังก์ชัน SECURITY DEFINER ทุกตัวที่ authenticated เรียกได้ ตั้ง search_path เป็นค่าว่าง
-- รันโดย supabase/tests/run.sh หลัง security.test.sql (ใช้ test.ok จากไฟล์นั้น)

select test.ok('S1 punpang_chat_bot_claim ตั้ง search_path เป็นค่าว่าง',
  exists (select 1 from pg_proc p where p.oid = 'public.punpang_chat_bot_claim(text,text)'::regprocedure
          and coalesce(p.proconfig, '{}') @> array['search_path=""']));

select test.ok('S2 punpang_register_push_token ตั้ง search_path เป็นค่าว่าง',
  exists (select 1 from pg_proc p where p.oid = 'public.punpang_register_push_token(text)'::regprocedure
          and coalesce(p.proconfig, '{}') @> array['search_path=""']));
