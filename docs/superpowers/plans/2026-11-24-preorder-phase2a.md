# สั่งล่วงหน้า เฟส 2A: น้ำหนัก/ขนาดสินค้า + ตั้งค่าพัสดุ + ฟังก์ชันคิดค่าส่งล้วน Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ให้ร้านกรอกน้ำหนัก/ขนาดต่อสินค้าและตารางอัตราค่าส่งพัสดุได้ พร้อมฟังก์ชันล้วน `parcelFee` ที่แอปและ Edge Function (เฟส 2D) ใช้คิดค่าส่งชุดเดียวกัน

**Architecture:** ฟังก์ชันล้วนทั้งหมดอยู่ใน `src/lib/parcelShipping.js` (เพิ่มใน schedlib) · ข้อมูลสินค้าเก็บใน `punpang_items.data` ผ่าน `saveRetailItem` ที่ spread `...d` อยู่แล้ว (ไม่แก้ `store.js` ฝั่งสินค้า) · ตั้งค่าร้านเก็บที่ `db.shop.parcel` (kv `config/shop` ซิงก์เอง) การตรวจค่าทำใน lib แล้วเรียกจากหน้า lazy เพื่อไม่ขยาย main chunk

**Tech Stack:** Vue 3, Vite, Node `*.test.mjs` (`npm test`), Playwright e2e, schedlib (`scripts/sync-schedlib.mjs`)

**Spec:** `docs/superpowers/specs/2026-11-24-preorder-design.md` หัวข้อ 6.1 ข้อ 3 · แผนรวม `/root/.claude/plans/deep-knitting-zebra.md` หัวข้อ 2A · branch: `claude/preorder-phase2a`

## Global Constraints
- ค่าส่งคิดจากน้ำหนักรวมสินค้า + น้ำหนักกล่อง เทียบกับน้ำหนักปริมาตร (กว้าง×ยาว×สูง ÷ ตัวหาร) ใช้ค่าที่มากกว่า (สเปก 6.1 ข้อ 3)
- ตารางอัตราร้านกรอกเอง ขั้นน้ำหนักอัตราเดียวทั่วประเทศ ไม่แยกโซน ไม่ฝังอัตราไปรษณีย์
- สินค้าไม่มีน้ำหนัก/ขนาดครบ → คิดค่าส่งไม่ได้ (error) ห้ามเดา
- ห้ามแตะ main chunk เกินจำเป็น: งบ main 166 KB (ตอนนี้ ~165.7) รวม 910 KB (ตอนนี้ ~908.8) · `store.js` แก้ได้อย่างมาก 1 บรรทัด (`saveShopSettings`)
- ห้ามทำเกินขอบเขต 2A: ไม่ทำโปร/พัสดุในแคมเปญ (2B) ไม่ทำ Edge Function (2D) ไม่ทำหน้าลูกค้า (2E)
- ข้อความผิดพลาดเป็นภาษาไทย · ค่าคงที่: `weightG` 1–50000 กรัม · ด้านละ >0 ถึง 200 ซม. · `boxG` 0–50000 · `volDivisor` 1000–20000 (ตั้งต้น 5000 ซม.³/กก.) · ขั้นราคา ≤30 แถว · `upToG` 1–100000 · ราคา 0–100000 บาท

