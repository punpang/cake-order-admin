-- ทดสอบ RPC ออกใบกำกับภาษีของสั่งล่วงหน้า (migration 20261126370000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมแล้ว rollback
-- ตัวช่วย: เรียกแล้วคืน 'OK' หรือ 'ERR:<sqlstate>' (ไม่ให้ธุรกรรมล้ม)
create function pg_temp.try_issue(o text, id text) returns text language plpgsql as $$
begin
  perform public.punpang_preorder_issue_invoice(o, '2099-12-24', id, '{"type":"invoice","total":500}'::jsonb);
  return 'OK';
exception when others then
  return 'ERR:' || sqlstate;
end $$;

-- I1
select test.ok('I1 ส่งมอบแล้วบันทึกใบได้ และได้เลขที่ INV-',
  (select public.punpang_preorder_issue_invoice('ii_o1', '2099-12-24', 'ii_inv1', '{"type":"invoice","total":500}'::jsonb) ->> 'no') like 'INV-%');

-- I2 (ออกไปแล้วในข้อ I1 จึงออกซ้ำไม่ได้)
select test.ok('I2 ออกซ้ำไม่ได้ (ยังมีใบที่ไม่ถูกยกเลิก)',
  pg_temp.try_issue('ii_o1', 'ii_inv2') = 'ERR:P0001');

-- I3 (ใบเดิมถูกยกเลิกแล้ว จึงออกได้)
select test.ok('I3 ใบที่ถูกยกเลิกแล้วไม่นับ → ออกใบใหม่ได้',
  (select public.punpang_preorder_issue_invoice('ii_o3', '2099-12-24', 'ii_inv3', '{"type":"invoice","total":500}'::jsonb) ->> 'no') like 'INV-%');

-- I4
select test.ok('I4 ยังไม่ส่งมอบ → ปฏิเสธ (P0001)',
  pg_temp.try_issue('ii_o2', 'ii_inv4') = 'ERR:P0001');

-- I5
select test.ok('I5 ไม่พบออร์เดอร์ → ปฏิเสธ (P0001)',
  pg_temp.try_issue('ii_none', 'ii_inv5') = 'ERR:P0001');

-- I6
select test.ok('I6 บทบาทแอปเรียกไม่ได้ (42501)',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000e1',
    $$select public.punpang_preorder_issue_invoice('ii_o1', '2099-12-24', 'ii_inv6', '{"type":"invoice"}'::jsonb)$$), 10) = 'ERR:42501:');

rollback;
