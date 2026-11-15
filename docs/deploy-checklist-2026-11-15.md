# เช็กลิสต์ deploy และทดสอบด้วยมือ — รอบ 2026-11-15

ยังไม่ได้ deploy อะไร · รายละเอียดเหตุผลและสถานะอยู่ใน `docs/security.md` · ทุกขั้นตอนทำโดยผู้ดูแลระบบ ไม่ใช่การรันอัตโนมัติ

## 0) ก่อนเริ่ม
- [ ] ตรวจประวัติ migration ของ production เทียบกับรีโปแล้ว (ไม่ตรงกัน 18 ไฟล์ และมี 1 เวอร์ชันที่รีโปไม่มี — ดู `docs/security.md`)
- [ ] ยืนยันว่ามีการสำรองข้อมูลล่าสุดของฐานข้อมูล
- [ ] **ห้ามรัน** `20261114025000_punpang_tungngern_rename` บน production
- [ ] ค่าลับตรงกัน: Edge secret `PUSH_SEND_KEY` = Vault `push_send_key` · Edge secret `SCHEDULED_KEY` = Vault `scheduled_key`
- [ ] ยังไม่ merge เข้า main (ตามที่เลือก) · deploy จาก branch `claude/loving-sagan-ygzxt1` (66add52 หรือใหม่กว่า) · Vault `push_send_key` ยังไม่มีบน production (ตรวจเมื่อ 2026-11-15) ต้องสร้างก่อนข้อ 1

## 1) ลำดับ deploy (ห้ามสลับ)
1. SQL รันทีเดียว: `supabase/deploy/2026-11-15-run-once.sql` (รวม `20261115000000`–`070000`, `090000`, `100000`, `110000` ในธุรกรรมเดียว · ก่อนรันต้องสำรองข้อมูลและสร้าง Vault secret `push_send_key` ตามหัวไฟล์) · ทดสอบบนฐานจำลองแล้ว รันซ้ำได้
2. Edge Functions ที่ต้อง deploy (ตรวจแล้ว: Edge Function อื่นไม่มีการเปลี่ยนแปลงที่ต้องส่งขึ้นใหม่)
   - `order-audit` (ใหม่): `supabase functions deploy order-audit --project-ref itleduijrckxdbhhuooi --no-verify-jwt --yes` (pg_cron เรียกด้วย `x-cron-key` ไม่มี JWT)
   - `quote-create` (ใหม่): `supabase functions deploy quote-create --project-ref itleduijrckxdbhhuooi --yes` (เรียกด้วย JWT ของพนักงาน)
   - `sms-send` (แก้ 2026-11-15): `supabase functions deploy sms-send --project-ref itleduijrckxdbhhuooi --yes`
   - `push-send` (แก้): รัน workflow **Deploy push-send** (ต้องตั้ง secret `FCM_SERVICE_ACCOUNT` ก่อน) หรือ `supabase functions deploy push-send --project-ref itleduijrckxdbhhuooi --no-verify-jwt --yes`
   - เมื่อรัน workflow บน GitHub ต้องเลือก branch `claude/loving-sagan-ygzxt1` ก่อน เพราะค่าเริ่มต้นคือ main ซึ่งยังไม่มีการเปลี่ยนแปลงนี้
3. Worker `punpang-files` (แก้ `worker/src/index.js`) · deploy ตามวิธีเดิมของ Worker ในโฟลเดอร์ `worker/` (ชื่อใน `wrangler.jsonc`)
4. หน้าเว็บ และ build แอป Android (`CustomerDisplayPlugin`)
5. SQL: `20261115080000_punpang_quote_server.sql` (ปิด INSERT ใบเสนอจากเครื่องพนักงาน) — **หลังข้อ 4 เท่านั้น**

หมายเหตุ: ข้อ 2 และ 4 ควรทำติดกัน และต้องทำหลังข้อ 1 เสร็จ เพราะหน้าเว็บใหม่เรียกฟังก์ชันด่านตรวจ และ `order-audit` เขียนธง `hold` ที่ต้องมีคอลัมน์จากข้อ 1

