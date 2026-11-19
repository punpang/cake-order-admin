-- ออร์เดอร์ที่ยังไม่ปิด: แอปดึงทุกครั้งที่ล็อกอิน (status not in cancelled/delivered · เรียง code, id)
-- เดิมไม่มีดัชนีช่วย → อ่านทั้งตารางเพื่อกรอง (วัดกับข้อมูลจำลอง 50,000 ออร์เดอร์บนฐานข้อมูลจริง: 168 ms และเพิ่มตามประวัติ)
-- ดัชนีบางส่วนเก็บเฉพาะออร์เดอร์ที่ยังไม่ปิด จึงเล็กและไม่โตตามประวัติ · ใช้กับการดึงลูกค้าของออร์เดอร์ค้าง (โหมดโหลดลูกค้าเฉพาะที่ใช้) ด้วย
create index if not exists punpang_orders_open_idx on public.punpang_orders (code, id)
  where status not in ('cancelled', 'delivered');

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีดัชนีใหม่ด้วย
select punpang_test.punpang_test_sync();
