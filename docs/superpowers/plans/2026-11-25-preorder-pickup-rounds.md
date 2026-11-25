# สั่งล่วงหน้า: โหมดวันรับ 2 แบบ รอบเวลาและโควตารายรอบ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แคมเปญเลือกโหมดรับได้ทั้งวัน หรือรอบเวลาที่มีโควตาจำนวนออร์เดอร์ต่อรอบ · ปุ่มเตรียมเสร็จและข้อความเตรียมเสร็จมีเฉพาะโหมดรอบ · รับที่ร้านชำระส่วนที่เหลือได้

**Architecture:** คอลัมน์ `round_time` ในตารางโควตา (ว่างเมื่อโหมดวัน) · RPC จองรับ `p_round` และตรวจ cap ของรอบแบบอะตอมมิก · นิยามรอบอยู่ใน `data` ของแคมเปญ · ออเดอร์เก็บ `pickupRound`

**Tech Stack:** Postgres (migration + `supabase/tests/run.sh`), Deno (Edge Function `preorder`, `preorder-admin`, `npm run test:fn`), Node (ฟังก์ชันล้วน), Vue 3 (หน้าลูกค้า หน้าตั้งค่า รายการออร์เดอร์), Playwright (e2e)

**Spec:** `docs/superpowers/specs/2026-11-25-preorder-pickup-rounds-design.md`

## Global Constraints
- โหมดแคมเปญล็อกเมื่อเปิดรับแล้ว
- จำนวนรอบสูงสุด 12 รอบ เวลาไม่ซ้ำ รูปแบบ HH:MM
- cap ของรอบเป็นจำนวนออร์เดอร์ (จำนวนเต็ม ≥ 1)
- ห้ามรับ `round` หรือ `cap` จาก client เป็นค่าที่ใช้จริง ต้องตรวจที่เซิร์ฟเวอร์
- งบ bundle ไม่เกิน 933 KB (ถ้าเกิน หยุดและขออนุมัติ)

## Review Focus
1. จองรอบที่เต็มแล้ว → ต้องถูกปฏิเสธ ไม่จองเกิน
2. รอบที่ไม่มีในแคมเปญ → ปฏิเสธ
3. โหมดวันไม่ใช้รอบ → ออเดอร์ไม่มี `pickupRound` และโควตาไม่แยกรอบ
4. ปุ่มเตรียมเสร็จไม่โผล่ในโหมดวัน → และข้อความเตรียมเสร็จไม่ถูกส่ง
5. ออเดอร์เก่า (ไม่มีรอบ) ยังทำงานได้ตามเดิม

---

### Task 1: นิยามรอบและกติกาการตรวจ (ฟังก์ชันล้วน)

**Files:**
- Create: `src/lib/preorderRounds.js`
- Test: `src/lib/preorderRounds.test.mjs`

**Interfaces:**
- Produces:
  - `cleanRounds(input)` → `{ok:true, rounds:[{time,cap}]}` หรือ `{ok:false, error}` (HH:MM, ไม่ซ้ำ, cap ≥ 1, ≤ 12 รอบ)
  - `pickupMode(campaign)` → `'day'` | `'slot'`
  - `roundOf(campaign, time)` → รอบที่มีในแคมเปญ หรือ `null`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ครอบคลุม Review Focus ข้อ 2, 3 และกติกาจำนวนรอบ/เวลาซ้ำ/cap
- [ ] **Step 2: รัน** `node src/lib/preorderRounds.test.mjs` · คาด FAIL
- [ ] **Step 3: เขียนฟังก์ชัน** ตามสัญญาข้างบน ไม่มี DOM/เครือข่าย
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งหมด
- [ ] **Step 5: ซิงก์ schedlib** เพิ่มไฟล์ใน `SCHEDLIB_FILES` แล้ว `node scripts/sync-schedlib.mjs`
- [ ] **Step 6: คอมมิต**

### Task 2: โควตารายรอบ (migration + SQL)

**Files:**
- Create: `supabase/migrations/20261127260000_punpang_preorder_rounds.sql`
- Test: `supabase/tests/preorder_rounds.test.sql`
- Modify: `supabase/tests/run.sh` (เพิ่มบล็อกเรียกเทสต์ใหม่)

**Interfaces:**
- Consumes: ตารางโควตา `punpang_preorder_slots` และ RPC จอง `punpang_preorder_reserve` ที่มีอยู่
- Produces: คอลัมน์ `round_time text not null default ''` ในคีย์โควตา · RPC จองใหม่รับ `p_round text` (ว่าง = โหมดวัน) และตรวจ cap ของรอบจาก `data.rounds`

- [ ] **Step 1: เขียนเทสต์ SQL ที่ล้มเหลว** (ก) จองรอบเต็มถูกปฏิเสธ (ข) รอบต่างกันแยกโควตา (ค) รอบที่ไม่มีในแคมเปญถูกปฏิเสธ (ง) โหมดวันไม่ใช้รอบ
- [ ] **Step 2: รัน** `bash supabase/tests/run.sh` · คาด FAIL
- [ ] **Step 3: เขียน migration** เพิ่มคอลัมน์และขยายคีย์โควตา แก้ `punpang_preorder_reserve` ให้รับรอบ (เก็บลายเซ็นเดิมที่ไม่ใช่รอบให้ใช้ได้กับออเดอร์เก่า) และซิงก์โหมดทดสอบ
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต**

