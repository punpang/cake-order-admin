-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107174253) · เนื้อตรงกับที่รันจริง

create table public.punpang_counters (
  prefix text not null check (prefix in ('OR','POS','QT','PAY')),
  day text not null check (day ~ '^[0-9]{6}$'),
  last int not null default 0 check (last >= 0),
  primary key (prefix, day)
);
alter table public.punpang_counters enable row level security;
revoke all on public.punpang_counters from anon, authenticated;

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

-- แปลงเลขออร์เดอร์เดิมเป็นรูปแบบใหม่ OR-ddmmyy-xxxxxx / POS-ddmmyy-xxxxx (วันตามเวลาไทยของวันสร้าง) แล้วตั้งตัวนับต่อจากนั้น
with src as (
  select id,
         case when channel = 'pos' then 'POS' else 'OR' end as pfx,
         to_char((coalesce((data->>'createdAt')::timestamptz, created_at)) at time zone 'Asia/Bangkok', 'DDMMYY') as dd,
         row_number() over (
           partition by (channel = 'pos'), to_char((coalesce((data->>'createdAt')::timestamptz, created_at)) at time zone 'Asia/Bangkok', 'DDMMYY')
           order by coalesce((data->>'createdAt')::timestamptz, created_at), id) as rn
  from public.punpang_orders
  where code ~ '^(OR|POS)-[0-9]+$'
), upd as (
  update public.punpang_orders o
     set code = s.pfx || '-' || s.dd || '-' || lpad(s.rn::text, case when s.pfx = 'POS' then 5 else 6 end, '0')
    from src s where s.id = o.id
  returning s.pfx, s.dd, s.rn
)
insert into public.punpang_counters (prefix, day, last)
select pfx, dd, max(rn) from upd group by pfx, dd
on conflict (prefix, day) do update set last = greatest(public.punpang_counters.last, excluded.last);
