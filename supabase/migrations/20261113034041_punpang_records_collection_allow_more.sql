-- อนุญาต collection เพิ่มที่ระบบเขียนลง punpang_records: retentionLog (ผลลบข้อมูลรายคืน) · slipRead (ผลอ่านสลิปที่จำไว้ใช้ซ้ำ) · slipTrain (รายการรูปชุดเทรน) · fileDeletions (ประวัติการลบไฟล์ของ Worker)
-- ค่าเดิมทั้ง 14 ตัวยังอยู่ครบ จึงไม่กระทบข้อมูลที่มีอยู่
alter table public.punpang_records drop constraint if exists punpang_records_collection_check;
alter table public.punpang_records add constraint punpang_records_collection_check check (collection = any (array['reviews','coupons','spinLog','photoRequests','deletionRequests','birthdayGreeted','notifySent','shortLinks','outbox','bell','orderLinks','consents','chatDrafts','aiLog','retentionLog','slipRead','slipTrain','fileDeletions']::text[]));