## Review Focus
1. สินค้ากรอกน้ำหนักแต่ขนาดไม่ครบ (หรือกลับกัน) → ฟอร์มแจ้งและบันทึกไม่ได้ · `parcelFee` คืน `missing_dims` พร้อม `itemId` (Task 1, 2)
2. น้ำหนักเกินขั้นสูงสุดของตาราง → `overweight` ห้ามคิดราคาขั้นสุดท้ายแทนเงียบๆ (Task 1)
3. จำนวนผิดปกติ (0, ทศนิยม, ติดลบ, ไม่ใช่ตัวเลข) และรหัสสินค้าที่ไม่มีในรายการ → `bad_qty` / `bad_item` (Task 1)
4. ร้านยังไม่เคยตั้งค่า (`db.shop.parcel` เป็น undefined เพราะ `applyValue` ลบคีย์ที่ DB ไม่มี) → ฟอร์มและ `parcelFee` ไม่พัง; ตารางว่าง = `no_rates` (Task 1, 3)
5. น้ำหนักปริมาตรมากกว่าน้ำหนักจริง, น้ำหนักตรงขอบขั้นพอดี (≤ upToG), เศษทศนิยมปัดขึ้น (Task 1)
6. บันทึกตั้งค่าร้านแล้วไม่ทับ/ลบค่าอื่นของ `db.shop` และ `parcel` ที่ผิดรูปแบบไม่ถูกเก็บ (Task 3)

## File Structure
- Create `src/lib/parcelShipping.js` — ฟังก์ชันล้วนทั้งหมด (config, ตรวจฟอร์ม, คิดน้ำหนัก/ค่าส่ง)
- Create `src/lib/parcelShipping.test.mjs`
- Modify `scripts/sync-schedlib.mjs` (`SCHEDLIB_FILES` เพิ่ม `'parcelShipping.js'`) · สร้างสำเนาอัตโนมัติ `supabase/functions/_shared/schedlib/parcelShipping.js`
- Modify `src/views/manage/ManageRetail.vue` — ช่องน้ำหนัก/ขนาด
- Modify `src/views/manage/ManageShop.vue` — บล็อกตั้งค่าพัสดุ
- Modify `src/data/store.js` — 1 บรรทัดใน `saveShopSettings` (~1856)
- Create `e2e/parcelSettings.ui.e2e.mjs` · Create `src/data/shopParcel.store.test.mjs`

---

### Task 1: ฟังก์ชันล้วน `parcelShipping.js` + schedlib

**Files:**
- Create: `src/lib/parcelShipping.js`, `src/lib/parcelShipping.test.mjs`
- Modify: `scripts/sync-schedlib.mjs` (รายการ `SCHEDLIB_FILES`)

**Interfaces (Produces — งานถัดไปและเฟส 2B/2D ใช้):**
```js
export const DEFAULT_PARCEL   // { boxG: 0, volDivisor: 5000, rates: [] }
export const PARCEL_LIMITS    // { weightG:50000, dimCm:200, boxG:50000, rateG:100000, price:100000, rows:30, divMin:1000, divMax:20000 }
export function cleanParcelConfig(raw): { boxG:number, volDivisor:number, rates:{upToG:number,price:number}[] } // รับ undefined/ค่าผิดรูป · ทิ้งแถวไม่ครบ/ผิดช่วง · ซ้ำ upToG เก็บแถวหลังสุด · เรียงน้อย→มาก · ไม่เกิน rows
export function parcelConfigError(raw): string   // '' = ผ่าน · ใช้ก่อนบันทึกในหน้าตั้งค่า (ตารางว่าง = ผ่าน)
export function parcelFormOf(item): { weightG:string, dimW:string, dimL:string, dimH:string } // item → ค่าฟอร์ม ('' เมื่อไม่มี)
export function parcelFieldsOf(form): { weightG:number|null, dimsCm:{w:number,l:number,h:number}|null }
export function parcelDimsError(form): string    // รับรูปแบบ parcelFormOf · ว่างทั้งหมด = '' · บางส่วน/นอกช่วง = ข้อความ
export function hasParcelDims(item): boolean     // item.weightG และ item.dimsCm ถูกต้องครบ (ใช้ใน 2B)
export function parcelWeight(lines, retailItems, cfg): {ok:true, weightG, boxG, volumetricG, chargeableG} | {ok:false, error, itemId?}
export function parcelFee(lines, retailItems, cfg): {ok:true, fee, detail:{weightG,boxG,volumetricG,chargeableG,tierUpToG,tierPrice}} | {ok:false, error, itemId?}
// lines = [{retailId, qty}] · retailItems = [{id, weightG, dimsCm:{w,l,h}}] · error ∈ 'empty'|'bad_qty'|'bad_item'|'missing_dims'|'no_rates'|'overweight'
```
สูตร: `actual = Σ(qty×weightG) + boxG` · `volumetricG = Σ(qty×w×l×h) ÷ volDivisor × 1000` · `chargeableG = ceil(max(actual, volumetricG))` · ขั้น = แถวแรกที่ `chargeableG ≤ upToG` · `qty` ต้องเป็นจำนวนเต็ม 1–10000 · รวมแถวซ้ำ `retailId` ได้โดยบวกจำนวน

