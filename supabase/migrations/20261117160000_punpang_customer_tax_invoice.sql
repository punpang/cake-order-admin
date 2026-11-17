-- ใบกำกับภาษีที่ลูกค้าขอ/แก้เองได้ (Edge Function tax-invoice)
-- 1) voidedBy ที่ตั้งแล้วล้างหรือเปลี่ยนค่าไม่ได้: กันแอปหลังบ้านที่ค้างข้อมูลเก่าเปิดใบที่ยกเลิกแล้วกลับมาใช้
--    (แอปหลังบ้านตั้ง voidedBy ได้เฉพาะใบที่ยังไม่ถูกยกเลิก · ไม่มีกระบวนการใดล้างหรือเปลี่ยนค่านี้)
-- 2) punpang_customer_tax_invoice: ออก/แก้ใบในธุรกรรมเดียว · ล็อกแถวออร์เดอร์กันกดซ้ำพร้อมกัน
--    ใบเดิม + ใบลดหนี้ + ใบใหม่ สำเร็จทั้งหมดหรือไม่เกิดเลย · เลขที่ยังออกโดย trigger เดิม (ต่อเนื่องไม่ขาดช่วง)
-- สิทธิ์: เรียกได้เฉพาะ service_role (Edge Function ตรวจเซสชันลูกค้าเองก่อนเรียก)
-- ลำดับ deploy: รันไฟล์นี้บน production ก่อน แล้วค่อย deploy Edge Function tax-invoice (ฟังก์ชันนั้นเรียกฟังก์ชันนี้)

create or replace function public.punpang_acct_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare pfx text; yr int; seq int;
begin
  if tg_op = 'INSERT' then
    pfx := case new.kind when 'invoice' then 'INV' else 'CN' end;
    yr := extract(year from new.doc_date)::int;
    new.year := yr;
    seq := public.punpang_acct_next('T-' || pfx, yr);
    new.seq := seq;
    new.no := pfx || '-' || (yr + 543) || '-' || lpad(seq::text, 5, '0');
    new.data := new.data || jsonb_build_object('no', new.no);
    return new;
  else
    if new.id <> old.id or new.kind <> old.kind or new.no <> old.no or new.year <> old.year or new.seq <> old.seq
       or new.order_id is distinct from old.order_id or new.doc_date <> old.doc_date
       or (new.data - 'voidedBy' - 'copies') <> (old.data - 'voidedBy' - 'copies') then
      raise exception 'ใบกำกับภาษี/ใบลดหนี้แก้ไขเนื้อหาไม่ได้' using errcode = 'P0001';
    end if;
    if coalesce(old.data->>'voidedBy', '') <> '' and new.data->>'voidedBy' is distinct from old.data->>'voidedBy' then
      raise exception 'ใบที่ยกเลิกแล้วแก้การยกเลิกไม่ได้' using errcode = 'P0001';
    end if;
    return new;
  end if;
end $function$;

create or replace function public.punpang_customer_tax_invoice(
  p_mode text,
  p_order_id text,
  p_date date,
  p_inv_id text,
  p_inv_data jsonb,
  p_cn_id text default null,
  p_cn_data jsonb default null,
  p_orig_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_active int;
  v_cur_id text;
  v_cn_no text := null;
  v_inv_no text;
begin
  if p_mode not in ('request', 'edit') then
    raise exception 'คำสั่งไม่ถูกต้อง' using errcode = 'P0001';
  end if;
  if p_mode = 'edit' and (p_orig_id is null or p_cn_id is null or p_cn_data is null) then
    raise exception 'ข้อมูลการแก้ไขไม่ครบ' using errcode = 'P0001';
  end if;
  -- ล็อกแถวออร์เดอร์ก่อน: คำขอพร้อมกันของออร์เดอร์เดียวกันจะรอกันทีละราย
  perform 1 from public.punpang_orders where id = p_order_id for update;
  if not found then
    raise exception 'ไม่พบออร์เดอร์' using errcode = 'P0001';
  end if;
  -- ใบที่ยังไม่ถูกยกเลิก (กติกาเดียวกับแอป: ไม่มี voidedBy)
  select count(*), min(id) into v_active, v_cur_id
    from public.punpang_acct_invoices
   where order_id = p_order_id and kind = 'invoice' and coalesce(data->>'voidedBy', '') = '';
  if p_mode = 'request' then
    if v_active > 0 then
      raise exception 'ออกใบกำกับภาษีไปแล้ว กรุณารีเฟรชหน้า' using errcode = 'P0001';
    end if;
  else
    if v_active <> 1 or v_cur_id is distinct from p_orig_id then
      raise exception 'ใบเดิมเปลี่ยนไปแล้ว กรุณารีเฟรชหน้า' using errcode = 'P0001';
    end if;
    insert into public.punpang_acct_invoices (id, kind, order_id, doc_date, no, year, seq, data)
    values (p_cn_id, 'credit', p_order_id, p_date, '', 0, 0, p_cn_data)
    returning no into v_cn_no;
    update public.punpang_acct_invoices
       set data = data || jsonb_build_object('voidedBy', p_cn_id)
     where id = p_orig_id;
  end if;
  insert into public.punpang_acct_invoices (id, kind, order_id, doc_date, no, year, seq, data)
  values (p_inv_id, 'invoice', p_order_id, p_date, '', 0, 0, p_inv_data)
  returning no into v_inv_no;
  return jsonb_build_object('no', v_inv_no, 'cnNo', v_cn_no);
end
$function$;

revoke all on function public.punpang_customer_tax_invoice(text, text, date, text, jsonb, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.punpang_customer_tax_invoice(text, text, date, text, jsonb, text, jsonb, text) to service_role;
