-- ด่านสุดท้ายของการแปลงใบเสนอซ้ำ: ใบเสนอหนึ่งใบมีออร์เดอร์ได้ไม่เกินหนึ่งใบ (ทุกสถานะ รวมที่ยกเลิกแล้ว)
-- ไฟล์นี้ต้องรันหลัง deploy order-create ที่เรียก punpang_quote_order_create แล้ว (ฉบับเก่าจะไม่แยกข้อผิดพลาดนี้)
-- และหลังตรวจใน production แล้วว่าไม่มีออร์เดอร์ที่ quoteId ซ้ำ (ถ้ามี ดัชนีจะสร้างไม่ได้ ต้องแก้ข้อมูลก่อน)

create unique index if not exists punpang_orders_quote_uniq
  on public.punpang_orders ((data->>'quoteId'))
  where coalesce(data->>'quoteId', '') <> '';

-- โหมดทดสอบ: คัดลอกดัชนีไปยัง punpang_test
select punpang_test.punpang_test_sync();