ข้อความ (ใช้ตรงๆ ในเทสต์ด้วย regex): `parcelDimsError` → `/ให้ครบ หรือเว้นว่างทั้งหมด/`, `/น้ำหนักต้องเป็นจำนวนเต็มกรัม 1–50000/`, `/ขนาดแต่ละด้านต้องมากกว่า 0 และไม่เกิน 200 ซม\./` · `parcelConfigError` → `/น้ำหนักกล่องต้องเป็นจำนวนเต็มกรัม 0–50000/`, `/ตัวหารปริมาตรต้องเป็นจำนวนเต็ม 1000–20000/`, `/ขั้นที่ \d+: กรอกน้ำหนักสูงสุด \(กรัม\) และราคาให้ครบ/`, `/น้ำหนักของขั้นซ้ำกัน/`, `/ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น/`, `/ตั้งได้ไม่เกิน 30 ขั้น/`

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — `src/lib/parcelShipping.test.mjs` (รูปแบบเดียวกับ `docNoPre.test.mjs`: ตัวช่วย `t(name, fn)`, `console.log('ALL PASS')`, `process.exit`) ใช้ชุดค่าตั้งต้น `cfg = { boxG: 100, volDivisor: 5000, rates: [{upToG:500,price:40},{upToG:1000,price:60},{upToG:2000,price:90}] }` และสินค้า `A{800g, 20×20×10}` `B{200g, 30×30×20}` `C{100g, 20×20×20}` `D{900g, 5×5×5}` `E{901g, 5×5×5}` ครอบทุกกรณีนี้ (assert ค่าตัวเลขตามนี้):
  - `1×A` → actual 900, volumetric 800, chargeable 900, fee 60 · `2×A` → chargeable 1700, fee 90
  - `1×B` → volumetric 3600 มากกว่าจริง 300 → `{ok:false,error:'overweight'}` · `1×C` → volumetric 1600 ชนะ (actual 200) chargeable 1600 fee 90
  - ขอบขั้น: `1×D` → 1000 พอดี fee 60 · `1×E` → 1001 fee 90 · เศษปัดขึ้น: ขนาด `20×20×10.002` ให้ volumetric 800.16 → chargeable ปัดขึ้นเป็นจำนวนเต็ม (assert `Number.isInteger` และ ≥ 801 เมื่อ actual น้อยกว่า)
  - `lines` ว่าง → `empty` · `qty` 0 / 1.5 / -1 / '2' / 10001 → `bad_qty` · `retailId` ไม่อยู่ในรายการ → `bad_item` · สินค้าไม่มี `weightG` หรือ `dimsCm` → `missing_dims` พร้อม `itemId` · `cfg` undefined หรือ `rates: []` → `no_rates` (ไม่ throw) · แถวซ้ำ `A` สองแถว (1+1) = `2×A`
  - `cleanParcelConfig(undefined)` เท่ากับ `DEFAULT_PARCEL` · ทิ้งแถว `{upToG:0}`, `{upToG:500}` (ไม่มีราคา), `{upToG:'x',price:1}` · เรียงขั้น · ซ้ำ `upToG` เก็บแถวหลัง · ตัดเหลือ 30 แถว · `volDivisor` นอกช่วงกลับเป็น 5000
  - `parcelConfigError`: undefined → `''` · rates ว่าง → `''` · แถวไม่ครบ/ซ้ำ/ราคาลดลง/เกิน 30 แถว/boxG ติดลบ/volDivisor 500 → ข้อความตามรายการด้านบน
  - `parcelDimsError`: ฟอร์มว่างทั้งหมด → `''` · น้ำหนักอย่างเดียว → "ให้ครบ" · น้ำหนัก 0, '1.5', '-3', 'abc', 50001 → ข้อความน้ำหนัก · ด้านใด 0 / 201 → ข้อความขนาด · ครบถูกต้อง → `''`
  - `parcelFieldsOf`: ว่างทั้งหมด → `{weightG:null, dimsCm:null}` · ครบ → `{weightG:800, dimsCm:{w:20,l:20,h:10}}` (แปลงสตริงเป็นเลข) · `parcelFormOf` กลับด้านได้ (round-trip) และ item ไม่มีฟิลด์ → ทุกค่า `''`
  - `hasParcelDims`: ครบ → true · ขาดอย่างใด/ค่า 0/ผิดช่วง → false
