-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108031014) · เนื้อตรงกับที่รันจริง

create or replace function public.punpang_alloc_numbers_server(p_prefix text, p_day text, p_n integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare start_no int;
begin
  if p_prefix <> 'PAY' or p_day !~ '^[0-9]{6}$' or p_n < 1 or p_n > 10 then
    raise exception 'invalid arguments';
  end if;
  insert into public.punpang_counters as c (prefix, day, last) values (p_prefix, p_day, p_n)
  on conflict (prefix, day) do update set last = c.last + p_n
  returning c.last - p_n + 1 into start_no;
  return start_no;
end $$;
revoke all on function public.punpang_alloc_numbers_server(text, text, integer) from public, anon, authenticated;
grant execute on function public.punpang_alloc_numbers_server(text, text, integer) to service_role;
