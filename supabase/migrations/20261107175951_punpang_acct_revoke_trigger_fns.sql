-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107175951) · เนื้อตรงกับที่รันจริง
revoke all on function public.punpang_acct_entries_guard() from public, anon, authenticated;
revoke all on function public.punpang_acct_invoices_guard() from public, anon, authenticated;
revoke all on function public.punpang_acct_state_guard() from public, anon, authenticated;