## 2) ตรวจหลัง deploy (ภายใน 15 นาที)
- [ ] `select jobname, schedule, active from cron.job where jobname = 'punpang-order-audit';` → active และเวลา `*/10 * * * *`
- [ ] `select status, return_message from cron.job_run_details where jobid = (select jobid from cron.job where jobname = 'punpang-order-audit') order by start_time desc limit 5;` → ไม่ล้มเหลวต่อเนื่อง
- [ ] `select hold, count(*) from public.punpang_order_audits group by hold;` → มีแถวหลังรอบแรกของ cron (ถ้ายังไม่มี ให้รอ 10 นาทีแล้วตรวจอีกครั้ง)
- [ ] Logs ของ `order-audit` ไม่มี error (`transfers`, `history`, `save`, `catalog`)
- [ ] เปิดหน้ารายละเอียดออร์เดอร์และหน้าชำระเงินได้ ไม่มีข้อผิดพลาดใน console

## 3) ทดสอบด้วยมือ (ใช้ข้อมูลทดสอบหรือออร์เดอร์จริงที่รู้ผล)
ผลที่คาดไว้อยู่ในวงเล็บ

- [ ] **A. ออร์เดอร์ตรงที่ผลตรวจมีรายการ high และยังไม่ชำระ** (แบนเนอร์ขึ้นข้อความ "ก่อนยืนยันชำระหรือส่งมอบ" · ปุ่มรับชำระทันทีและยืนยันยอดชำระถูกล็อกสำหรับทุกคนจนกว่าผู้จัดการจะตรวจ)
- [ ] **B. ผู้จัดการกด "ผู้จัดการตรวจแล้ว"** (แบนเนอร์เป็นสีเขียว · ปุ่มกลับมาใช้ได้ · ยืนยันชำระได้)
- [ ] **C. ออร์เดอร์ที่ชำระแล้วและยังมีรายการ high** (แบนเนอร์ข้อความ "ก่อนส่งมอบ" · ปุ่มส่งมอบถูกล็อกจนผู้จัดการตรวจ)
- [ ] **D. บิลหน้าร้าน (POS) ที่มี hold** (ยืนยันชำระและส่งมอบได้ตามปกติ · ไม่มีแบนเนอร์)
- [ ] **E. ออร์เดอร์ตรงที่โอนผ่าน QR และยอดตรงแจ้งเตือนธนาคาร** (ตรวจใน `punpang_order_audits.flags`: ไม่มี `transfer_amount_mismatch` · ถ้าไม่พบแจ้งเตือนจะเป็น `transfer_unmatched` ระดับ check ซึ่งไม่กั้นการทำงาน)
- [ ] **F. ยืนยันอัตโนมัติจากแจ้งเตือนธนาคารกับออร์เดอร์ที่ hold** (ตามที่ตัดสินใจไว้: ยืนยันชำระได้ · แบนเนอร์เปลี่ยนเป็น "ก่อนส่งมอบ" · ส่งมอบยังถูกล็อก)
- [ ] **G. ส่งมอบออร์เดอร์ที่ hold หลังผู้จัดการตรวจ** (ส่งมอบได้)
- [ ] **H. การทำงานเดิมที่ต้องไม่เสีย** (ตามเอกสาร `docs/security.md` ข้อ 7: เปลี่ยนผู้ซื้อที่มีคะแนน · แก้ราคาในร่างและออร์เดอร์ที่กำลังเตรียม · แนบสลิป · แจ้งเตือนพนักงาน · ใบเสนอในแชทราคาตรงแคตาล็อก)

## 4) ย้อนกลับ (ถ้ามีปัญหา)
- ปิดด่านตรวจ (ไม่กระทบข้อมูล): `drop trigger if exists punpang_orders_review_gate on public.punpang_orders;`
- หยุดการตรวจอัตโนมัติ: `select cron.unschedule('punpang-order-audit');`
- ก่อนย้อนหน้าเว็บกลับเวอร์ชันเก่า ให้ปิดด่านก่อน เพราะหน้าเว็บเก่าไม่รู้จักด่าน และการซิงก์ออร์เดอร์ที่ถูกปฏิเสธจะค้าง
- ตาราง `punpang_order_reviews` และ `punpang_order_audits` คงไว้ ไม่ต้องลบ