- [ ] **Step 2: รันให้ล้ม** — `node src/lib/parcelShipping.test.mjs` → ล้ม (ไม่พบโมดูล)
- [ ] **Step 3: เขียน `src/lib/parcelShipping.js`** ตาม Interfaces ด้านบน ใช้รูปแบบ `num()` / `clamp` เดียวกับ `delivery.js` (`cleanDeliveryConfig`) · ไม่ import อะไร (ล้วน) · ตัวเลขในสำเนาเซิร์ฟเวอร์ต้องไม่ใช้ API ของเบราว์เซอร์
- [ ] **Step 4: รันให้ผ่าน** — `node src/lib/parcelShipping.test.mjs` → `ALL PASS`
- [ ] **Step 5: เพิ่มลง schedlib** — เพิ่ม `'parcelShipping.js'` ในกลุ่มที่เกี่ยวกับราคา/จัดส่ง (ถัดจาก `'delivery.js'`) ของ `SCHEDLIB_FILES` แล้ว `node scripts/sync-schedlib.mjs` → `node src/lib/schedlibSync.test.mjs` ผ่าน
- [ ] **Step 6: Commit** — `git add src/lib/parcelShipping.js src/lib/parcelShipping.test.mjs scripts/sync-schedlib.mjs supabase/functions/_shared/schedlib/parcelShipping.js && git commit -m "feat(preorder): ฟังก์ชันคิดค่าส่งพัสดุจากน้ำหนัก/ขนาด (parcelShipping)"`

---

### Task 2: ฟอร์มสินค้า — น้ำหนักและขนาด

**Files:**
- Modify: `src/views/manage/ManageRetail.vue` (`blank()` บรรทัด 26, `edit()` 30-33, `save()` 35-43, แถว "ราคา/สต็อก" ~218-222)
- Test: `e2e/parcelSettings.ui.e2e.mjs` (เริ่มไฟล์ที่นี่ Task 3 ต่อ)

**Interfaces:**
- Consumes: `parcelFormOf`, `parcelFieldsOf`, `parcelDimsError` (Task 1)
- Produces: สินค้าที่บันทึกมี `weightG: number|null` และ `dimsCm: {w,l,h}|null` ที่ `db.retailItems[]` (ไปกับ `punpang_items.data` อัตโนมัติผ่าน `itemToRows` `...rest`; `loadCatalog` ส่งให้เซิร์ฟเวอร์เอง)

