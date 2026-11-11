-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107184202) · เนื้อตรงกับที่รันจริง

create policy kv_audit_read on public.punpang_kv for select to authenticated
  using (collection = 'audit' and public.punpang_has_perm('manageUsers'));
create policy kv_audit_write on public.punpang_kv for all to authenticated
  using (collection = 'audit' and public.punpang_has_perm('manageUsers'))
  with check (collection = 'audit' and public.punpang_has_perm('manageUsers'));
