-- ตั้งค่าสำหรับการทดสอบสองเซสชันพร้อมกันของการสร้างออร์เดอร์สั่งล่วงหน้า (รันโดย run.sh · ข้อมูลอยู่ในฐานทดสอบที่ถูกลบทิ้ง)
insert into public.punpang_kv (collection, id, data) values ('config', 'loyalty', '{"v": {"pointValue": 1}}'::jsonb)
  on conflict (collection, id) do update set data = excluded.data;
insert into public.punpang_items (id, kind, name, price, active, data) values ('gcc', 'retail', 'พร้อมกัน', 100, true, '{}');
insert into public.punpang_customers (id, name, data) values ('cc1', 'ลูกค้า 1', '{}'), ('cc2', 'ลูกค้า 2', '{}');
insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('pcc', 'open', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120,
    '{"name":"พร้อมกัน","dayCap":null,"items":[{"retailId":"gcc","dayCap":1}]}');
-- แถวออร์เดอร์ที่ยอดตรงกับการคิดในฐานข้อมูล (1 ชิ้น 100 บาท)
create or replace function test.pcc_row(oid text, cid text) returns jsonb language plpgsql as $$
declare d jsonb := jsonb_build_object('items', jsonb_build_array(jsonb_build_object('unitPrice', 100, 'qty', 1)), 'payments', '[]'::jsonb);
begin
  return jsonb_build_object('id', oid, 'customer_id', cid, 'campaign_id', 'pcc', 'pickup_date', '2099-12-24', 'status', 'awaiting_payment',
    'fulfillment', 'pickup', 'data', d || jsonb_build_object('total', round(public.punpang__bill_total(d || jsonb_build_object('fulfillment', 'pickup')), 2)));
end $$;
