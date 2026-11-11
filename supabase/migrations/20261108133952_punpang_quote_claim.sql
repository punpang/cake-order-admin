-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108133952) · เนื้อตรงกับที่รันจริง

-- จองสิทธิ์สร้างออร์เดอร์จากใบเสนอที่ลูกค้ากดยืนยันทาง Messenger (customer_ok -> converting) ทำได้ครั้งเดียว กันหลายแท็บสร้างออร์เดอร์ซ้ำ
create function public.punpang_quote_claim(p_quote text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if not (public.punpang_has_perm('chat') and public.punpang_has_perm('createOrder')) then return false; end if;
  update public.punpang_quotes set status = 'converting' where id = p_quote and status = 'customer_ok';
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.punpang_quote_claim(text) from public, anon;
grant execute on function public.punpang_quote_claim(text) to authenticated;
