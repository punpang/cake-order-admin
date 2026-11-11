-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108151036) · เนื้อตรงกับที่รันจริง

alter publication supabase_realtime add table public.punpang_orders, public.punpang_customers, public.punpang_items, public.punpang_shifts, public.punpang_chats, public.punpang_quotes, public.punpang_kv, public.punpang_records;
