# รายงานสั่งล่วงหน้า Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ร้านดูรายงาน 6 รายการของสั่งล่วงหน้า (ใบจัดเตรียม, รับของประจำวัน, จัดส่งพัสดุ, ยอดค้างชำระ, สรุปรายแคมเปญ, ยกเลิก/หมดเวลา/คืนเงิน) ที่นับถูกต้องจากเซิร์ฟเวอร์ และพิมพ์ได้

**Architecture:** ฟังก์ชันจัดกลุ่มล้วนใน `src/lib/preorderReports.js` (ซิงก์ไป schedlib) · Edge action `reports` ใน `preorder-admin` โหลดออร์เดอร์แล้วเรียกฟังก์ชันชุดเดียวกัน · แท็บ "รายงาน" ใน `ManagePreorders.vue` เรียก action นี้

**Tech Stack:** Vue 3, Node (เทสต์ฟังก์ชันล้วน), Deno (Edge Function), Playwright (e2e แท็บรายงาน)

**Spec:** `docs/superpowers/specs/2026-11-25-preorder-reports-design.md`

## Global Constraints
- นับเฉพาะออร์เดอร์ที่ไม่ใช่ `cancelled` และไม่ใช่ `expired` ทุกรายงาน ยกเว้นรายงานยกเลิก/หมดเวลา/คืนเงิน
- ต้องมีสิทธิ์ `managePreorder` เท่านั้น (ใช้การตรวจสิทธิ์เดิมของ `preorder-admin`)
- ข้อมูลลูกค้าในรายงานเป็นชื่อและเบอร์ที่จำเป็นต่อการรับของเท่านั้น
- ตัวเลขต้องตรงกับหน้าออร์เดอร์และหน้าบัญชีสำหรับข้อมูลเดียวกัน
- ห้ามคำนวณยอดในหน้าเว็บ ให้ใช้ค่าจากเซิร์ฟเวอร์

## Review Focus
1. ออร์เดอร์ยกเลิกหรือหมดเวลาแล้วปรากฏในใบจัดเตรียม → ไม่ควรปรากฏ
2. ออร์เดอร์ชำระบางส่วนแสดงเป็นชำระครบ → ต้องแสดงยอดค้างจริง
3. ออร์เดอร์ที่ไม่มีวันรับหรือสินค้าว่าง → ไม่ทำให้รายงานล้ม และรายงานไว้ในส่วนข้อยกเว้น
4. ผู้ไม่มีสิทธิ์เรียก `reports` → 403 ไม่มีข้อมูลรั่ว
5. จำนวนรวมของใบจัดเตรียมต้องเท่ากับผลรวมของรายการในวันนั้น → ไม่นับซ้ำข้ามวัน

---

### Task 1: ฟังก์ชันจัดกลุ่มรายงาน (ล้วน)

**Files:**
- Create: `src/lib/preorderReports.js`
- Test: `src/lib/preorderReports.test.mjs`

**Interfaces:**
- Produces:
  - `activeOrders(orders)` → ตัดสถานะ cancelled/expired
  - `prepSheet(orders, {campaignId?, from?, to?})` → `[{pickupDate, items:[{name, qty}], orderCount, exceptions:[...]}]`
  - `pickupList(orders, {date})` → รายการลูกค้าที่รับวันนั้น พร้อม `paid`, `due`, `fulfillment`
  - `shipQueue(orders)` → ออร์เดอร์จัดส่งที่ยังไม่ส่ง พร้อม `postage`, `trackingNo`
  - `dueList(orders, {nowMs})` → ออร์เดอร์ที่ `due > 0` เรียงตาม `payDueAt`
  - `campaignSummary(orders, campaign)` → `{sales, deposit, reserved, remaining}`
  - `exceptionList(orders)` → cancelled / expired / refunded พร้อมเหตุผล

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ครอบคลุม Review Focus ข้อ 1, 2, 3, 5 ด้วยข้อมูลตัวอย่าง
- [ ] **Step 2: รัน** `node src/lib/preorderReports.test.mjs` · คาด FAIL
- [ ] **Step 3: เขียนฟังก์ชัน** ตามสัญญาข้างบน ไม่มีการเข้าถึง DOM หรือ network
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งหมด
- [ ] **Step 5: ซิงก์ schedlib** `node scripts/sync-schedlib.mjs` แล้วตรวจว่าไฟล์อยู่ใน `supabase/functions/_shared/schedlib`
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): ฟังก์ชันรายงานสั่งล่วงหน้า"`

