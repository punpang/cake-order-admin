-- โหมดทดสอบ: รายชื่อผู้รับที่ส่งจริงได้ (collection "testRecipients", id "list") ต้องบันทึกได้ในสคีมาทดสอบ
-- หน้าโหมดทดสอบบันทึกรายการนี้ และ Edge Function ในโหมดทดสอบอ่านจากที่เดียวกัน (punpang_test)
-- เดิม CHECK ไม่อนุญาตค่านี้ จึงบันทึกไม่สำเร็จ ("violates check constraint punpang_records_collection_check")
-- เปลี่ยนเฉพาะสคีมาทดสอบ · ไม่เปลี่ยนตารางจริง (public) และไม่แก้แถวข้อมูลเดิม

alter table punpang_test.punpang_records drop constraint if exists punpang_records_collection_check;
alter table punpang_test.punpang_records add constraint punpang_records_collection_check
  check (collection = any (array['reviews','coupons','spinLog','photoRequests','deletionRequests','birthdayGreeted','notifySent','shortLinks','outbox','bell','orderLinks','consents','chatDrafts','aiLog','retentionLog','slipRead','slipTrain','fileDeletions','luckyTokens','testRecipients']::text[]));
