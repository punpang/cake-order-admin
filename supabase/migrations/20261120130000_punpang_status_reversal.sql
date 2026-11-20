-- การย้อนสถานะออร์เดอร์ (ออกจาก "ส่งมอบแล้ว" หรือ "ยกเลิกแล้ว" ไปสถานะอื่น) ต้องมีสิทธิ์ revertStatus ทุกครั้ง
-- เดิมตรวจสิทธิ์จากสถานะใหม่อย่างเดียว: ผู้มี deliverPickup ย้ายออร์เดอร์ที่ยกเลิกเป็นส่งมอบได้ และผู้มี cancel ยกเลิกออร์เดอร์ที่ส่งมอบแล้วได้
-- ค่าเริ่มต้นของ revertStatus มีเฉพาะผู้ดูแล (admin) · เหตุผลการย้อนบังคับและบันทึกในประวัติที่แอป (ไม่ได้บังคับที่ฐานข้อมูล)
-- ลำดับ deploy: หน้าเว็บ (ที่ขอเหตุผลและเช็กสิทธิ์ก่อนส่ง) ต้องขึ้นก่อน แล้วค่อยรันไฟล์นี้
-- punpang_set_status คงบรรทัดตรวจพนักงานจาก 20261120100000 ไว้ (ต้องไม่หายเมื่อสร้างใหม่)

create or replace function public.punpang_guard_status()
returns trigger language plpgsql set search_path = '' as $$
declare
  need text;
  oc int; nc int; orp int; nrp int;
begin
  new.updated_at := now();
  -- service_role / ไม่มี JWT (Edge Function ฝั่งเซิร์ฟเวอร์) และฟังก์ชัน punpang_set_status ตรวจสิทธิ์เองแล้ว
  if (select auth.uid()) is null or coalesce(current_setting('punpang.rpc', true), '') = 'on' then
    return new;
  end if;

  if new.status is distinct from old.status then
    need := case
      -- ย้อนจากสถานะจบแล้ว (ส่งมอบ/ยกเลิก) ไปสถานะอื่นทุกทาง ต้องมี revertStatus
      when old.status in ('delivered', 'cancelled') then 'revertStatus'
      when new.status = 'cancelled' then 'cancel'
      when new.status = 'preparing' then 'startPreparing'
      when new.status = 'prepared' then 'markPrepared'
      when new.status in ('ready_to_ship','shipping') then 'deliverShipping'
      when new.status = 'delivered' and new.fulfillment = 'delivery' then 'deliverShipping'
      when new.status = 'delivered' then 'deliverPickup'
      when new.status = 'payment_confirmed' then 'confirmPayment'
      when new.status = 'order_confirmed' then 'confirmUnpaid'
      when new.status = 'payment_reported' then 'reportPayment'
      when new.status = 'awaiting_payment' and old.status = 'draft' then 'sendToPayment'
      else 'revertStatus' end;
    if not public.punpang_has_perm(need) then
      raise exception 'no permission to change status (%)', need using errcode = '42501';
    end if;
  end if;

  select count(*) filter (where e->>'status' = 'confirmed'), count(*) filter (where e->>'status' = 'reported')
    into oc, orp from jsonb_array_elements(coalesce(old.data->'payments', '[]'::jsonb)) e;
  select count(*) filter (where e->>'status' = 'confirmed'), count(*) filter (where e->>'status' = 'reported')
    into nc, nrp from jsonb_array_elements(coalesce(new.data->'payments', '[]'::jsonb)) e;

  if nc > oc and not public.punpang_has_perm('confirmPayment') then
    raise exception 'no permission to confirm payment' using errcode = '42501';
  end if;
  if nc < oc and not (public.punpang_has_perm('cancelConfirmedPayment') or public.punpang_has_perm('refundPartial')
                      or public.punpang_has_perm('cancel') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('revertStatus')) then
    raise exception 'no permission to cancel confirmed payment' using errcode = '42501';
  end if;
  if nrp > orp and not (public.punpang_has_perm('reportPayment') or public.punpang_has_perm('confirmPayment')) then
    raise exception 'no permission to report payment' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.punpang_set_status(p_order text, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
declare o public.punpang_orders; need text;
begin
  if not exists (select 1 from public.punpang_staff s where s.user_id = (select auth.uid()) and s.active) then raise exception 'no permission' using errcode = '42501'; end if;
  select * into o from public.punpang_orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  need := case
    when o.status in ('delivered', 'cancelled') and p_status <> o.status then 'revertStatus'
    when p_status = 'cancelled' then 'cancel'
    when p_status = 'preparing' then 'startPreparing'
    when p_status = 'prepared' then 'markPrepared'
    when p_status in ('ready_to_ship','shipping') then 'deliverShipping'
    when p_status = 'delivered' and o.fulfillment = 'delivery' then 'deliverShipping'
    when p_status = 'delivered' then 'deliverPickup'
    when p_status = 'payment_confirmed' then 'confirmPayment'
    when p_status = 'order_confirmed' then 'confirmUnpaid'
    when p_status = 'payment_reported' then 'reportPayment'
    when p_status = 'awaiting_payment' and o.status = 'draft' then 'sendToPayment'
    else 'revertStatus' end;
  if not public.punpang_has_perm(need) then raise exception 'no permission (%)', need using errcode = '42501'; end if;
  perform set_config('punpang.rpc', 'on', true);
  update public.punpang_orders set status = p_status where id = p_order;
end $$;
revoke all on function public.punpang_set_status(text, text) from public, anon;
grant execute on function public.punpang_set_status(text, text) to authenticated;

-- โหมดทดสอบ: คัดลอกฟังก์ชันใหม่ไปยัง punpang_test แล้วตัดสิทธิ์เรียกจาก anon/public ของสำเนา (รูปแบบเดียวกับ 20261117032226)
select punpang_test.punpang_test_sync();
revoke execute on function punpang_test.punpang_guard_status() from public, anon;
revoke all on function punpang_test.punpang_set_status(text, text) from public, anon;