- [ ] **Step 1: เขียน e2e ที่ล้ม** — `e2e/parcelSettings.ui.e2e.mjs` ตามโครง `e2e/preorders.ui.e2e.mjs` (vite `createServer`, `chromium.launch` ปิด sandbox เมื่อเป็น root, `t(name, fn)`, สรุป "รวม N กรณี") เปิด `/#/admin/settings/retail` กรณี: (a) กรอกน้ำหนักอย่างเดียวแล้วบันทึก → เห็นข้อความ "ให้ครบ หรือเว้นว่างทั้งหมด" และสินค้าไม่ถูกสร้าง (b) กรอกน้ำหนัก 800 + ขนาด 20/20/10 บันทึกได้ → `db.retailItems` มีสินค้านั้นพร้อม `weightG === 800` และ `dimsCm` เท่ากับ `{w:20,l:20,h:10}` (c) แก้สินค้านั้นเปิดฟอร์มอีกครั้ง ช่องแสดง 800/20/20/10 (d) สินค้าที่ไม่กรอกทั้งหมดบันทึกได้และ `weightG === null`, `dimsCm === null` · label ช่อง: `น้ำหนัก (กรัม)`, `กว้าง (ซม.)`, `ยาว (ซม.)`, `สูง (ซม.)`
- [ ] **Step 2: รันให้ล้ม** — `node e2e/parcelSettings.ui.e2e.mjs` → ล้ม (ไม่พบช่อง)
- [ ] **Step 3: แก้ `ManageRetail.vue`** — `blank()` เพิ่ม `weightG:'', dimW:'', dimL:'', dimH:''` · `edit(x)` ใส่ `...parcelFormOf(x)` ในออบเจกต์ที่ merge · `save()` เรียก `parcelDimsError(form)` ก่อน `confirmDeactivate` (ข้อความขึ้น `error`) แล้วบันทึกด้วย `saveRetailItem({ ...rest, ...parcelFieldsOf(form) })` โดย `rest` คือ `form` ที่ตัด `dimW/dimL/dimH` ออก · เทมเพลต: บล็อกใหม่ใต้แถวราคา/สต็อก (หัวข้อ "สำหรับส่งพัสดุ (ไม่บังคับ)" + `MoneyInput` หรือ `input v-num` 4 ช่อง กริด 2 คอลัมน์ + ข้อความช่วยว่า เว้นว่างทั้งหมด = ใช้ในแคมเปญส่งพัสดุไม่ได้) · **ไม่แก้ `store.js` ส่วนสินค้า** (`saveRetailItem` spread `...d` อยู่แล้ว)
- [ ] **Step 4: รันให้ผ่าน** — `node e2e/parcelSettings.ui.e2e.mjs` → ผ่าน · `node src/views/pages.ssr.test.mjs` ผ่าน
- [ ] **Step 5: Commit** — `git commit -m "feat(preorder): ช่องน้ำหนัก/ขนาดสินค้าในหน้าสินค้า POS"`

---

### Task 3: หน้าตั้งค่าร้าน — ตารางอัตราค่าส่งพัสดุ

**Files:**
- Modify: `src/views/manage/ManageShop.vue` (import ~10, `st` บรรทัด 27, `save()` ~61-88, บล็อกใหม่ถัดจาก "ค่าจัดส่งจากระยะทาง" ~225-237)
- Modify: `src/data/store.js` (~1856)
- Test: `src/data/shopParcel.store.test.mjs`, ต่อ `e2e/parcelSettings.ui.e2e.mjs`

**Interfaces:**
- Consumes: `DEFAULT_PARCEL`, `cleanParcelConfig`, `parcelConfigError` (Task 1)
- Produces: `db.shop.parcel = { boxG, volDivisor, rates[] }` (ผ่านการ clean แล้ว) ที่ kv `config/shop` → `loadCatalog().shop.parcel` ฝั่งเซิร์ฟเวอร์ (ไม่ต้องแก้ `catalog.ts`) · ไม่เพิ่ม `parcel` ใน `SHOP_FIELDS` ของ `publicData.js` (ไม่เปิดสาธารณะ)

