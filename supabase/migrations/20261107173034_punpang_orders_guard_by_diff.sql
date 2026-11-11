-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261107173034) · เนื้อตรงกับที่รันจริง

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

alter policy ord_upd on public.punpang_orders
  using (
    public.punpang_has_perm('createOrder') or public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
    or public.punpang_has_perm('editPickup') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('workPhoto')
    or public.punpang_has_perm('startPreparing') or public.punpang_has_perm('markPrepared') or public.punpang_has_perm('deliverPickup')
    or public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('reportPayment')
    or public.punpang_has_perm('cancel') or public.punpang_has_perm('revertStatus') or public.punpang_has_perm('confirmUnpaid')
    or public.punpang_has_perm('requestConfirmUnpaid') or public.punpang_has_perm('refundPartial') or public.punpang_has_perm('cancelConfirmedPayment')
    or public.punpang_has_perm('sendToPayment') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('useLoyalty')
  )
  with check (
    public.punpang_has_perm('createOrder') or public.punpang_has_perm('editItems') or public.punpang_has_perm('adjustPrice')
    or public.punpang_has_perm('editPickup') or public.punpang_has_perm('changeBuyer') or public.punpang_has_perm('workPhoto')
    or public.punpang_has_perm('startPreparing') or public.punpang_has_perm('markPrepared') or public.punpang_has_perm('deliverPickup')
    or public.punpang_has_perm('deliverShipping') or public.punpang_has_perm('confirmPayment') or public.punpang_has_perm('reportPayment')
    or public.punpang_has_perm('cancel') or public.punpang_has_perm('revertStatus') or public.punpang_has_perm('confirmUnpaid')
    or public.punpang_has_perm('requestConfirmUnpaid') or public.punpang_has_perm('refundPartial') or public.punpang_has_perm('cancelConfirmedPayment')
    or public.punpang_has_perm('sendToPayment') or public.punpang_has_perm('posVoid') or public.punpang_has_perm('useLoyalty')
  );
