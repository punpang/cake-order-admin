-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107172652) · เนื้อตรงกับที่รันจริง

alter policy kv_staff_read on public.punpang_kv using (
  public.punpang_has_perm('manage')
  or (collection in ('item_costs','materials')
      and (public.punpang_has_perm('viewProfit') or public.punpang_has_perm('viewMaterials')))
  or (collection not in ('item_costs','materials','acct') and public.punpang_has_perm('viewAllOrders'))
);
create policy kv_costs_write on public.punpang_kv for all to authenticated
  using (collection = 'item_costs' and public.punpang_has_perm('editItems'))
  with check (collection = 'item_costs' and public.punpang_has_perm('editItems'));
