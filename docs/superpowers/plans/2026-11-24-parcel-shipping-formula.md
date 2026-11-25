# สูตรค่าส่งพัสดุ (สั่งล่วงหน้า) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ยอด "ค่าส่ง" ที่ลูกค้าเห็นคำนวณจาก ค่าธรรมเนียมร้าน (เหมาต่อออเดอร์) + ค่ากล่อง (เลือกกล่องเล็กสุดที่ปริมาตรรวมใส่ได้) + ค่าส่งจากตาราง (กล่อง × ขั้นน้ำหนัก) โดยเซิร์ฟเวอร์เป็นผู้คิด

**Architecture:** แทนที่ `parcelShipping.js` เดิม (กล่องเดียว + น้ำหนักปริมาตร + ตารางมิติเดียว) ด้วยโมดูลล้วนที่ใช้ร่วมกันผ่าน schedlib ทั้งแอปและ Edge Function · หน้าตั้งค่าร้านเก็บ `db.shop.parcel` แบบใหม่ · ออเดอร์ preorder เก็บ snapshot รายละเอียดไว้ · หน้าลูกค้าแสดงแค่บรรทัดเดียว "ค่าส่ง"

**Tech Stack:** Vue 3 (ManageShop.vue), JS ล้วน (parcelShipping.js, preorderPrice.js), Deno Edge Function (preorder), node:test ผ่าน `node <file>.test.mjs`, Deno test ผ่าน `npm run test:fn`, Playwright e2e

**Spec:** `docs/superpowers/specs/2026-11-24-parcel-shipping-formula-design.md`

## Global Constraints
- งบ bundle รวม `TOTAL_GZIP_KB = 923` (`scripts/bundle-budget.mjs`) ห้ามเพิ่มเกินโดยไม่ขออนุมัติ
- ยอดทั้งหมดคิดที่เซิร์ฟเวอร์ (`preorder` Edge Function) ห้ามรับค่าส่งจาก client
- ค่าส่งที่ลูกค้าเห็นเป็นบรรทัดเดียว "ค่าส่ง" (`shippingFee` = ผลรวมทั้งสามส่วน)
- ปัดเศษเงินเป็นบาทจำนวนเต็มตามที่ระบบเดิมใช้ (ไม่มีทศนิยมในตาราง)

## ปรับจาก design (ต้องให้ผู้ใช้ยืนยัน)
- **รูปข้อมูลตาราง:** design เขียนเป็น `rates: {[กล่อง]: [{upToG, price}]}` แต่แผนนี้ใช้ **ขั้นน้ำหนักร่วม + ราคาต่อกล่องต่อขั้น** คือ `steps: [upToG…]` และ `prices: {[กล่อง]: [ราคา…]}` เพื่อให้ตารางกล่อง × น้ำหนักไม่มีช่องว่างโดยโครงสร้างเอง
- **ข้อมูลเดิม:** `db.shop.parcel` รูปแบบเดิม (`boxG`, `volDivisor`, `rates`) ใช้ไม่ได้ ตัวอ่านคืนค่าใหม่เป็นว่างและไม่แปลงข้อมูลเดิม ร้านยังไม่เปิดขายพัสดุจริงจึงไม่กระทบลูกค้า

## Review Focus
1. ปริมาตรรวมพอดีกับขนาดกล่อง (เท่ากับ `volumeCm3`) → เลือกกล่องนั้น ไม่ใช่กล่องใหญ่กว่า
2. น้ำหนักรวมกล่องพอดีขั้น (เท่ากับ `upToG`) → ใช้ราคาขั้นนั้น
3. ปริมาตรหรือน้ำหนักเกินกล่องใหญ่สุด/ขั้นสูงสุด → ปฏิเสธ ไม่คิดราคาเดา
4. แก้ตารางหรือกล่องหลังมีออเดอร์แล้ว → ยอดออเดอร์เดิมไม่เปลี่ยน (snapshot)
5. ค่าส่งที่ client ส่งมาไม่มีผลต่อยอดที่เซิร์ฟเวอร์คิด

