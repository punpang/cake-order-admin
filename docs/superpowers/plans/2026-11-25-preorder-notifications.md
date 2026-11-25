# การแจ้งเตือนลูกค้าสั่งล่วงหน้า Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ลูกค้าสั่งล่วงหน้าได้รับข้อความทุกเหตุการณ์สำคัญ (สั่งเสร็จ ชำระแล้ว เตือนก่อนหมดเวลา 1 ชม. ขยาย ยกเลิก หมดเวลา พัสดุ ถึงปลายทาง ขอคืนและคืนเงิน) ผ่าน LINE ก่อน ไม่เช่นนั้น SMS สำรอง โดยไม่ส่งซ้ำ

**Architecture:** ตารางกันซ้ำ `punpang_preorder_notifications` (unique: order_id + event) · ฟังก์ชันข้อความไทยล้วนใน `src/lib/preorderNotify.js` (sync ไป schedlib) · ฟังก์ชันส่งกลาง `_shared/preorderNotify.ts` เลือกช่องทางและบันทึกผล · จุดเรียกอยู่ใน Edge Function เดิม · งานเตือนหมดเวลาใช้ cron ใหม่

**Tech Stack:** Vue/Node (ข้อความ + เทสต์ Node), Deno (Edge Function + เทสต์ `npm run test:fn`), Postgres (migration + `supabase/tests/run.sh`), Playwright ไม่จำเป็นสำหรับงานนี้

**Spec:** `docs/superpowers/specs/2026-11-25-preorder-notifications-design.md`

## Global Constraints
- ห้ามส่ง SMS/LINE จริงระหว่างทดสอบ ใช้ stub เท่านั้น
- ข้อความต้องไม่มีรหัสออร์เดอร์ที่ใช้เปิดข้อมูลได้เอง ลิงก์ไปหน้า "ออร์เดอร์ของฉัน" เท่านั้น (ต้องยืนยัน OTP)
- การส่งไม่สำเร็จต้องไม่ทำให้การทำรายการหลักล้มเหลว
- ข้อความภาษาไทย ไม่เกิน 300 ตัวอักษรสำหรับ SMS
- ไม่ส่งข้อความเตือนให้ออเดอร์ที่ไม่ได้อยู่สถานะรอชำระ

## Review Focus
1. เรียกจุดส่งซ้ำ (retry, กดซ้ำ, cron ทำงานซ้ำ) → ลูกค้าได้รับข้อความเพียงครั้งเดียวต่อเหตุการณ์
2. ลูกค้าไม่มี LINE และเบอร์ไม่ถูกต้อง → ไม่ล้ม และบันทึกเหตุผล
3. ผู้ส่งข้อความล้มเหลวชั่วคราว → ออเดอร์ยังทำรายการได้ปกติ
4. เหตุการณ์เกิดใกล้กำหนดเวลา (เตือน 1 ชม. ตอนเหลือน้อยกว่า 1 ชม.) → ไม่ส่งเตือนที่ล้าสมัย
5. ข้อความที่มีชื่อหรือยอดเงินต้องตรงกับข้อมูลจริงในออเดอร์ ณ เวลาที่เกิดเหตุการณ์

---

### Task 1: ตารางกันซ้ำและฟังก์ชันบันทึกการแจ้ง

**Files:**
- Create: `supabase/migrations/20261127250000_punpang_preorder_notifications.sql`
- Test: `supabase/tests/preorder_notify.test.sql`

**Interfaces:**
- Produces: ตาราง `public.punpang_preorder_notifications(id bigserial, order_id text, event text, channel text, status text, reason text, created_at timestamptz)` · unique (order_id, event) เฉพาะ status = 'sent' · RPC `punpang_preorder_notify_claim(p_order text, p_event text) returns boolean` (true เมื่อได้สิทธิ์ส่งครั้งแรก)

- [ ] **Step 1: เขียนเทสต์ SQL ที่ล้มเหลว** ตรวจว่า claim ครั้งแรกได้ true และครั้งที่สองได้ false
- [ ] **Step 2: รัน** `bash supabase/tests/run.sh` · คาด FAIL เพราะยังไม่มีตาราง
- [ ] **Step 3: เขียน migration** สร้างตาราง ดัชนี และ RPC (security definer, grant เฉพาะ service_role) พร้อม `select punpang_test.punpang_test_sync();` ท้ายไฟล์
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): ตารางกันการแจ้งเตือนซ้ำ"`

### Task 2: ข้อความไทยต่อเหตุการณ์ (ฟังก์ชันล้วน)

**Files:**
- Create: `src/lib/preorderNotify.js`
- Test: `src/lib/preorderNotify.test.mjs`

**Interfaces:**
- Produces: `notifyText(event, order, campaign)` คืนสตริงข้อความไทย · `EVENTS` = `['placed','paid','reminder1h','extend_requested','extended','cancelled','expired','shipped','delivered','balance_due','return_requested','refunded']`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ต่อเหตุการณ์ 1 เคส ตรวจว่ามีชื่อแคมเปญ รหัสออร์เดอร์ และยอดตามข้อมูล และความยาวไม่เกิน 300 ตัวอักษร
- [ ] **Step 2: รัน** `node src/lib/preorderNotify.test.mjs` · คาด FAIL
- [ ] **Step 3: เขียนฟังก์ชัน** ตามเหตุการณ์ในสเปก ไม่มีลิงก์ที่มีรหัสในตัว
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งหมด
- [ ] **Step 5: sync ไป schedlib** `node scripts/sync-schedlib.mjs` แล้วตรวจว่าไฟล์ปรากฏใน `supabase/functions/_shared/schedlib`
- [ ] **Step 6: คอมมิต**

