-- แก้ regression ของ security_grants_review_index (2026-11-17): นโยบาย RLS ใน schema punpang_test เรียก punpang_test.punpang_has_perm / punpang_rec_can / punpang_acct_can
-- การเพิกถอน execute ทั้งชุดทำให้โหมดทดสอบของพนักงานอ่านข้อมูลไม่ได้ (permission denied)
-- คืนสิทธิ์ให้ฟังก์ชันใน punpang_test ที่มีชื่อเดียวกับฟังก์ชันใน public ตามสิทธิ์ของฟังก์ชัน public นั้น
-- ไม่คืนให้ trigger punpang_push_on_bell / punpang_push_on_chat และฟังก์ชันทดสอบที่ไม่มีคู่ใน public (เช่น punpang_test_seed)

do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as test_fn, pp.oid::regprocedure as pub_fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'punpang_test'
    join pg_proc pp on pp.proname = p.proname
    join pg_namespace pn on pn.oid = pp.pronamespace and pn.nspname = 'public'
    where p.proname not in ('punpang_push_on_bell', 'punpang_push_on_chat')
  loop
    if has_function_privilege('authenticated', r.pub_fn, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', r.test_fn);
    end if;
    if has_function_privilege('anon', r.pub_fn, 'EXECUTE') then
      execute format('grant execute on function %s to anon', r.test_fn);
    end if;
  end loop;
end $$;
