-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107184217) · เนื้อตรงกับที่รันจริง

alter policy kv_staff_read on public.punpang_kv using (
  public.punpang_has_perm('manage')
  or ((collection = any (array['item_costs', 'materials'])) and (public.punpang_has_perm('viewProfit') or public.punpang_has_perm('viewMaterials')))
  or ((collection <> all (array['item_costs', 'materials', 'acct', 'audit'])) and public.punpang_has_perm('viewAllOrders'))
);
