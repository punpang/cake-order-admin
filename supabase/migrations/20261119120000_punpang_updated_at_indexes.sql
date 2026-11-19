-- ดึงเฉพาะแถวที่เปลี่ยน (แอปพนักงาน): where updated_at >= $since order by updated_at, id
-- updated_at ตั้งโดย trigger ทุกครั้งที่แก้ (orders: punpang_guard_status · customers: punpang_customers_touch · chats: punpang_touch_updated)
create index if not exists punpang_orders_updated_at_idx on public.punpang_orders (updated_at, id);
create index if not exists punpang_customers_updated_at_idx on public.punpang_customers (updated_at, id);
create index if not exists punpang_chats_updated_at_idx on public.punpang_chats (updated_at desc);
