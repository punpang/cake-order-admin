-- สั่งล่วงหน้า: เลขที่ PRE-ddmmyy-xxxxxx ใช้ตัวนับ punpang_counters เดิม
-- ขยาย CHECK ของตัวนับ และ 2 ฟังก์ชันออกเลข (พนักงาน: แอป prefetch · เซิร์ฟเวอร์: Edge Function) · นิยามคัดลอกจากเดิมทั้งหมด เปลี่ยนเฉพาะรายการ prefix
-- ตัวนับ/เลขใช้เป็นเลขอ้างอิงภายใน/ลูกค้าเท่านั้น ไม่ใช่เลขใบกำกับภาษีหรือรายการบัญชี

-- 1) ลบ CHECK เดิมของ prefix (ชื่ออัตโนมัติ) แล้วเพิ่มใหม่ที่รวม PRE
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where conrelid = 'public.punpang_counters'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like '%prefix%'
  loop
    execute format('alter table public.punpang_counters drop constraint %I', r.conname);
  end loop;
end $$;
alter table public.punpang_counters
  add constraint punpang_counters_prefix_chk check (prefix in ('OR', 'POS', 'QT', 'PAY', 'PRE'));

-- 2) ฝั่งพนักงาน: อนุญาต PRE (นิยามเดิมจาก 20261107174253 เปลี่ยนเฉพาะรายการ prefix)
create or replace function public.punpang_alloc_numbers(p_prefix text, p_day text, p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare start_no int;
begin
  if not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_prefix not in ('OR','POS','QT','PAY','PRE') or p_day !~ '^[0-9]{6}$' or p_n < 1 or p_n > 200 then
    raise exception 'invalid arguments';
  end if;
  insert into public.punpang_counters as c (prefix, day, last) values (p_prefix, p_day, p_n)
  on conflict (prefix, day) do update set last = c.last + p_n
  returning c.last - p_n + 1 into start_no;
  return start_no;
end $$;
revoke all on function public.punpang_alloc_numbers(text, text, int) from public, anon;
grant execute on function public.punpang_alloc_numbers(text, text, int) to authenticated;

-- 3) ฝั่งเซิร์ฟเวอร์: อนุญาต PRE (นิยามเดิมจาก 20261108031014 เปลี่ยนเฉพาะเงื่อนไข prefix)
create or replace function public.punpang_alloc_numbers_server(p_prefix text, p_day text, p_n integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare start_no int;
begin
  if p_prefix not in ('PAY', 'PRE') or p_day !~ '^[0-9]{6}$' or p_n < 1 or p_n > 10 then
    raise exception 'invalid arguments';
  end if;
  insert into public.punpang_counters as c (prefix, day, last) values (p_prefix, p_day, p_n)
  on conflict (prefix, day) do update set last = c.last + p_n
  returning c.last - p_n + 1 into start_no;
  return start_no;
end $$;
revoke all on function public.punpang_alloc_numbers_server(text, text, integer) from public, anon, authenticated;
grant execute on function public.punpang_alloc_numbers_server(text, text, integer) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้ใช้นิยามใหม่
select punpang_test.punpang_test_sync();
