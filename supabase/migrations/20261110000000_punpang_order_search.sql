-- ค้นออร์เดอร์ทุกวันที่เซิร์ฟเวอร์ (หน้าออเดอร์ค้นหา) · ค้นแบบไม่สนตัวพิมพ์เล็ก-ใหญ่ด้วย position() (ไม่ตีความ % _ เป็นตัวแทน)
-- ค้น: เลขออร์เดอร์ · ชื่อ/เบอร์/LINE ของลูกค้า · ข้อความใน data (ชื่อสินค้า/หมายเหตุ/ตัวเลือก/ชื่อวันเกิด)
-- security invoker: ใช้สิทธิ์ของผู้เรียก (RLS เดิมของ punpang_orders และ punpang_customers)
create or replace function public.punpang_order_search(q text)
returns table (id text, code text, customer_id text, status text, fulfillment text, channel text, data jsonb)
language sql
stable
security invoker
set search_path = public
as $$
  select o.id, o.code, o.customer_id, o.status, o.fulfillment, o.channel, o.data
  from punpang_orders o
  left join punpang_customers c on c.id = o.customer_id
  where length(trim(coalesce(q, ''))) > 0
    and (
      position(lower(trim(q)) in lower(coalesce(o.code, ''))) > 0
      or position(lower(trim(q)) in lower(coalesce(c.name, ''))) > 0
      or position(lower(trim(q)) in lower(coalesce(c.phone, ''))) > 0
      or position(lower(trim(q)) in lower(coalesce(c.line, ''))) > 0
      or position(lower(trim(q)) in lower(o.data::text)) > 0
    )
  order by o.code, o.id;
$$;

grant execute on function public.punpang_order_search(text) to authenticated;