- [ ] **Step 1: เขียนเทสต์ store ที่ล้ม** — `src/data/shopParcel.store.test.mjs` (ตามโครง `preorder.store.test.mjs`: Vite SSR `ssrLoadModule('/src/data/store.js')`, `session.role='admin'`, รันเคสใน try ก่อน `server.close()`) กรณี: (a) `saveShopSettings({ ...db.shop, parcel })` ด้วย `parcel` ที่ถูกต้อง → `db.shop.parcel` เท่ากับค่าที่ส่ง (b) เรียกโดยไม่มี `parcel` → ค่าเดิมคงอยู่ และฟิลด์อื่นของ `db.shop` (เช่น `open`, `close`, `delivery`) ไม่เปลี่ยน (c) `db.shop.parcel === undefined` ก่อนบันทึก (ร้านเดิม) → ไม่ throw
- [ ] **Step 2: รันให้ล้ม** — `node src/data/shopParcel.store.test.mjs` → ล้มที่ (a)
- [ ] **Step 3: แก้ `store.js`** — ใน `saveShopSettings` ถัดจากบรรทัด `if (d.delivery) db.shop.delivery = cleanDeliveryConfig(d.delivery)` เพิ่ม `if (d.parcel) db.shop.parcel = d.parcel` (ไม่ import lib ใน store; การ clean ทำในหน้า) → รันเทสต์ผ่าน
- [ ] **Step 4: เขียน e2e ที่ล้ม** (ต่อไฟล์เดิม) เปิด `/#/admin/settings/shop` กรณี: (a) ร้านที่ยังไม่มี `parcel` เปิดหน้าได้ ไม่มี pageerror และเห็นบล็อก "ค่าส่งพัสดุไปรษณีย์" ช่อง `น้ำหนักกล่องเปล่า (กรัม)`, `ตัวหารน้ำหนักปริมาตร` (ค่าเริ่ม 5000) (b) เพิ่ม 3 ขั้น (500/40, 1000/60, 2000/90) บันทึก → `db.shop.parcel.rates` เท่ากับที่กรอก และเรียงน้อย→มาก (c) ขั้นซ้ำน้ำหนัก → ข้อความ "น้ำหนักของขั้นซ้ำกัน" และ `db.shop.parcel` ไม่เปลี่ยน (d) ราคาลดลง → "ราคาต้องไม่ลดลงเมื่อน้ำหนักมากขึ้น" (e) ตัวอย่างคำนวณบนหน้า: สินค้าตัวอย่างกรอกในหน้า (หรือเลือกสินค้าที่มีน้ำหนัก) แสดงค่าส่งตัวอย่างที่ตรงกับ `parcelFee` (ถ้าไม่มีสินค้าที่มีน้ำหนักให้แสดงข้อความ "ยังไม่มีสินค้าที่กรอกน้ำหนัก/ขนาด") · ไม่มี pageerror ทุกกรณี
- [ ] **Step 5: รันให้ล้ม** — `node e2e/parcelSettings.ui.e2e.mjs` → ล้มกรณี Task 3
- [ ] **Step 6: แก้ `ManageShop.vue`** — import `DEFAULT_PARCEL, cleanParcelConfig, parcelConfigError, parcelFee` จาก `../../lib/parcelShipping` · `st` เพิ่ม `parcel: cloneParcel(db.shop.parcel)` โดย `cloneParcel = (p) => ({ ...DEFAULT_PARCEL, ...p, rates: (p?.rates || []).map((r) => ({ ...r })) })` (รับ undefined) และ `Object.assign(st, …)` หลังบันทึกเติม `parcel: cloneParcel(db.shop.parcel)` · `save()`: `const pe = parcelConfigError(st.parcel); if (pe) return (error.value = pe)` ก่อนบันทึก แล้วเรียก `saveShopSettings({ ...st, parcel: cleanParcelConfig(st.parcel) })` แทน `saveShopSettings(st)` · เทมเพลต: บล็อกใหม่หลัง "ค่าจัดส่งจากระยะทาง": `MoneyInput`/`input v-num` สำหรับ `boxG` และ `volDivisor`, ตารางแถว `upToG`/`price` เพิ่ม/ลบ (รูปแบบเดียวกับ `payment.accounts` + `btn-danger` ไอคอน trash) ตัวอย่างค่าส่งจากสินค้าตัวแรกที่ `hasParcelDims` (`parcelFee([{retailId, qty:1}], db.retailItems, cleanParcelConfig(st.parcel))`) พร้อมข้อความเมื่อไม่มี/คิดไม่ได้ (map `error` เป็นภาษาไทย: `no_rates` "ยังไม่ได้ตั้งตารางอัตรา", `overweight` "น้ำหนักเกินขั้นสูงสุดของตาราง")
- [ ] **Step 7: รันให้ผ่าน** — `node e2e/parcelSettings.ui.e2e.mjs` ทุกกรณีผ่าน · `node src/data/shopParcel.store.test.mjs` ผ่าน
- [ ] **Step 8: Commit** — `git commit -m "feat(preorder): ตั้งค่าอัตราค่าส่งพัสดุไปรษณีย์ในหน้าตั้งค่าร้าน"`

