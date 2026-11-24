-- สั่งล่วงหน้า: พนักงานออกเลข PRE ไม่ได้ (เลขนี้ออกโดยเซิร์ฟเวอร์ punpang_alloc_numbers_server เท่านั้น)
-- ตัด PRE ออกจากรายการ prefix ของฝั่งพนักงาน · นิยามคัดลอกจาก 20261127120000 เปลี่ยนเฉพาะรายการ prefix
create or replace function public.punpang_alloc_numbers(p_prefix text, p_day text, p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare start_no int;
begin
  if not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then
    raise exception 'staff only' using errcode = '42501';
  end if;
  if p_prefix not in ('OR','POS','QT','PAY') or p_day !~ '^[0-9]{6}$' or p_n < 1 or p_n > 200 then
    raise exception 'invalid arguments';
  end if;
  insert into public.punpang_counters as c (prefix, day, last) values (p_prefix, p_day, p_n)
  on conflict (prefix, day) do update set last = c.last + p_n
  returning c.last - p_n + 1 into start_no;
  return start_no;
end $$;
revoke all on function public.punpang_alloc_numbers(text, text, int) from public, anon;
grant execute on function public.punpang_alloc_numbers(text, text, int) to authenticated;

-- ซิงก์สำเนาโหมดทดสอบให้ใช้นิยามใหม่
select punpang_test.punpang_test_sync();
