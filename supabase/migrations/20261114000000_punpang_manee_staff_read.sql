-- ให้พนักงานที่มีสิทธิ์ pos อ่านรายการรับเงินแม่มณี (ใช้ในหน้าทดสอบ /admin/manee-test)
-- เขียนไม่ได้จาก client · การเขียนยังทำโดย Edge Function manee-receiver (service role) เท่านั้น
create policy manee_transfers_pos_read on public.manee_transfers
  for select to authenticated
  using (public.punpang_has_perm('pos'));