---

### Task 4: ตรวจรวมและส่งขึ้น branch

**Files:** `scripts/bundle-budget.mjs` (แก้เฉพาะถ้าเกินงบ — ต้องถามผู้ใช้ก่อน)

- [ ] **Step 1:** `npm test` ผ่านทั้งหมด (รวม `parcelShipping.test.mjs`, `shopParcel.store.test.mjs`, `schedlibSync`, `pages.ssr`)
- [ ] **Step 2:** `node e2e/parcelSettings.ui.e2e.mjs` และ e2e เดิมที่แตะหน้าเดียวกัน (`node e2e/settingsRisk.ui.e2e.mjs`, `node e2e/retailCategoryPicker.ui.e2e.mjs`, `node e2e/preorders.ui.e2e.mjs`) ผ่าน
- [ ] **Step 3:** `npm run build && npm run test:bundle` — ต้อง "อยู่ในงบทุกรายการ" · ถ้าเกิน: หยุด รายงานตัวเลขและขออนุมัติขยายงบ (ห้ามแก้ `bundle-budget.mjs` เอง) · คาด: main ไม่เกิน +0.1 KB, chunk หน้าสินค้า/ตั้งค่าร้านโตเล็กน้อย
- [ ] **Step 4:** `bash supabase/tests/run.sh` ผ่าน (ไม่มี migration ใหม่ใน 2A แต่ยืนยันว่าไม่กระทบ) 
- [ ] **Step 5:** `git push -u origin claude/preorder-phase2a` · ไม่เปิด PR จนกว่าผู้ใช้สั่ง · หลัง merge: **ไม่มีอะไรต้อง deploy ฝั่งฐานข้อมูล/ฟังก์ชันในเฟสนี้** (ขึ้นเว็บอัตโนมัติ; สำเนา schedlib จะถูกใช้เมื่อ deploy ฟังก์ชันในเฟส 2D)

## Self-Review (สเปก → งาน)
- สเปก 6.1 ข้อ 3: ฟิลด์น้ำหนัก/ขนาด → Task 2 · ค่าตั้งร้าน (กล่อง ตัวหาร ตาราง) → Task 3 · ฟังก์ชันล้วน + schedlib → Task 1 · คิดค่ามากกว่าระหว่างจริง/ปริมาตร → Task 1 สูตร · สินค้าไม่มีข้อมูลคิดไม่ได้ → `missing_dims` · เซิร์ฟเวอร์ห้ามรับค่าส่งจาก client/snapshot/จังหวัด/สินค้าไม่มีน้ำหนักเลือกเข้าแคมเปญไม่ได้ → เป็นงาน 2B/2D (นอกขอบเขต 2A ตั้งใจ)
- ชื่อ/ลายเซ็นสอดคล้องกันทุก Task (`parcelFormOf/parcelFieldsOf/parcelDimsError/parcelConfigError/cleanParcelConfig/parcelFee/hasParcelDims/DEFAULT_PARCEL`)