---

### Task 1: โมดูลคำนวณค่าส่ง (ล้วน)

**Files:**
- Modify: `src/lib/parcelShipping.js` (เขียนใหม่ทั้งไฟล์ · exports เดิมที่ไม่เปลี่ยนความหมายคงไว้: `parcelFormOf`, `parcelFieldsOf`, `parcelDimsError`, `hasParcelDims`, `PARCEL_LIMITS`)
- Test: `src/lib/parcelShipping.test.mjs` (แก้ให้ตรงกับรูปใหม่)

**Interfaces:**
- Produces:
  - `DEFAULT_PARCEL = { fee: 0, boxes: [], steps: [], prices: {} }`
  - `cleanParcelConfig(raw) → { fee, boxes: [{name, dims:{w,l,h}, volumeCm3, boxG, price}], steps: number[], prices: {[name]: number[]} }` — ตัดค่าที่ผิดทิ้ง, เรียงกล่องตาม `volumeCm3` น้อย→มาก, เรียงขั้นตามน้ำหนักน้อย→มาก
  - `parcelConfigError(raw) → string` ('' = ผ่าน) · ตรวจ: ชื่อกล่องไม่ว่างและไม่ซ้ำ · dims 1–200 ซม. จำนวนเต็ม · `boxG` จำนวนเต็ม 0–50000 · `price` และ `fee` 0–100000 · ขั้นน้ำหนักเป็นจำนวนเต็มเพิ่มขึ้นเรื่อย ๆ ไม่เกิน 30 ขั้น · `prices[กล่อง]` ยาวเท่าจำนวนขั้นทุกกล่อง · ราคาไม่ลดลงตามน้ำหนัก · ไม่เกิน 20 กล่อง
  - `parcelBox(lines, retailItems, cfg) → {ok:true, box, weightG, volumeCm3} | {ok:false, error, itemId?}` — error: `empty` `bad_qty` `bad_item` `missing_dims` `no_boxes` `too_big`
  - `parcelFee(lines, retailItems, cfg) → {ok:true, fee, boxPrice, shipping, total, box:{name, price, boxG}, weightG, chargeableG, step} | {ok:false, error, itemId?}` — error เพิ่ม `no_steps` `overweight` · `total = fee + boxPrice + shipping`
- Consumes: `retailItems` ของร้าน (`weightG`, `dimsCm{w,l,h}`, `id`) และ `lines = [{retailId, qty}]`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ใน `src/lib/parcelShipping.test.mjs` ให้ครอบ:
  - ปริมาตรรวม 1000 ซม.³ มีกล่อง 800 และ 1200 → เลือก 1200
  - ปริมาตรรวม 800 พอดีกับกล่อง 800 → เลือก 800
  - ปริมาตรรวมเกิน 1200 ทุกกล่อง → `{ok:false, error:'too_big'}`
  - น้ำหนักรวม + `boxG` = ขั้นพอดี → ราคาขั้นนั้น · เกินขั้นสูงสุด → `overweight`
  - `total === fee + boxPrice + shipping` ด้วยค่าที่ไม่เป็น 0 ทั้งหมด
  - สินค้าไม่มี `weightG`/`dimsCm` → `missing_dims` พร้อม `itemId`
  - `fee` ว่างหรือไม่ได้ตั้ง → 0
  - `parcelConfigError`: ขั้นซ้ำ · ขั้นไม่เรียง · ราคาไม่ลดลง · ชื่อกล่องซ้ำ · `prices` ยาวไม่เท่าขั้น → คืนข้อความไม่ว่าง
  - รูปเดิม `{boxG, volDivisor, rates}` → `cleanParcelConfig` ให้ `boxes: []`
