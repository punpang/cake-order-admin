-- สั่งล่วงหน้า: จำกัดการขยายเวลาไม่ให้เกินวันชำระสุดท้ายของแคมเปญ (แบบร่าง 2026-11-25-preorder-final-date-design)
-- แก้เฉพาะฟังก์ชัน punpang_preorder_extend ให้ตรวจ payLastDate เพิ่ม ส่วนอื่นเหมือนเดิมทุกประการ
-- ถ้าแคมเปญตั้ง payLastDate ไว้ และวันที่ขยายเกินสิ้นวันนั้น (เวลาไทย) → คืน {"error":"past_last"} โดยไม่แตะข้อมูล

create or replace function public.punpang_preorder_extend(p_order text, p_new_due timestamptz, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  cid text; o record; r jsonb; sp jsonb; pts integer; pv numeric; paid numeric; dep numeric; st text;
  cdata jsonb; lastDay text;
  nowz text := to_char(p_now at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  duez text;
begin
  if p_new_due is null or p_new_due <= p_now then return jsonb_build_object('error', 'bad_due'); end if;
  duez := to_char(p_new_due at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  select customer_id into cid from public.punpang_preorder_orders where id = p_order;
  if not found then return jsonb_build_object('error', 'no_order'); end if;
  perform 1 from public.punpang_customers where id = cid for update;
  select * into o from public.punpang_preorder_orders where id = p_order for update;
  if o.status <> 'expired' then return jsonb_build_object('error', 'bad_status'); end if;

  select data into cdata from public.punpang_preorder_campaigns where id = o.campaign_id;
  lastDay := coalesce(cdata->>'payLastDate', '');
  if lastDay <> '' and p_new_due > (lastDay || 'T23:59:59.999+07:00')::timestamptz then
    return jsonb_build_object('error', 'past_last');
  end if;

  r := public.punpang_preorder_reserve(o.campaign_id, o.pickup_date, coalesce(o.data->'lines', '[]'::jsonb), false);
  if not coalesce((r->>'ok')::boolean, false) then
    raise exception 'quota_full:%', coalesce(r->>'error', 'unknown') using errcode = 'P0001';
  end if;

  pts := coalesce((o.data->>'pointsUsed')::integer, 0);
  if pts > 0 then
    pv := public.punpang__pts_cfg('pointValue', 1);
    sp := public.punpang_preorder_spend_points(p_order, cid, pts, round(pts * pv, 2));
    if sp ? 'error' then raise exception 'points:%', sp->>'error' using errcode = 'P0001'; end if;
  end if;

  paid := public.punpang_preorder_paid_total(o.data);
  dep := coalesce((o.data->'deposit'->>'amount')::numeric, 0);
  st := case when paid >= dep then 'payment_confirmed' else 'awaiting_payment' end;
  update public.punpang_preorder_orders
    set status = st, updated_at = now(),
        data = o.data
          || jsonb_build_object('payDueAt', duez,
               'extensions', coalesce(o.data->'extensions', '[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', nowz, 'newDue', duez)))
          || (case when o.data ? 'extensionRequest'
                   then jsonb_build_object('extensionRequest', jsonb_set(o.data->'extensionRequest', '{status}', '"approved"'::jsonb))
                   else '{}'::jsonb end)
    where id = p_order;
  return jsonb_build_object('ok', true, 'status', st, 'payDueAt', duez);
end $$;

revoke all on function public.punpang_preorder_extend(text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.punpang_preorder_extend(text, timestamptz, timestamptz) to service_role;

-- ซิงก์สำเนาโหมดทดสอบให้มี RPC ที่แก้ไข
select punpang_test.punpang_test_sync();