### Task 2: Edge action `reports`

**Files:**
- Modify: `supabase/functions/preorder-admin/index.ts`
- Test: `supabase/tests/functions/preorder-admin/preorder_admin.test.ts`

**Interfaces:**
- Consumes: ฟังก์ชันจาก Task 1 (ผ่าน `_shared/schedlib`)
- Produces: POST `{action:'reports', report, campaignId?, from?, to?, date?}` → `{ok:true, data}` · report ∈ `prep|pickup|ship|due|campaign|exceptions`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** (ก) ไม่มีสิทธิ์ → 403 (ข) report ไม่รู้จัก → 400 (ค) `prep` คืนยอดตามกติกาการนับ (ง) ข้อมูลลูกค้าไม่เกินชื่อกับเบอร์
- [ ] **Step 2: รัน** `npm run test:fn` · คาด FAIL
- [ ] **Step 3: เพิ่ม action** โดยเรียกฟังก์ชันจาก schedlib ไม่คัดลอกตรรกะ
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต**

### Task 3: แท็บ "รายงาน" ในหน้าสั่งล่วงหน้า

**Files:**
- Create: `src/views/manage/PreorderReportsPanel.vue`
- Modify: `src/views/manage/ManagePreorders.vue` (เพิ่มแท็บที่สาม หลังแท็บ "ออร์เดอร์")
- Modify: `src/lib/staffAuth.js` (เพิ่มฟังก์ชันเรียก action `reports` ตามรูปแบบ `preorderAdminCall`)

**Interfaces:**
- Consumes: `reports` action จาก Task 2
- Produces: ตัวกรองแคมเปญ วันที่/ช่วงวัน · ปุ่มพิมพ์ (`window.print()`) · CSS พิมพ์ซ่อนแถบนำทาง

- [ ] **Step 1: เขียน e2e ที่ล้มเหลว** ใน `e2e/preorderReports.supabase.e2e.mjs`: เปิดแท็บรายงาน เห็นตัวเลขใบจัดเตรียมตรงกับตัวอย่าง และไม่เห็นออร์เดอร์ที่ยกเลิก
- [ ] **Step 2: รัน** `node e2e/preorderReports.supabase.e2e.mjs` · คาด FAIL
- [ ] **Step 3: สร้างแท็บและหน้าแสดงผล** แบบการ์ดบนมือถือ ตารางบนจอกว้าง
- [ ] **Step 4: รันให้ผ่าน** และ `npm run build && npm run test:bundle` (ถ้าเกินเพดาน หยุดและขออนุมัติพร้อมตัวเลข)
- [ ] **Step 5: ตรวจภาพ** 390×844 และ 844×390 ว่าไม่มีแนวนอนล้น
- [ ] **Step 6: คอมมิต**

### Task 4: ตรวจรวม

- [ ] **Step 1:** `npm test` · `npm run test:fn` · `bash supabase/tests/run.sh` · e2e ที่เกี่ยวข้องทั้งหมด
- [ ] **Step 2:** รายงานผลจริงทุกคำสั่ง ไม่สรุปว่าผ่านถ้ายังไม่ได้รัน
- [ ] **Step 3:** ขอคำสั่งก่อนสร้าง PR และก่อน Release (Release ต้องได้รับอนุมัติ environment production)

## การตรวจสอบรวม
- ทุกข้อใน Review Focus มีเทสต์ที่ตรวจโดยตรง
- ตัวเลขในรายงานเทียบกับหน้าออร์เดอร์ได้ตรงกันในข้อมูลตัวอย่างเดียวกัน
