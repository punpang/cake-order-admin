-- ทดสอบยอดยกมาของบัญชี (punpang_acct_opening) และกันใบกำกับภาษีซ้ำต่อออร์เดอร์
-- รันโดย supabase/tests/run.sh หลัง migration ทั้งหมด (ใช้ test.ok / test.rpc_as จาก security.test.sql) · ข้อมูลทดสอบขึ้นต้น ao_ · ธุรกรรมย้อนกลับ
begin;

insert into auth.users (id, email) values ('a0a0a0a0-0000-0000-0000-0000000000a0', 'acct-opening@example.test') on conflict do nothing;
insert into public.punpang_staff (user_id, name, role, perms) values ('a0a0a0a0-0000-0000-0000-0000000000a0', 'AcctViewer', 'admin', '{acctView}') on conflict (user_id) do nothing;

insert into public.punpang_acct_entries (id, entry_date, no, data) values
  ('ao_e1', '2024-03-01', 'AO-1', '{"lines":[{"account":"1010","dr":100.25},{"account":"4100","cr":100.25}]}'),
  ('ao_e2', '2025-06-01', 'AO-2', '{"lines":[{"account":"1010","dr":50},{"account":"4100","cr":50}]}');
insert into public.punpang_acct_frozen (id, entry_date, data) values
  ('ao_f1', '2024-12-31', '{"lines":[{"account":"5100","dr":40},{"account":"1010","cr":40}]}'),
  ('ao_f2', '2025-01-02', '{"lines":[{"account":"5100","dr":7},{"account":"1010","cr":7}]}');

select test.rpc_as('a0a0a0a0-0000-0000-0000-0000000000a0', $q$ select public.punpang_acct_opening('2024-12-31') $q$) as op \gset
select test.ok('ยอดยกมาถึง 2024-12-31 รวมรายการที่บันทึกเอง + แช่แข็ง เฉพาะที่ลงวันที่ถึงวันนั้น',
  (select jsonb_agg(x order by x->>'account') from jsonb_array_elements(:'op'::jsonb) x where x->>'account' in ('1010', '4100', '5100'))
  = '[{"account":"1010","dr":100.25,"cr":40},{"account":"4100","dr":0,"cr":100.25},{"account":"5100","dr":40,"cr":0}]'::jsonb);

select test.ok('ผู้ไม่มีสิทธิ์ดูบัญชี ได้ยอดยกมาว่าง (RLS ตามผู้เรียก)',
  test.rpc_as('22222222-2222-2222-2222-222222222222', $q$ select public.punpang_acct_opening('2030-01-01') $q$) = '[]'::jsonb);
select test.ok('ผู้ไม่ล็อกอินเรียกยอดยกมาไม่ได้',
  test.as_anon($q$ select public.punpang_acct_opening('2030-01-01') $q$) like 'ERR:42501:%');

-- ใบกำกับภาษีที่ใช้งานได้ต่อออร์เดอร์: ใบเดียว · ยกเลิกแล้ว (voidedBy) ออกใบใหม่ได้ · ใบลดหนี้ไม่นับ
insert into public.punpang_acct_invoices (id, kind, year, seq, no, order_id, doc_date, data) values ('ao_i1', 'invoice', 2099, 1, 'AO-INV-1', 'ao_o1', '2026-11-01', '{}');
do $$
declare dup boolean := false;
begin
  begin
    insert into public.punpang_acct_invoices (id, kind, year, seq, no, order_id, doc_date, data) values ('ao_i2', 'invoice', 2099, 2, 'AO-INV-2', 'ao_o1', '2026-11-02', '{}');
  exception when unique_violation then dup := true;
  end;
  if not dup then raise exception 'ออกใบกำกับภาษีซ้ำในออร์เดอร์เดียวกันได้'; end if;
end
$$;
insert into public.punpang_acct_invoices (id, kind, year, seq, no, order_id, doc_date, data) values ('ao_c1', 'credit', 2099, 3, 'AO-CN-1', 'ao_o1', '2026-11-03', '{}');
update public.punpang_acct_invoices set data = data || '{"voidedBy":"ao_c1"}' where id = 'ao_i1';
insert into public.punpang_acct_invoices (id, kind, year, seq, no, order_id, doc_date, data) values ('ao_i3', 'invoice', 2099, 4, 'AO-INV-3', 'ao_o1', '2026-11-04', '{}');
select test.ok('ยกเลิกใบเดิมด้วยใบลดหนี้แล้ว ออกใบใหม่ได้', exists (select 1 from public.punpang_acct_invoices where id = 'ao_i3'));

rollback;
