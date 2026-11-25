-- ขอเลขเอกสารได้เฉพาะพนักงานที่มี createOrder, pos, manage, reportPayment หรือ confirmPayment
-- เพิ่ม reportPayment และ confirmPayment เพราะสองสิทธิ์นี้ออกเลข PAY (แจ้งยอด รับเงินทันที สลิปจากแชท) · ไม่เพิ่ม sendToPayment (ไม่ออกเลข)
-- นิยามคัดลอกจาก 20261127310000 เปลี่ยนเฉพาะเงื่อนไขสิทธิ์
create or replace function public.punpang_alloc_numbers(p_prefix text, p_day text, p_n int)
returns int language plpgsql security definer set search_path = '' as $$
declare start_no int;
begin
  if not (public.punpang_has_perm('createOrder') or public.punpang_has_perm('pos') or public.punpang_has_perm('manage')
          or public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
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

select punpang_test.punpang_test_sync();