- [ ] **Step 2: รันให้เห็นว่าล้ม** `node src/lib/parcelShipping.test.mjs` · คาด: FAIL
- [ ] **Step 3: เขียนโค้ดใน `src/lib/parcelShipping.js`** ตามสัญญาข้างบน ใช้ `PARCEL_LIMITS` เดิมเป็นฐานและเพิ่ม `boxes: 20` · `volumeCm3 = w*l*h` คำนวณตอน clean
- [ ] **Step 4: รันให้ผ่าน** `node src/lib/parcelShipping.test.mjs` · คาด: PASS ทุกเคส
- [ ] **Step 5: คอมมิต** `git add src/lib/parcelShipping.js src/lib/parcelShipping.test.mjs && git commit -m "feat(preorder): คำนวณค่าส่ง = ค่าธรรมเนียม + ค่ากล่อง + ตาราง กล่อง×น้ำหนัก"`

### Task 2: ซิงก์ schedlib และ Edge Function

**Files:**
- Modify: `scripts/sync-schedlib.mjs` (ไม่ต้องเพิ่มไฟล์ใหม่ เพราะ `parcelShipping.js` อยู่ในรายการแล้ว · ตรวจเท่านั้น)
- Modify: `supabase/functions/_shared/schedlib/` (ผลจากการซิงก์ · อย่าแก้ด้วยมือ)
- Test: `supabase/tests/functions/preorder/preorder_ship.test.ts`

**Interfaces:**
- Consumes: `parcelFee` จาก Task 1 ผ่าน `preorderPrice.js`
- Produces: ไม่มี API ใหม่

- [ ] **Step 1: เขียนเทสต์ Deno ที่ล้มเหลว** ใน `preorder_ship.test.ts`: สั่งพัสดุด้วยรูปใหม่ → `shippingFee` เท่ากับ `total` ที่คำนวณ · ส่ง `shippingFee` จาก client → ไม่มีผล
- [ ] **Step 2: รัน** `npm run test:fn` · คาด: FAIL ในเคสใหม่
- [ ] **Step 3: รัน `node scripts/sync-schedlib.mjs`** แล้วตรวจว่าไฟล์ใน `_shared/schedlib` ตรงกับ `src/lib/parcelShipping.js`
- [ ] **Step 4: ปรับ `src/lib/preorderPrice.js`** (บรรทัดที่เรียก `parcelFee`): ตั้ง `shippingFee = pf.total` และเก็บ `parcel: {box, boxPrice, shipping, fee, weightG, chargeableG}` ใน snapshot · ถ้า `pf.ok === false` ให้ `fail(...)` ด้วยข้อความไทยตาม error
- [ ] **Step 5: รันให้ผ่าน** `npm run test:fn` และ `node src/lib/preorderPrice.test.mjs`
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): เซิร์ฟเวอร์คิดค่าส่งจากสูตรใหม่และเก็บ snapshot"`

### Task 3: หน้าตั้งค่าร้าน (ManageShop)

**Files:**
- Modify: `src/views/manage/ManageShop.vue` (บล็อกพัสดุ บรรทัดประมาณ 250–270 และ `cloneParcel`/บันทึกบรรทัด 96–101 · แทนช่อง `boxG`, `volDivisor`, `rates` เดิม)
- Modify: `src/data/store.js` (`saveShopSettings` ~บรรทัด 1807 · เก็บ `db.shop.parcel = cleanParcelConfig(d.parcel)` เมื่อมี `d.parcel`)
- Test: `e2e/settingsRisk.e2e.mjs` หรือไฟล์ e2e ตั้งค่าที่มีอยู่ (ตรวจว่าชื่อไฟล์ก่อนแก้) และ `src/lib/parcelShipping.test.mjs`

**Interfaces:**
- Consumes: `cleanParcelConfig`, `parcelConfigError`, `DEFAULT_PARCEL` จาก Task 1
- Produces: `db.shop.parcel` รูปใหม่ตาม Task 1

