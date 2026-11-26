-- สั่งล่วงหน้า เฟส 4: ออกใบกำกับภาษีเต็มรูปตอนส่งมอบ (ดู docs/superpowers/specs/2026-11-26-preorder-tax-invoice-design.md)
-- RPC นี้บันทึกใบเท่านั้น · ตรวจกติกาทั้งหมดที่ Edge Function preorder-admin (action issue_invoice) และ src/lib/preorderInvoice.js
-- แต่ที่นี่ตรวจซ้ำด้วยสถานะและใบซ้ำ เพื่อกันการออกซ้ำเมื่อกดพร้อมกัน
-- เลขที่ออกโดย trigger เดิม punpang_acct_invoices_guard (ต่อเนื่องกับใบของออร์เดอร์ปกติ)
-- เรียกได้เฉพาะ service_role

create or replace function public.punpang_preorder_issue_invoice(
  p_order text,
  p_date date,
  p_inv_id text,
  p_inv_data jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_status text;
  v_active int;
  v_no text;
begin
  -- ล็อกแถวออร์เดอร์ก่อน: คำขอพร้อมกันของออร์เดอร์เดียวกันจะรอกันทีละราย
  select status into v_status from public.punpang_preorder_orders where id = p_order for update;
  if not found then
    raise exception 'ไม่พบออร์เดอร์' using errcode = 'P0001';
  end if;
  if v_status is distinct from 'delivered' then
    raise exception 'ออกใบกำกับภาษีได้เมื่อส่งมอบแล้วเท่านั้น' using errcode = 'P0001';
  end if;
  select count(*) into v_active
    from public.punpang_acct_invoices
   where order_id = p_order and kind = 'invoice' and coalesce(data->>'voidedBy', '') = '';
  if v_active > 0 then
    raise exception 'ออกใบกำกับภาษีของออร์เดอร์นี้แล้ว' using errcode = 'P0001';
  end if;
  insert into public.punpang_acct_invoices (id, kind, order_id, doc_date, no, year, seq, data)
  values (p_inv_id, 'invoice', p_order, p_date, '', 0, 0, p_inv_data)
  returning no into v_no;
  return jsonb_build_object('no', v_no);
end
$function$;

revoke all on function public.punpang_preorder_issue_invoice(text, date, text, jsonb) from public, anon, authenticated;
grant execute on function public.punpang_preorder_issue_invoice(text, date, text, jsonb) to service_role;
