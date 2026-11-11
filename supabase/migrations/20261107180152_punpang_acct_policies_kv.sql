-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107180152) · เนื้อตรงกับที่รันจริง

create policy kv_acct_read on public.punpang_kv for select to authenticated
  using (collection = 'acct' and public.punpang_acct_can(array['acctView','acctRecord','acctClose','acctReports','acctTax','acctAssets','acctSettings','taxInvoice']));
create policy kv_acct_write on public.punpang_kv for all to authenticated
  using (collection = 'acct' and public.punpang_acct_can(array['acctRecord','acctClose','acctTax','acctAssets','acctSettings']))
  with check (collection = 'acct' and public.punpang_acct_can(array['acctRecord','acctClose','acctTax','acctAssets','acctSettings']));
alter policy acct_inv_ins on public.punpang_acct_invoices
  with check (public.punpang_acct_can(array['taxInvoice']) or (kind = 'credit' and public.punpang_acct_can(array['cancel'])));
alter policy acct_inv_upd on public.punpang_acct_invoices
  using (public.punpang_acct_can(array['taxInvoice','cancel'])) with check (public.punpang_acct_can(array['taxInvoice','cancel']));
alter policy acct_state_read on public.punpang_acct_state
  using (public.punpang_acct_can(array['acctView','acctRecord','acctClose','acctReports','acctTax','acctAssets','acctSettings','taxInvoice','manage','viewAllOrders']));
