# การจัดส่งสั่งล่วงหน้าต้องชำระเต็มจำนวนตอนสั่ง Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ออเดอร์จัดส่งสั่งล่วงหน้ามีมัดจำเท่ายอดรวมเสมอ รับที่ร้านคงมัดจำตามเปอร์เซ็นต์เดิม

**Architecture:** เซิร์ฟเวอร์ (`preorder` Edge Function, action `create`) เป็นผู้ตั้งมัดจำ · หน้าลูกค้าแสดงข้อความชำระเต็มเมื่อเลือกส่งพัสดุ · ไม่แก้ฐานข้อมูลหรือบัญชี

**Tech Stack:** Deno (Edge Function, เทสต์ `npm run test:fn`), Vue 3 (`StorePreorder.vue`), Playwright e2e (`e2e/preorderStore.supabase.e2e.mjs`)

**Spec:** `docs/superpowers/specs/2026-11-24-preorder-delivery-full-payment-design.md`

## Global Constraints
- ออเดอร์จัดส่ง: มัดจำ = ยอดรวม (`total`) ทุกกรณี ไม่ใช้ `deposit_percent`
- รับที่ร้าน: มัดจำ = `Math.ceil((total * deposit_percent) / 100 * 100) / 100` (สูตรเดิม)
- ห้ามรับค่ามัดจำจาก client
- ข้อความลูกค้า: "การจัดส่งต้องชำระเต็มจำนวนตอนสั่ง"

## Review Focus
1. ออเดอร์จัดส่งที่มัดจำ 50% ในแคมเปญ → ได้มัดจำเท่ายอดรวม
2. รับที่ร้านในแคมเปญเดียวกัน → มัดจำยังเป็นเปอร์เซ็นต์เดิม
3. ลูกค้าที่ส่งค่า `deposit` มาเอง → ไม่มีผล

---

### Task 1: เซิร์ฟเวอร์ตั้งมัดจำจัดส่งเป็นยอดเต็ม

**Files:**
- Modify: `supabase/functions/preorder/index.ts:237` (บรรทัดคำนวณ `const deposit`)
- Test: `supabase/tests/functions/preorder/preorder.test.ts` (เพิ่มเคส)

**Interfaces:**
- Consumes: ตัวแปร `total`, `c.deposit_percent`, `b.fulfillment` ที่มีอยู่ใน action `create`
- Produces: ค่าที่ตอบกลับ `deposit` ของ `create` เป็นยอดเต็มเมื่อ `fulfillment === 'delivery'`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ใน `preorder.test.ts` ด้วย fixture แคมเปญ `c_parcel` (มี `shipping` และ `parcel.enabled`) และ `deposit_percent` 50:
  - `create` ด้วย `fulfillment: 'delivery'` พร้อมที่อยู่ → `deposit === total`
  - `create` ด้วย `fulfillment: 'pickup'` ในแคมเปญ `c_open` (50%) → `deposit === total * 0.5` ปัดตามสูตร
- [ ] **Step 2: รันให้ล้ม** `npm run test:fn` · คาด: FAIL ในเคสจัดส่ง
- [ ] **Step 3: แก้ `index.ts` บรรทัดคำนวณมัดจำ** ให้เป็น `const deposit = b.fulfillment === 'delivery' ? total : Math.ceil((total * c.deposit_percent) / 100 * 100) / 100`
- [ ] **Step 4: รันให้ผ่าน** `npm run test:fn` · คาด: ผ่านทั้งหมด (246+)
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): ออเดอร์จัดส่งชำระเต็มจำนวนตอนสั่ง"`

### Task 2: หน้าลูกค้าแสดงข้อความชำระเต็ม

**Files:**
- Modify: `src/views/store/StorePreorder.vue` (ใกล้ตัวเลือกการรับสินค้า บรรทัดที่มี `value="delivery"` ราว 198)
- Test: `e2e/preorderStore.supabase.e2e.mjs`

**Interfaces:**
- Consumes: ตัวแปร `fulfillment` (ค่า `'delivery'`/`'pickup'`) ที่มีอยู่แล้ว

- [ ] **Step 1: เขียนเช็ก e2e ที่ล้มเหลว** ในขั้นที่ 1b: หลังเลือก `ส่งพัสดุ` → ข้อความ "การจัดส่งต้องชำระเต็มจำนวนตอนสั่ง" ปรากฏ · หลังเลือก `รับที่ร้าน` → ข้อความนี้ไม่ปรากฏ
- [ ] **Step 2: รัน** `node e2e/preorderStore.supabase.e2e.mjs` · คาด: FAIL ในเช็กใหม่
- [ ] **Step 3: เพิ่มบรรทัดข้อความ** ใต้ตัวเลือกการรับสินค้า: `<p v-if="fulfillment === 'delivery'" class="text-sm text-amber-800">การจัดส่งต้องชำระเต็มจำนวนตอนสั่ง</p>`
- [ ] **Step 4: รันให้ผ่าน** `node e2e/preorderStore.supabase.e2e.mjs` · คาด: ผ่าน 6/6 และเคสใหม่
- [ ] **Step 5: ตรวจงบ** `npm run build && npm run test:bundle` · ถ้าเกิน 929 KB หยุดและขออนุมัติพร้อมตัวเลข
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): หน้าลูกค้าแจ้งว่าการจัดส่งต้องชำระเต็ม"`

## การตรวจสอบรวม
- `npm test` · `npm run test:fn` · `node e2e/preorderStore.supabase.e2e.mjs` · `npm run build && npm run test:bundle`