- [ ] **Step 1: เขียนเทสต์ e2e ที่ล้มเหลว**: เปิดหน้าตั้งค่า → กรอกค่าธรรมเนียม 10 · เพิ่มกล่อง "S" 20×20×20 น้ำหนักกล่อง 100 ราคา 15 · ตั้งขั้น 1000 กรัม ราคา 50 → บันทึก → โหลดใหม่แล้วค่าอยู่ครบ · กรอกขั้นไม่เรียง → เห็นข้อความผิดและไม่บันทึก
- [ ] **Step 2: รัน e2e ที่เกี่ยวข้อง** · คาด: FAIL
- [ ] **Step 3: แก้ ManageShop.vue**: ช่องค่าธรรมเนียม · ตารางกล่อง (ชื่อ, กว้าง, ยาว, สูง, น้ำหนักกล่อง, ราคากล่อง; เพิ่ม/ลบแถว แบบ `payment.accounts`) · ตารางอัตรา: หัวคอลัมน์ = ขั้นน้ำหนักสูงสุด (กรัม) แถว = กล่อง ช่องเป็นราคา · ตรวจด้วย `parcelConfigError` ก่อนบันทึก
- [ ] **Step 4: แก้ `saveShopSettings`** ให้เก็บ `parcel` ที่ผ่าน `cleanParcelConfig` (ไม่ import lib ใน store ถ้าทำได้โดยรับค่าที่คลีนแล้วจากหน้า)
- [ ] **Step 5: รัน e2e และ** `npm test` · คาด: PASS
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): หน้าตั้งค่าค่าส่ง กล่อง และตาราง กล่อง×น้ำหนัก"`

### Task 4: หน้าลูกค้าแสดงบรรทัดเดียว "ค่าส่ง"

**Files:**
- Modify: `src/views/StorePreorder.vue` (แสดงค่าส่งเป็น "ค่าส่ง X บาท" บรรทัดเดียว ไม่แสดงกล่องหรือน้ำหนัก)
- Modify: `src/views/store/StorePreorderOrders.vue` (ถ้ามีการแสดงรายละเอียดค่าส่ง ให้ลบออก)
- Test: `e2e/preorderStore.supabase.e2e.mjs` (เพิ่มเช็กว่าไม่มีคำว่ากล่องหรือกรัม)

**Interfaces:**
- Consumes: `shippingFee` จาก `quote`/`create` (ผลรวม Task 2)

- [ ] **Step 1: เขียนเช็กที่ล้มเหลว** ใน e2e: หลังเลือกพัสดุ → `[data-quote]` มี "ค่าส่ง" และไม่มี "กล่อง"/"กรัม"
- [ ] **Step 2: รัน** `node e2e/preorderStore.supabase.e2e.mjs` · คาด: FAIL
- [ ] **Step 3: แก้หน้าลูกค้า** ให้แสดงเฉพาะ "ค่าส่ง"
- [ ] **Step 4: รันให้ผ่าน** และ `npm run build` แล้ว `npm run test:bundle` · ถ้าเกิน 923 KB หยุดและขออนุมัติขยายงบพร้อมตัวเลข
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): หน้าลูกค้าแสดงค่าส่งบรรทัดเดียว"`

### Task 5: ตรวจรวม

- [ ] **Step 1:** `npm test` · คาด: PASS
- [ ] **Step 2:** `npm run test:fn` · คาด: PASS
- [ ] **Step 3:** `bash supabase/tests/run.sh` (ไม่มีการเปลี่ยน SQL ในแผนนี้ แต่ต้องยังผ่าน) · คาด: exit 0
- [ ] **Step 4:** `npm run build && npm run test:bundle` · คาด: อยู่ในงบ 923 KB
- [ ] **Step 5:** CI ของ PR บนสาขา `claude/preorder-phase3` ต้องผ่านทุกงาน ก่อนไปขั้น merge (ต้องขออนุมัติ)

## ความเสี่ยงที่ต้องคุม
- ตารางไม่ครบทุกกล่อง → โครงสร้างแบบขั้นร่วมกันกันไว้โดยไม่มีช่องว่าง
- ข้อมูลเดิม `db.shop.parcel` ใช้ไม่ได้ → ร้านยังไม่เปิดขายพัสดุ จึงไม่กระทบ
- ค่าส่งที่เปลี่ยนหลังออเดอร์เกิด → snapshot ใน `punpang_preorder_orders.data`
