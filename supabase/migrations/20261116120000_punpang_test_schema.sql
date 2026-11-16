-- โหมดทดสอบ (ฐานข้อมูลเดียวกัน · แยกข้อมูลที่ schema punpang_test)
-- ตารางธุรกิจ (ISO): มีสำเนาเป็นตารางของตัวเองใน punpang_test · ข้อมูลทดสอบอยู่ที่นั่นทั้งหมด
-- ตารางข้อมูลร่วม (SH): ตั้งค่า ราคา สินค้า พนักงาน ช่องทางเชื่อมต่อ · ใน punpang_test เป็น view อ่านอย่างเดียว (เขียนไม่ได้ในโหมดทดสอบ)
-- ฟังก์ชันทุกตัวของ public คัดลอกไป punpang_test โดยเปลี่ยนการอ้างอิงทุกตาราง/ฟังก์ชันให้ชี้ไป punpang_test
--   ฟังก์ชันในโหมดทดสอบจึงไม่มีทางอ่านหรือเขียน public ได้ (ตรวจด้วย mirror.test.sql)
-- punpang_test_sync() รันซ้ำได้เมื่อโครงสร้าง public เปลี่ยน · ตารางที่ยังไม่ได้จัดประเภทจะทำให้ sync ล้มเพื่อให้จัดประเภทก่อน

create schema if not exists punpang_test;
revoke all on schema punpang_test from public, anon;
grant usage on schema punpang_test to authenticated, service_role;

-- ทริกเกอร์ของ view ตารางข้อมูลร่วม: ทุกการเขียนถูกปฏิเสธ
create or replace function punpang_test.punpang_test_readonly() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'โหมดทดสอบ: ข้อมูลนี้อ่านได้อย่างเดียว (แก้ไขได้ที่ข้อมูลจริงเท่านั้น)' using errcode = '42501';
end $$;

create or replace function punpang_test.punpang_test_sync() returns void
language plpgsql security definer set search_path = '' set check_function_bodies = off as $sync$
declare
  iso text[] := array[
    'punpang_records', 'punpang_customers', 'punpang_orders', 'punpang_chats', 'punpang_chat_presence',
    'punpang_chat_topics', 'punpang_order_topics', 'punpang_order_audits', 'punpang_order_changes',
    'punpang_order_issued', 'punpang_order_reviews', 'punpang_quotes', 'punpang_shifts',
    'punpang_payments', 'punpang_counters', 'punpang_acct_entries', 'punpang_acct_invoices',
    'punpang_acct_counters', 'punpang_acct_state', 'punpang_acct_frozen', 'punpang_sms_log', 'punpang_tg_log',
    'punpang_cake_clicks'];
  shr text[] := array[
    'punpang_staff', 'punpang_kv', 'punpang_items', 'punpang_catalog_history', 'punpang_fb_pages',
    'punpang_fb_oauth', 'punpang_customer_auth', 'punpang_customer_sessions', 'punpang_otps',
    'punpang_customer_push_devices', 'punpang_push_devices', 'tungngern_app_names', 'tungngern_inbox',
    'tungngern_transfers'];
  names text[];
  pat text;
  body text;
  sig text;
  has_rows boolean;
  t text; c record; x record; f record;
