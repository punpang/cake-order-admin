-- สั่งล่วงหน้า: บันทึกค่าไปรษณีย์จริงตอนส่งพัสดุ (ต้นทุนบัญชี 5500) · เพิ่มพารามิเตอร์ p_postage (ค่าเริ่มต้น 0 เพื่อให้เรียกแบบเดิมได้)
-- ลบฟังก์ชันเดิมก่อน กันไม่ให้มีสองเวอร์ชันที่เรียกด้วยสามอาร์กิวเมนต์แล้วกำกวม
drop function if exists public.punpang_preorder_set_shipping(text, text, text, timestamptz);

create or replace function public.punpang_preorder_set_shipping(p_order text, p_carrier text, p_tracking text, p_postage numeric default 0, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; total numeric; paid numeric;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
begin
  if p_carrier is null or length(trim(p_carrier)) = 0 or length(trim(p_carrier)) > 40 then return jsonb_build_object('error', 'bad_carrier'); end if;
  if p_tracking is null or length(trim(p_tracking)) < 3 or length(trim(p_tracking)) > 60 or trim(p_tracking) !~ '^[A-Za-z0-9-]+$' then
    return jsonb_build_object('error', 'bad_tracking');
  end if;
  if p_postage is null or p_postage < 0 or p_postage > 100000 or p_postage <> round(p_postage, 2) then
    return jsonb_build_object('error', 'bad_postage');
  end if;
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if coalesce(o.data->>'fulfillment', '') <> 'delivery' then return jsonb_build_object('error', 'not_delivery'); end if;
  if o.status <> 'payment_confirmed' then return jsonb_build_object('error', 'bad_status'); end if;
  total := coalesce((o.data->>'total')::numeric, 0);
  paid := public.punpang_preorder_paid_total(o.data);
  if paid < total then return jsonb_build_object('error', 'balance_due'); end if;
  update public.punpang_preorder_orders
    set status = 'shipped', updated_at = now(),
        data = o.data || jsonb_build_object('shipping', jsonb_build_object('carrier', trim(p_carrier), 'trackingNo', upper(trim(p_tracking)), 'shippedAt', nowz, 'postage', p_postage))
    where id = p_order;
  return jsonb_build_object('ok', true, 'status', 'shipped', 'trackingNo', upper(trim(p_tracking)), 'postage', p_postage);
end $$;

revoke all on function public.punpang_preorder_set_shipping(text, text, text, numeric, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_set_shipping(text, text, text, numeric, timestamptz) to service_role;
