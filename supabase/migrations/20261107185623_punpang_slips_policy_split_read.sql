-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107185623) · เนื้อตรงกับที่รันจริง

alter policy punpang_slips_rw on storage.objects
  using (bucket_id = 'punpang-slips' and (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')));
create policy punpang_slips_read_all on storage.objects for select to authenticated
  using (bucket_id = 'punpang-slips' and public.punpang_has_perm('viewAllOrders'));