### Task 3: สร้างออเดอร์และรายการรอบใน Edge Function `preorder`

**Files:**
- Modify: `supabase/functions/preorder/index.ts`
- Test: `supabase/tests/functions/preorder/preorder.test.ts`

**Interfaces:**
- Consumes: `roundOf`, `pickupMode` จาก Task 1 (ผ่าน schedlib) · RPC จาก Task 2
- Produces: `campaigns` ส่ง `pickupMode` และ `rounds` (เฉพาะ time และ cap คงเหลือ) · `create` รับ `pickupRound` ถ้าโหมดรอบ

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** (ก) โหมดรอบ ไม่ส่งรอบ → 400 (ข) รอบเต็ม → 409 (ค) รอบถูกต้อง → ออเดอร์มี `pickupRound` (ง) โหมดวัน ส่งรอบมา → ละเว้น
- [ ] **Step 2: รัน** `npm run test:fn` · คาด FAIL
- [ ] **Step 3: แก้ `create` และ `campaigns`** ตามสัญญา
- [ ] **Step 4: รันให้ผ่าน** คาด: ผ่านทั้งชุด
- [ ] **Step 5: คอมมิต**

### Task 4: ปุ่มเตรียมเสร็จและข้อความ `ready` (ร้าน)

**Files:**
- Modify: `supabase/functions/preorder-admin/index.ts` (action `mark_ready`)
- Modify: `src/lib/preorderNotify.js` (เหตุการณ์ `ready` และข้อความ)
- Modify: `src/views/manage/PreorderOrdersPanel.vue` (ปุ่มเตรียมเสร็จ เฉพาะออเดอร์ของแคมเปญโหมดรอบ)
- Test: `src/lib/preorderNotify.test.mjs`, `supabase/tests/functions/preorder-admin/preorder_admin.test.ts`

**Interfaces:**
- Produces: action `mark_ready` บันทึก `readyAt` และคืนข้อความ `ready` ให้ผู้เรียกส่ง · ข้อความ: "คำสั่งซื้อ {code} เตรียมเสร็จแล้วค่ะ รับได้ตั้งแต่ {เวลารอบ} ถึงสิ้นวันค่ะ"

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** (ก) `mark_ready` ในโหมดวันถูกปฏิเสธ (ข) ข้อความ ready มีเวลารอบ (ค) หน้าไม่แสดงปุ่มในโหมดวัน
- [ ] **Step 2: รัน** ให้ FAIL
- [ ] **Step 3: เพิ่ม action, ข้อความ และปุ่ม** ตามสัญญา
- [ ] **Step 4: รันให้ผ่าน**
- [ ] **Step 5: คอมมิต**

### Task 5: หน้าลูกค้าและหน้าตั้งค่าแคมเปญ

**Files:**
- Modify: `src/views/store/StorePreorder.vue` (เลือกโหมดรอบ: เลือกวัน → เลือกรอบ แสดง "รับได้ตั้งแต่ HH:MM ถึงสิ้นวัน", รอบเต็มแสดงว่าเต็ม, ข้อความ "ชำระส่วนที่เหลือตอนรับสินค้าได้" ในรับที่ร้าน)
- Modify: `src/views/manage/ManagePreorders.vue` (ตัวเลือกโหมด และตารางรอบ+cap, ล็อกหลังเปิดรับ)
- Modify: `src/lib/preorderCampaign.js` (ตรวจนิยามเรียกจาก `cleanRounds`)
- Test: `e2e/preorderRounds.ui.e2e.mjs`

- [ ] **Step 1: เขียน e2e ที่ล้มเหลว** ลูกค้าโหมดรอบเลือกรอบแล้วเห็นช่วงรับ · รอบเต็มแสดงว่าเต็ม · หน้าตั้งค่าเพิ่มรอบได้และล็อกหลังเปิดรับ
- [ ] **Step 2: รัน** ให้ FAIL
- [ ] **Step 3: แก้หน้าตามสัญญา**
- [ ] **Step 4: รันให้ผ่าน** และ `npm run build && npm run test:bundle` (เกินเพดานหยุดและขออนุมัติ)
- [ ] **Step 5: ตรวจภาพ** 390×844 และ 844×390 ไม่มีแนวนอนล้น
- [ ] **Step 6: คอมมิต**

### Task 6: ตรวจรวม

- [ ] **Step 1:** `npm test` · `npm run test:fn` · `bash supabase/tests/run.sh` · e2e ที่เกี่ยวข้อง
- [ ] **Step 2:** รายงานผลจริงทุกคำสั่ง
- [ ] **Step 3:** ขอคำสั่งก่อนเปิด PR และก่อน Release (ต้องอนุมัติ environment production)

## การตรวจสอบรวม
- ทุกข้อใน Review Focus มีเทสต์ที่ตรวจโดยตรง
- เริ่มหลังการแจ้งเตือนลูกค้า Task 4 เสร็จ เพราะทั้งคู่แก้ `preorder` และ `preorder-admin`