begin
  -- 0) ตารางทุกตารางของ public ต้องจัดประเภทแล้ว
  for c in select r.relname::text as name from pg_class r join pg_namespace n on n.oid = r.relnamespace
            where n.nspname = 'public' and r.relkind in ('r', 'p') loop
    if not (c.name = any (iso || shr)) then
      raise exception 'ตาราง % ยังไม่ได้จัดประเภทสำหรับโหมดทดสอบ (แก้ punpang_test_sync)', c.name;
    end if;
  end loop;

  -- รูปแบบค้นหาการอ้างอิง public.<ตาราง|ฟังก์ชัน> ทั้งหมด (แทนที่เป็น punpang_test.<ชื่อเดิม>)
  select array_agg(distinct s.nm) into names from (
    select r.relname::text as nm from pg_class r join pg_namespace n on n.oid = r.relnamespace
     where n.nspname = 'public' and r.relkind in ('r', 'p', 'v')
    union all
    select p.proname::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
  ) s;
  pat := '\mpublic\.(' || array_to_string(names, '|') || ')\M';

  -- 1) ล้างทริกเกอร์ นโยบาย CHECK และค่าเริ่มต้นของสำเนาตารางธุรกิจ
  --    ต้องล้างก่อนลบฟังก์ชัน เพราะ PostgreSQL ไม่ยอมลบฟังก์ชันที่ยังถูกอ้างอิง
  foreach t in array iso loop
    if to_regclass('punpang_test.' || t) is not null then
      for x in select tg.tgname::text as name from pg_trigger tg
                where tg.tgrelid = to_regclass('punpang_test.' || t) and not tg.tgisinternal loop
        execute format('drop trigger if exists %I on punpang_test.%I', x.name, t);
      end loop;
      for x in select p.policyname::text as name from pg_policies p where p.schemaname = 'punpang_test' and p.tablename = t loop
        execute format('drop policy if exists %I on punpang_test.%I', x.name, t);
      end loop;
      for x in select k.conname::text as name from pg_constraint k
                where k.conrelid = to_regclass('punpang_test.' || t) and k.contype = 'c' loop
        execute format('alter table punpang_test.%I drop constraint if exists %I', t, x.name);
      end loop;
      for c in select a.attname::text as name from pg_attribute a
                where a.attrelid = to_regclass('punpang_test.' || t) and a.attnum > 0 and not a.attisdropped
                  and a.attidentity = '' and a.attgenerated = '' loop
        execute format('alter table punpang_test.%I alter column %I drop default', t, c.name);
      end loop;
    end if;
  end loop;

  -- 2) ตารางธุรกิจ: สร้างสำเนา (ถ้ายังไม่มี) · เพิ่มคอลัมน์และดัชนีที่ขาด · เปิด RLS ตามต้นฉบับ
  foreach t in array iso loop
    if to_regclass('punpang_test.' || t) is null then
      execute format('create table punpang_test.%I (like public.%I including all)', t, t);
    end if;
    for c in select a.attname::text as name, format_type(a.atttypid, a.atttypmod) as typ, a.attnotnull
               from pg_attribute a
              where a.attrelid = to_regclass('public.' || t) and a.attnum > 0 and not a.attisdropped loop
      if not exists (select 1 from pg_attribute where attrelid = to_regclass('punpang_test.' || t)
                      and attname = c.name and not attisdropped) then
        execute format('alter table punpang_test.%I add column %I %s', t, c.name, c.typ);
        execute format('select exists (select 1 from punpang_test.%I)', t) into has_rows;
        if c.attnotnull and not has_rows then
          execute format('alter table punpang_test.%I alter column %I set not null', t, c.name);
        end if;
      end if;
    end loop;
    for x in select i.indexname::text as name, i.indexdef as def from pg_indexes i
              where i.schemaname = 'public' and i.tablename = t loop
      if not exists (select 1 from pg_indexes where schemaname = 'punpang_test' and indexname = x.name) then
        execute replace(x.def, ' ON public.' || t || ' ', ' ON punpang_test.' || t || ' ');
      end if;
    end loop;
    if (select relrowsecurity from pg_class where oid = to_regclass('public.' || t)) then
      execute format('alter table punpang_test.%I enable row level security', t);
    end if;
  end loop;

  -- 3) ตารางข้อมูลร่วม: view อ่านอย่างเดียว (security_invoker = ใช้สิทธิ์ RLS ของผู้เรียก) + ทริกเกอร์ปฏิเสธการเขียน
  foreach t in array shr loop
    execute format('drop view if exists punpang_test.%I', t);
    execute format('create view punpang_test.%I with (security_invoker = true) as select * from public.%I', t, t);
    execute format('create trigger punpang_test_readonly instead of insert or update or delete on punpang_test.%I '
                   'for each row execute function punpang_test.punpang_test_readonly()', t);
    execute format('revoke all on punpang_test.%I from public, anon', t);
    execute format('grant select on punpang_test.%I to authenticated, service_role', t);
  end loop;

  -- 4) ฟังก์ชันทุกตัวของ public → สำเนาใน punpang_test (ล้างของเดิมก่อน เพื่อให้เปลี่ยนชนิดผลลัพธ์ได้)
  -- ยกเว้นตัวช่วยที่ไม่ได้มาจาก public: ฟังก์ชันของชุดตัวอย่าง (migration 20261116140000)
  for f in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'punpang_test' and p.proname not in ('punpang_test_sync', 'punpang_test_readonly', 'punpang_test_shift', 'punpang_test_seed') loop
    execute format('drop function if exists %s', f.sig);
  end loop;
  for f in select p.proname::text as name, pg_get_functiondef(p.oid) as def
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace
           where n.nspname = 'public' and p.prokind in ('f', 'p')
             and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') loop
    body := regexp_replace(f.def, pat, 'punpang_test.\1', 'g');
    if body ~ '\mpublic\.' then
      -- ฟังก์ชันที่ยังอ้างตารางที่ไม่มีแล้ว (เช่น punpang_points ที่ถูกลบ) ไม่คัดลอก: เรียกไม่ได้ในโหมดทดสอบ จึงไม่มีทางแตะ public
      raise notice 'ไม่คัดลอกฟังก์ชัน % เข้า punpang_test (ยังอ้างอิง public ที่ไม่มีแล้ว)', f.name;
      continue;
    end if;
    execute body;
  end loop;

  -- 5) ค่าเริ่มต้น CHECK และทริกเกอร์ของตารางธุรกิจ (อ้างอิงไป punpang_test)
  foreach t in array iso loop
    for c in select a.attname::text as name, pg_get_expr(d.adbin, d.adrelid) as def
               from pg_attribute a join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
              where a.attrelid = to_regclass('public.' || t) and not a.attisdropped
                and a.attidentity = '' and a.attgenerated = '' loop
      execute format('alter table punpang_test.%I alter column %I set default %s', t, c.name,
                     regexp_replace(c.def, pat, 'punpang_test.\1', 'g'));
    end loop;
    for x in select k.conname::text as name, regexp_replace(pg_get_constraintdef(k.oid), pat, 'punpang_test.\1', 'g') as def
              from pg_constraint k where k.conrelid = to_regclass('public.' || t) and k.contype = 'c' loop
      execute format('alter table punpang_test.%I drop constraint if exists %I', t, x.name);
      execute format('alter table punpang_test.%I add constraint %I %s', t, x.name, x.def);
    end loop;
    for x in select tg.tgname::text as name, pg_get_triggerdef(tg.oid) as def from pg_trigger tg
              where tg.tgrelid = to_regclass('public.' || t) and not tg.tgisinternal loop
      execute format('drop trigger if exists %I on punpang_test.%I', x.name, t);
      execute regexp_replace(x.def, pat, 'punpang_test.\1', 'g');
    end loop;
  end loop;

  -- 6) นโยบาย RLS ของตารางธุรกิจ (จากต้นฉบับ อ้างอิงไป punpang_test)
  foreach t in array iso loop
    for x in select p.policyname::text as name, p.permissive, p.cmd, p.roles, p.qual, p.with_check
              from pg_policies p where p.schemaname = 'public' and p.tablename = t loop
      execute format('create policy %I on punpang_test.%I as %s for %s to %s%s%s', x.name, t, x.permissive, x.cmd,
        array_to_string(x.roles, ', '),
        case when x.qual is not null then ' using (' || regexp_replace(x.qual, pat, 'punpang_test.\1', 'g') || ')' else '' end,
        case when x.with_check is not null then ' with check (' || regexp_replace(x.with_check, pat, 'punpang_test.\1', 'g') || ')' else '' end);
    end loop;
  end loop;

  -- 7) สิทธิ์ตารางและฟังก์ชัน: เท่าต้นฉบับ แต่ anon ไม่มีสิทธิ์ในโหมดทดสอบ
  foreach t in array iso loop
    execute format('revoke all on punpang_test.%I from public, anon', t);
    for x in select g.grantee::text as grantee, g.privilege_type::text as priv from information_schema.role_table_grants g
              where g.table_schema = 'public' and g.table_name = t and g.grantee in ('authenticated', 'service_role') loop
      execute format('grant %s on punpang_test.%I to %I', x.priv, t, x.grantee);
    end loop;
  end loop;
  for f in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.prokind in ('f', 'p') loop
    sig := replace(f.oid::regprocedure::text, 'public.', 'punpang_test.');
    if to_regprocedure(sig) is null then continue; end if; -- ฟังก์ชันที่ไม่ได้คัดลอก (ดูข้อความ NOTICE ด้านบน)
    execute format('revoke all on function %s from public, anon', sig);
    if has_function_privilege('authenticated', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to authenticated', sig);
    end if;
    if has_function_privilege('service_role', f.oid, 'EXECUTE') then
      execute format('grant execute on function %s to service_role', sig);
    end if;
  end loop;
end $sync$;

revoke all on function punpang_test.punpang_test_sync() from public, anon, authenticated;
grant execute on function punpang_test.punpang_test_sync() to service_role;

-- สร้างสำเนาครั้งแรกทันที (ตารางทดสอบเริ่มว่าง)
select punpang_test.punpang_test_sync();
