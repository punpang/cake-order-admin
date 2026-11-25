# สั่งล่วงหน้าในแชท Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** พนักงานเห็นออร์เดอร์สั่งล่วงหน้าที่ยังไม่ปิดของลูกค้าคนที่กำลังคุยอยู่ ในแผง "ข้อมูลลูกค้า" ของแชท และกดไปหน้าสั่งล่วงหน้าได้

**Architecture:** action ใหม่ `customerOrders` ใน `preorder-admin` (ดึงเฉพาะลูกค้าที่ขอ) · ฟังก์ชันล้วนกรองและเรียงใน `src/lib/preorderCustomerOrders.js` · ส่วนใหม่ในแผงลูกค้าของ `Chat.vue` โหลดเมื่อเปิดแผง

**Tech Stack:** Vue 3, Node (เทสต์ฟังก์ชันล้วน), Deno (Edge Function), Playwright (e2e แชท)

**Spec:** `docs/superpowers/specs/2026-11-25-preorder-chat-design.md`

## Global Constraints
- ต้องมีสิทธิ์ `managePreorder` หรือ `manage` เท่านั้น
- คืนเฉพาะออร์เดอร์ของ `customerId` ที่ขอ ห้ามคืนของลูกค้าคนอื่น
- ข้อมูลที่คืนมีเฉพาะที่ใช้แสดง: id รหัส สถานะ วันรับ ยอดค้าง และ `payDueAt`
- ไม่เพิ่มการโหลดข้อมูลสั่งล่วงหน้าในหน้าแชทตอนเปิดหน้า โหลดเฉพาะตอนเปิดแผงลูกค้า
- งบ bundle ต้องไม่เกิน 933 KB (ถ้าเกิน หยุดและขออนุมัติ)

## Review Focus
1. ลูกค้าไม่ได้ผูกบัญชี → ไม่เรียกเซิร์ฟเวอร์และแสดงข้อความให้ผูกก่อน
2. `customerId` ไม่ใช่ uuid หรือไม่มี → 400 ไม่ดึงข้อมูล
3. ผู้ไม่มีสิทธิ์เรียก → 403 ไม่มีข้อมูลรั่ว
4. ออร์เดอร์ยกเลิก/หมดเวลา/ส่งมอบแล้ว → ไม่แสดง
5. โหลดผิดพลาดหรือช้า → แสดงสถานะผิดพลาดและไม่ค้างหน้าแชท

---

### Task 1: ฟังก์ชันกรองและเรียง (ล้วน)

**Files:**
- Create: `src/lib/preorderCustomerOrders.js`
- Test: `src/lib/preorderCustomerOrders.test.mjs`

**Interfaces:**
- Produces: `openPreorders(rows)` → รายการที่ไม่ใช่ `cancelled`/`expired`/`delivered`, เรียงตาม `payDueAt` (ไม่มีค่าอยู่ท้าย) · ตัดฟิลด์เกินทิ้ง

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ครอบคลุม Review Focus ข้อ 4 และการเรียง
- [ ] **Step 2: รัน** `node src/lib/preorderCustomerOrders.test.mjs` · คาด FAIL
- [ ] **Step 3: เขียนฟังก์ชัน** ตามสัญญาข้างบน
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งหมด
- [ ] **Step 5: ซิงก์ schedlib ถ้าใช้ในฟังก์ชันเซิร์ฟเวอร์** (ถ้าไม่ใช้ข้ามขั้นนี้)
- [ ] **Step 6: คอมมิต**

### Task 2: Edge action `customerOrders`

**Files:**
- Modify: `supabase/functions/preorder-admin/index.ts`
- Test: `supabase/tests/functions/preorder-admin/preorder_admin.test.ts`

**Interfaces:**
- Consumes: `openPreorders` จาก Task 1 (ผ่าน schedlib ถ้าซิงก์)
- Produces: POST `{action:'customerOrders', customerId}` → `{ok:true, data:[{id, code, status, pickupDate, due, payDueAt}]}`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** (ก) ไม่มีสิทธิ์ 403 (ข) customerId ไม่ใช่ uuid 400 (ค) คืนเฉพาะออร์เดอร์ของลูกค้าที่ขอ (ง) ไม่คืนออร์เดอร์ยกเลิก
- [ ] **Step 2: รัน** `npm run test:fn` · คาด FAIL
- [ ] **Step 3: เพิ่ม action** ค้นด้วย `customer_id` และเรียกฟังก์ชันกรอง ไม่คัดลอกตรรกะ
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต**

### Task 3: แผงสั่งล่วงหน้าในหน้าแชท

**Files:**
- Modify: `src/views/Chat.vue` (ส่วนใหม่ "สั่งล่วงหน้า" หลังส่วน "ออร์เดอร์ที่ยังไม่ปิด" ในแผง "ข้อมูลลูกค้า")
- Modify: `src/lib/staffAuth.js` หรือไฟล์เรียกเดิมของ preorder-admin (เพิ่มฟังก์ชัน `customerPreorders(customerId)`)

**Interfaces:**
- Consumes: `customerOrders` จาก Task 2 · `openPreorders` จาก Task 1 (ถ้าใช้ฝั่งหน้าเว็บ)
- Produces: ส่วน UI ที่มีสถานะ ว่าง / กำลังโหลด / ผิดพลาด / รายการ · รายการกดไป `/admin/preorders`

- [ ] **Step 1: เขียน e2e ที่ล้มเหลว** ใน `e2e/chatPreorder.supabase.e2e.mjs`: ลูกค้าที่ผูกแล้วเห็นออร์เดอร์สั่งล่วงหน้าของตนเอง และไม่เห็นของคนอื่น
- [ ] **Step 2: รัน** `node e2e/chatPreorder.supabase.e2e.mjs` · คาด FAIL
- [ ] **Step 3: เพิ่มส่วน UI** โหลดเมื่อเปิดแผงและมีลูกค้า แสดงข้อความตามสถานะ
- [ ] **Step 4: รันให้ผ่าน** และ `npm run build && npm run test:bundle` (ถ้าเกินเพดาน หยุดและขออนุมัติ)
- [ ] **Step 5: ตรวจภาพ** 390×844 และ 844×390 ไม่มีแนวนอนล้น
- [ ] **Step 6: คอมมิต**

### Task 4: ตรวจรวมและส่งต่อ

- [ ] **Step 1:** `npm test` · `npm run test:fn` · `bash supabase/tests/run.sh` · e2e ที่เกี่ยวข้อง
- [ ] **Step 2:** รายงานผลจริงทุกคำสั่ง
- [ ] **Step 3:** ขอคำสั่งก่อนเปิด PR และก่อน Release `preorder-admin` (ต้องอนุมัติ environment production)

## การตรวจสอบรวม
- ทุกข้อใน Review Focus มีเทสต์ที่ตรวจโดยตรง
- เริ่มทำหลัง PR #163 merge และ Release รายงานเสร็จ เพื่อไม่ให้แก้ `preorder-admin` ชนกัน
