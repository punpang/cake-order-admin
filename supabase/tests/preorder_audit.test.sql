-- ทดสอบคิวตรวจออร์เดอร์สั่งล่วงหน้า (migration 20261127360000) · รันโดย supabase/tests/run.sh · ทำในธุรกรรมแล้ว rollback
-- U1 คิวมีเฉพาะออร์เดอร์ที่ส่งมอบ/ยกเลิก และมี loyalty แล้ว
-- U2 ออร์เดอร์ที่ตรวจแล้วและไม่ถูกแก้หลังตรวจ จะไม่อยู่ในคิว
-- U3 ออร์เดอร์ที่ถูกแก้หลังตรวจ (updated_at ใหม่กว่า checked_at) กลับเข้าคิว
-- U4 บทบาทแอปเขียนผลตรวจไม่ได้ และเรียกคิวไม่ได้ (42501)

begin;

insert into public.punpang_preorder_campaigns (id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data)
  values ('au_camp', 'closed', '2000-01-01', '2099-12-31', '2099-12-24', '2099-12-26', 50, 120, '{"name":"ตรวจ","dayCap":null,"items":[]}');

insert into public.punpang_preorder_orders (id, campaign_id, code, status, pickup_date, data) values
  ('au_o1', 'au_camp', 'PRE-AU-0001', 'delivered', '2099-12-24',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}],"loyalty":{"points":5,"mult":1}}'::jsonb),
  ('au_o2', 'au_camp', 'PRE-AU-0002', 'delivered', '2099-12-24',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}]}'::jsonb),
  ('au_o3', 'au_camp', 'PRE-AU-0003', 'awaiting_payment', '2099-12-24',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}],"loyalty":{"points":5,"mult":1}}'::jsonb),
  ('au_o4', 'au_camp', 'PRE-AU-0004', 'cancelled', '2099-12-24',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}],"loyalty":{"points":5,"mult":1}}'::jsonb),
  ('au_o5', 'au_camp', 'PRE-AU-0005', 'delivered', '2099-12-24',
    '{"items":[{"retailId":"A","unitPrice":250,"qty":2}],"loyalty":{"points":5,"mult":1}}'::jsonb);

-- au_o5 ตรวจแล้วหลังแก้ไขล่าสุด (checked_at เท่ากับ updated_at ในธุรกรรมนี้ จึงไม่กลับเข้าคิว)
insert into public.punpang_preorder_audits (order_id, checked_at, ok, flags)
  values ('au_o5', (select updated_at from public.punpang_preorder_orders where id = 'au_o5'), true, '[]');

-- U3: ตรวจไว้ก่อน แล้วจำลองการแก้ไขให้ updated_at ใหม่กว่า checked_at
insert into public.punpang_preorder_audits (order_id, checked_at, ok, flags)
  values ('au_o4', now() - interval '1 day', true, '[]');
update public.punpang_preorder_orders set updated_at = now() where id = 'au_o4';

select test.ok('U1 คิวมีเฉพาะออร์เดอร์ที่ส่งมอบ/ยกเลิกและมี loyalty (au_o1, au_o4)',
  (select array_agg(id order by id) from public.punpang_preorder_orders_unaudited(50)
     where id like 'au_%') = array['au_o1', 'au_o4']::text[]);

select test.ok('U2 ออร์เดอร์ที่ตรวจแล้วและไม่ถูกแก้หลังตรวจไม่อยู่ในคิว (au_o5)',
  not exists (select 1 from public.punpang_preorder_orders_unaudited(50) where id = 'au_o5'));

select test.ok('U3 ออร์เดอร์ที่ถูกแก้หลังตรวจกลับเข้าคิว (au_o4)',
  exists (select 1 from public.punpang_preorder_orders_unaudited(50) where id = 'au_o4'));

select test.ok('U4a บทบาทแอปเขียนผลตรวจไม่ได้',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000e1',
    $$insert into public.punpang_preorder_audits (order_id, ok, flags) values ('au_o1', true, '[]')$$), 10) = 'ERR:42501:');

select test.ok('U4b บทบาทแอปเรียกคิวตรวจไม่ได้',
  left(test.as_staff('d7000000-0000-4000-8000-0000000000e1',
    $$select count(*) from public.punpang_preorder_orders_unaudited(10)$$), 10) = 'ERR:42501:');

rollback;
