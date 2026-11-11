-- บันทึกการเรียกบอท AI (collection 'aiLog') ต้องอยู่ในรายชื่อ collection ที่อนุญาตของ punpang_records
-- เดิมไม่มี 'aiLog' → บันทึกล้มเหลวเงียบ ๆ (fb-webhook ดักข้อผิดพลาดของ log ไว้) · รายชื่ออื่นคงเดิมตามฐานข้อมูล
-- การอ่านบันทึกนี้ใช้นโยบายเดิม punpang_rec_can (สิทธิ์ manage) · เขียนโดย fb-webhook ด้วย service role
alter table public.punpang_records drop constraint if exists punpang_records_collection_check;
alter table public.punpang_records add constraint punpang_records_collection_check check (
  collection = any (array[
    'reviews', 'coupons', 'spinLog', 'photoRequests', 'deletionRequests', 'birthdayGreeted',
    'notifySent', 'shortLinks', 'outbox', 'bell', 'orderLinks', 'consents', 'chatDrafts',
    'aiLog'
  ])
);
