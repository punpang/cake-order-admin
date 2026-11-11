-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107185500) · เนื้อตรงกับที่รันจริง

alter policy punpang_slips_rw on storage.objects
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('viewAllOrders')))
  with check (bucket_id = 'punpang-slips' and (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')));
