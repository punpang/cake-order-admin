-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107165457) · เนื้อตรงกับที่รันจริง
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
