-- ทดสอบการกันแจ้งเตือนซ้ำของสั่งล่วงหน้า (migration 20261127250000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมที่ย้อนกลับ

begin;

select test.ok('N1 จองสิทธิ์ส่งครั้งแรกได้',
  public.punpang_preorder_notify_claim('n_o1', 'placed') = true);
select test.ok('N2 จองซ้ำเหตุการณ์เดิมไม่ได้ (กันส่งซ้ำ)',
  public.punpang_preorder_notify_claim('n_o1', 'placed') = false);
select test.ok('N3 เหตุการณ์ต่างกันของออเดอร์เดียวกันจองได้',
  public.punpang_preorder_notify_claim('n_o1', 'paid') = true);
select test.ok('N4 ออเดอร์อื่นเหตุการณ์เดียวกันไม่ชนกัน',
  public.punpang_preorder_notify_claim('n_o2', 'placed') = true);
select test.ok('N5 ส่งไม่สำเร็จแล้วปลดการจอง จึงจองใหม่ได้',
  public.punpang_preorder_notify_release('n_o2', 'placed') = true
  and public.punpang_preorder_notify_claim('n_o2', 'placed') = true);
select test.ok('N6 ส่งสำเร็จแล้วล็อกไม่ให้จองซ้ำ',
  public.punpang_preorder_notify_mark_sent('n_o1', 'placed', 'line') = true
  and public.punpang_preorder_notify_claim('n_o1', 'placed') = false);
select test.ok('N7 ช่องทางไม่รู้จักถูกปฏิเสธ',
  public.punpang_preorder_notify_mark_sent('n_o2', 'placed', 'email') = false);

rollback;
