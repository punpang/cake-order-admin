-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107190343) · เนื้อตรงกับที่รันจริง

create policy punpang_work_read_orders on storage.objects for select to authenticated
  using (bucket_id = 'punpang-work' and (public.punpang_has_perm('viewAllOrders') or public.punpang_has_perm('viewPrepOrders') or public.punpang_has_perm('viewDeliveryOrders') or public.punpang_has_perm('createOrder')));
create policy punpang_work_ref_ins on storage.objects for insert to authenticated
  with check (bucket_id = 'punpang-work' and name like '%/ref/%' and (public.punpang_has_perm('createOrder') or public.punpang_has_perm('editItems')));
create policy punpang_work_ref_del on storage.objects for delete to authenticated
  using (bucket_id = 'punpang-work' and name like '%/ref/%' and (public.punpang_has_perm('createOrder') or public.punpang_has_perm('editItems')));