### Task 3: ฟังก์ชันส่งกลาง (เลือกช่องทาง กันซ้ำ บันทึกผล)

**Files:**
- Create: `supabase/functions/_shared/preorderNotify.ts`
- Test: `supabase/tests/functions/_shared/preorderNotify.test.ts`

**Interfaces:**
- Consumes: `sendSmsGateway(local, text, idem)` จาก `_shared/sms.ts` · `pushPayload`, `pickFollowedLineUser` จาก `_shared/linepush.ts` · `punpang_line_users(customer_id)` · RPC จาก Task 1
- Produces: `notifyCustomer(sb, { orderId, customerId, phoneLocal, event, text }): Promise<'sent'|'skipped'|'failed'>`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ด้วย stub ของ SMS/LINE: (ก) มี LINE → ส่ง LINE ไม่ส่ง SMS (ข) ไม่มี LINE → ส่ง SMS (ค) เรียกซ้ำ → skipped (ง) ส่งล้มเหลว → failed และไม่ throw
- [ ] **Step 2: รัน** `npm run test:fn` · คาด FAIL
- [ ] **Step 3: เขียนฟังก์ชัน** ตามลำดับ: claim → เลือกช่องทาง → ส่ง → อัปเดตสถานะ (ถ้าส่งไม่สำเร็จให้ปลด claim เพื่อให้รอบถัดไปลองใหม่ได้เฉพาะ cron)
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่าน
- [ ] **Step 5: คอมมิต**

### Task 4: จุดส่งเหตุการณ์ในฟังก์ชันเดิม

**Files:**
- Modify: `supabase/functions/preorder/index.ts` (placed, paid QR, extend_requested)
- Modify: `supabase/functions/preorder-admin/index.ts` (paid cash, extended, cancelled, shipped, delivered, return_requested, refunded)
- Test: `supabase/tests/functions/preorder/preorder.test.ts`, `supabase/tests/functions/preorder-admin/preorder_admin.test.ts`

**Interfaces:**
- Consumes: `notifyCustomer` จาก Task 3 · `notifyText` จาก Task 2

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ต่อจุดส่ง: เหตุการณ์ที่สำเร็จเรียก notifyCustomer ด้วยเหตุการณ์ถูกต้อง · ถ้าการส่งล้มเหลว การทำรายการหลักยังสำเร็จ
- [ ] **Step 2: รัน** `npm run test:fn` · คาด FAIL
- [ ] **Step 3: เพิ่มการเรียกหลังทำรายการสำเร็จ** เท่านั้น (ไม่ก่อน) และห่อด้วย try/catch
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต**

### Task 5: เตือนก่อนหมดเวลา 1 ชม. และหมดเวลา (งานตั้งเวลา)

**Files:**
- Create: `supabase/migrations/20261127260000_punpang_preorder_notify_cron.sql` (ตั้งงาน cron ใหม่ทุก 5 นาที)
- Create: `supabase/functions/_shared/preorderNotifyPlan.ts` (ฟังก์ชันคัดกรองออเดอร์ล้วน)
- Test: `supabase/tests/functions/_shared/preorderNotifyPlan.test.ts`, `supabase/tests/preorder_notify.test.sql` (เพิ่ม)

**Interfaces:**
- Produces: `planReminders(orders, nowMs)` คืนรายการที่ต้องเตือน (payDueAt - now ≤ 60 นาที และ > 0, status = awaiting_payment) · งาน cron เรียกฟังก์ชันที่ส่งผ่าน Task 3

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** เตือนเฉพาะออเดอร์รอชำระที่เหลือไม่เกิน 60 นาที · ไม่เตือนซ้ำ · ไม่เตือนออเดอร์ที่ชำระแล้ว · ไม่เตือนเมื่อหมดเวลาแล้ว
- [ ] **Step 2: รัน** ให้ FAIL
- [ ] **Step 3: เขียนฟังก์ชันคัดกรอง และ migration งาน cron** (ใช้รูปแบบเดียวกับ `punpang_preorder_expire` เดิม)
- [ ] **Step 4: รันให้ผ่าน** ทั้ง `npm run test:fn` และ `bash supabase/tests/run.sh`
- [ ] **Step 5: คอมมิต**

### Task 6: ตรวจรวม

- [ ] **Step 1:** `npm test` · `npm run test:fn` · `bash supabase/tests/run.sh` · `npm run build && npm run test:bundle` (ถ้าเกินเพดาน หยุดและขออนุมัติก่อน)
- [ ] **Step 2:** รายงานผลจริงทุกคำสั่ง ไม่สรุปว่าผ่านถ้ายังไม่ได้รัน
- [ ] **Step 3:** เสนอ PR และรอคำสั่ง (ห้ามสร้าง PR ก่อนได้รับคำสั่ง) และ Release ต้องรอการอนุมัติ environment production

## การตรวจสอบรวม
- ทุกเหตุการณ์ใน Review Focus มีเทสต์ที่ตรวจพฤติกรรมนั้นโดยตรง
- ไม่มีการส่งข้อความจริงระหว่างการทดสอบ
