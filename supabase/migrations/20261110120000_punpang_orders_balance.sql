-- ยอดคงค้างของออร์เดอร์ (คำนวณจากแอปตอนบันทึก) ใช้กรองการชำระเงินที่ฐานข้อมูล
alter table public.punpang_orders add column if not exists balance numeric(12,2);
create index if not exists punpang_orders_status_pickup_idx on public.punpang_orders (status, pickup_at);
