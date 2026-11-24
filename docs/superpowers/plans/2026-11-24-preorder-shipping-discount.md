# ส่วนลดค่าส่งตามยอดซื้อ (สั่งล่วงหน้า) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ร้านตั้งขั้นส่วนลดค่าส่งหลายขั้นต่อแคมเปญ ลูกค้าได้ส่วนลดขั้นสูงสุดที่ยอดสินค้าหลังหักส่วนลดทุกประเภทก่อน VAT ถึง ยอดคิดที่เซิร์ฟเวอร์

**Architecture:** ฟังก์ชันล้วนใหม่ `src/lib/shipDiscount.js` (ตรวจขั้น, เลือกขั้น, คิดส่วนลด) ถูกเรียกใน `priceCampaignOrder` หลังคิดค่าส่งและคะแนนแล้ว ขั้นเก็บในฟิลด์แคมเปญ `data.shipOff` แยกจาก `deals` เพื่อไม่ให้ตัวคิดโปรสินค้าเห็น · ไม่แตะ `src/lib/pricing.js`

**Tech Stack:** JS ล้วน (node:test แบบ `node <file>.test.mjs`), Deno Edge Function (`npm run test:fn`), Vue 3 (`ManagePreorders.vue`), Playwright e2e

**Spec:** `docs/superpowers/specs/2026-11-24-preorder-shipping-discount-design.md`

## Global Constraints
- ขั้นส่วนลด: `min` เป็นจำนวนเต็มบาท ≥ 1 · `value` เป็นบาท ≥ 0 ทศนิยมไม่เกิน 2 ตำแหน่ง · ไม่เกิน 10 ขั้น · `min` เรียงขึ้นและไม่ซ้ำ (จากสเปก)
- ฐานนับขั้น = ยอดสินค้าหลังหักส่วนลดทุกประเภท ก่อนค่าส่งและก่อน VAT (จากสเปก)
- ลดได้ไม่เกินค่าส่งรวม และไม่ติดลบ · ใช้เฉพาะ `fulfillment === 'delivery'` (จากสเปก)
- งบ bundle ปัจจุบัน 925 KB (`scripts/bundle-budget.mjs`) ห้ามเกินโดยไม่ขออนุมัติ
- ยอดทั้งหมดคิดที่เซิร์ฟเวอร์ ห้ามรับส่วนลดจาก client

## ปรับจาก design (ผมเลือกเอง ต้องแจ้งผู้ใช้)
- design เขียนเก็บขั้นใน `deals` · แผนนี้เก็บใน `data.shipOff` แทน เพราะ `deals` ถูกส่งเข้า `applyPosPromos` (โปรสินค้า) ซึ่งจะเห็นและอาจนำไปคิดผิดประเภท
- ฐาน VAT ใช้ `beforeVat` ที่ `orderTotals` คิดอยู่แล้ว (ค่าส่งเป็นศูนย์ตอนนับฐาน) ไม่เขียนสูตรใหม่

## Review Focus
1. ยอดฐานพอดีขั้น (เท่ากับ `min`) → ได้ส่วนลดขั้นนั้น
2. ยอดฐานต่ำกว่าขั้นแรกทุกขั้น → ไม่ได้ส่วนลด ค่าส่งเท่าเดิม
3. ส่วนลดขั้นมากกว่าค่าส่งรวม → ลดเหลือ 0 ไม่ติดลบ
4. รับที่ร้าน → ไม่มีส่วนลดค่าส่ง แม้ยอดถึงขั้น
5. ราคารวม VAT → ฐานนับถอด VAT ออกก่อนเทียบขั้น

---

### Task 1: ฟังก์ชันล้วนของส่วนลดค่าส่ง

**Files:**
- Create: `src/lib/shipDiscount.js`
- Test: `src/lib/shipDiscount.test.mjs`

**Interfaces:**
- Produces:
  - `cleanShipOff(raw) → [{min:number, value:number}]` — ตัดแถวที่ผิดรูปแบบ, เรียงตาม `min`, ตัดให้เหลือ ≤ 10 แถว
  - `shipOffError(raw) → string` ('' = ผ่าน) — ตรวจกติกาในหัวข้อ Global Constraints ด้วยข้อความไทย
  - `shipOffDiscount({ goodsExVat, shippingFee, tiers }) → { tier: number | null, amount: number }` — `tier` คือ `min` ของขั้นที่ใช้ (ขั้นสูงสุดที่ `goodsExVat ≥ min`), `amount = min(value, shippingFee)` ปัดสตางค์, ไม่มีขั้นที่ถึง → `{tier: null, amount: 0}`
- Consumes: ไม่มี

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ใน `src/lib/shipDiscount.test.mjs` ให้ครอบ:
  - tiers `[{min:300,value:20},{min:1000,value:50}]`, ฐาน 299.99 → `{tier:null, amount:0}`
  - ฐาน 300 พอดี → `{tier:300, amount:20}`
  - ฐาน 1500 → `{tier:1000, amount:50}` (ขั้นสูงสุด ไม่สะสม)
  - ค่าส่ง 30 และส่วนลดขั้นนั้น 50 → `amount: 30`
  - `cleanShipOff` ตัดแถว `min` เป็น 0 และ `value` ติดลบ และเรียงแถวที่เหลือ
  - `shipOffError`: `min` ซ้ำ → ไม่ว่าง · `min` ไม่เรียง → ไม่ว่าง · `value` ติดลบ → ไม่ว่าง · 11 ขั้น → ไม่ว่าง · ว่างทั้งหมด → `''`
- [ ] **Step 2: รันให้ล้ม** `node src/lib/shipDiscount.test.mjs` · คาด: FAIL (module not found)
- [ ] **Step 3: เขียน `src/lib/shipDiscount.js`** ตามสัญญาข้างบน ใช้ `Math.round(x * 100) / 100` ปัดสตางค์
- [ ] **Step 4: รันให้ผ่าน** `node src/lib/shipDiscount.test.mjs` · คาด: ผ่านทุกเคส
- [ ] **Step 5: เพิ่มไฟล์ใน schedlib** เพิ่ม `'shipDiscount.js'` ในรายการ `SCHEDLIB_FILES` ของ `scripts/sync-schedlib.mjs` แล้วรัน `node scripts/sync-schedlib.mjs`
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): ฟังก์ชันคิดส่วนลดค่าส่งตามขั้นยอด"`

### Task 2: ตัวคิดราคาสั่งล่วงหน้าใช้ส่วนลดค่าส่ง

**Files:**
- Modify: `src/lib/preorderPrice.js` (หลังบรรทัดที่คิด `shippingFee` และ `pointsUsed` · ก่อนสร้าง `order`)
- Test: `src/lib/preorderPrice.test.mjs`

**Interfaces:**
- Consumes: `shipOffDiscount` จาก Task 1 · `orderTotals` จาก `pricing.js` (มีอยู่แล้ว)
- Produces: `priceCampaignOrder` คืน `snapshot.shipDiscount = {tier, amount}` และ `order.shippingFee` เป็นค่าหลังลด · `campaign.shipOff` เป็นอินพุตใหม่ (แถว `{min,value}`)

การคิด (ทำตามลำดับนี้):
1. คำนวณ `goodsExVat` = `orderTotals({ ...order, shippingFee: 0 }).beforeVat` (ยอดสินค้าหลังหักทุกประเภทและคะแนน ก่อน VAT)
2. `const d = shipOffDiscount({ goodsExVat, shippingFee, tiers: cleanShipOff(campaign.shipOff) })` ถ้า `fulfillment !== 'delivery'` ให้ใช้ `{tier:null, amount:0}`
3. `order.shippingFee = shippingFee - d.amount` · `snapshot.shipDiscount = { tier: d.tier, amount: d.amount }`

- [ ] **Step 1: เขียนเทสต์ที่ล้มเหลว** ใน `preorderPrice.test.mjs` (ใช้ `campaign({ shipOff: [...] , parcel: {enabled:true} })` และ `parcelCat()` ที่มีอยู่):
  - สินค้าราคาถึงขั้น 300 ส่งพัสดุ → `snapshot.shipDiscount.amount === 20` และ `order.shippingFee` = ค่าส่งเดิม − 20
  - สินค้าต่ำกว่าขั้นแรก → `snapshot.shipDiscount.amount === 0` และค่าส่งเท่าเดิม
  - รับที่ร้าน ยอดถึงขั้น → `amount === 0`
  - ใช้คะแนนจนยอดต่ำกว่าขั้น → `amount === 0` (ยืนยันว่านับหลังคะแนน)
- [ ] **Step 2: รันให้ล้ม** `node src/lib/preorderPrice.test.mjs` · คาด: FAIL ในเคสใหม่
- [ ] **Step 3: แก้ `src/lib/preorderPrice.js`** ตามลำดับ 1–3 ข้างบน · import `shipOffDiscount, cleanShipOff` จาก `./shipDiscount.js`
- [ ] **Step 4: รันให้ผ่าน** `node src/lib/preorderPrice.test.mjs` · คาด: ALL PASS
- [ ] **Step 5: ซิงก์ schedlib** `node scripts/sync-schedlib.mjs`
- [ ] **Step 6: คอมมิต** `git commit -m "feat(preorder): คิดส่วนลดค่าส่งหลังหักคะแนนก่อน VAT"`

### Task 3: ตรวจและบันทึกขั้นในแคมเปญ (แอป)

**Files:**
- Modify: `src/lib/preorderCampaign.js` (`blankCampaign` เพิ่ม `shipOff: []` · `campaignError` เรียก `shipOffError(c.shipOff)` · `campaignToRow` เก็บ `shipOff: cleanShipOff(c.shipOff)` ใน `data` · `rowToCampaign` อ่าน `shipOff: r.data?.shipOff ?? []`)
- Modify: `src/data/preorder.js` (`structOf` เพิ่ม `shipOff` ตามแพตเทิร์น `deals`)
- Test: `src/lib/preorderCampaign.test.mjs`

**Interfaces:**
- Consumes: `cleanShipOff`, `shipOffError` จาก Task 1
- Produces: แคมเปญมีฟิลด์ `shipOff: [{min, value}]` ใน `data` ของแถว `punpang_preorder_campaigns`

- [ ] **Step 1: เทสต์ที่ล้มเหลว**: round-trip `campaignToRow` → `rowToCampaign` คง `shipOff` · แถวเก่าไม่มี `shipOff` ได้ `[]` · `campaignError` คืนข้อความเมื่อขั้นไม่เรียง · `structOf` ของแคมเปญที่ต่างแค่ `shipOff` ให้โครงสร้างต่างกัน
- [ ] **Step 2: รันให้ล้ม** `node src/lib/preorderCampaign.test.mjs`
- [ ] **Step 3: แก้ไฟล์** ตามที่ระบุไว้
- [ ] **Step 4: รันให้ผ่าน** `node src/lib/preorderCampaign.test.mjs` และ `npm test`
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): บันทึกขั้นส่วนลดค่าส่งในแคมเปญ"`

### Task 4: Edge Function ส่งขั้นไปคิดราคา

**Files:**
- Modify: `supabase/functions/preorder/index.ts` (บรรทัดที่สร้าง `const campaign = {...}` ทั้งสองจุด: เพิ่ม `shipOff: c.data?.shipOff ?? []`)
- Test: `supabase/tests/functions/preorder/preorder.test.ts`

**Interfaces:**
- Consumes: `priceCampaignOrder` ที่รับ `campaign.shipOff` (Task 2)

- [ ] **Step 1: เทสต์ที่ล้มเหลว** ใน `preorder.test.ts`: เพิ่ม `shipOff: [{min: 100, value: 20}]` ให้แคมเปญ `c_parcel` ใน seed · `quote` ส่งพัสดุที่ยอดถึงขั้น → `shippingFee` เท่าค่าส่งเดิม − 20 (เดิม 85 → 65) · `quote` รับที่ร้าน → ไม่มีส่วนลด
- [ ] **Step 2: รัน** `npm run test:fn` · คาด: FAIL ในเคสใหม่
- [ ] **Step 3: แก้ `index.ts`** ทั้งสองจุด
- [ ] **Step 4: รันให้ผ่าน** `npm run test:fn` · คาด: ผ่านทั้งหมด (จำนวนเคสเพิ่มจาก 244)
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): Edge Function ส่งขั้นส่วนลดค่าส่งเข้าตัวคิดราคา"`

### Task 5: หน้าร้านตั้งขั้นส่วนลดค่าส่ง

**Files:**
- Modify: `src/views/manage/ManagePreorders.vue` (เพิ่ม ref `shipTiers` คู่กับ `tiers` · โหลดค่าที่บรรทัด ~34 จาก `base.shipOff` · บันทึกที่บรรทัด ~53 เป็น `shipOff: shipTiers.map(...)` · เพิ่มบล็อกตารางขั้นแบบเดียวกับ `tiers` (บรรทัด ~124–130) มีป้ายว่า "ส่วนลดค่าส่งเมื่อยอดถึง (บาท)")
- Test: `e2e/preorders.ui.e2e.mjs` (เพิ่มเคส)

**Interfaces:**
- Consumes: `campaignError` จาก Task 3 (ข้อความผิดแสดงตามเดิม)

- [ ] **Step 1: เคส e2e ที่ล้มเหลว**: เปิดแคมเปญ → เพิ่มขั้นส่วนลดค่าส่ง ยอด 300 ลด 20 → บันทึก → โหลดใหม่ค่าอยู่ · ยอดซ้ำ → เห็นข้อความผิด
- [ ] **Step 2: รัน** `node e2e/preorders.ui.e2e.mjs` · คาด: FAIL ในเคสใหม่
- [ ] **Step 3: แก้ `ManagePreorders.vue`** ตามที่ระบุไว้
- [ ] **Step 4: รันให้ผ่าน** `node e2e/preorders.ui.e2e.mjs` · คาด: ผ่านทุกเคส
- [ ] **Step 5: คอมมิต** `git commit -m "feat(preorder): หน้าแคมเปญตั้งขั้นส่วนลดค่าส่ง"`

### Task 6: ตรวจรวม

- [ ] **Step 1:** `npm test` · คาด: ผ่าน
- [ ] **Step 2:** `npm run test:fn` · คาด: ผ่าน
- [ ] **Step 3:** `bash supabase/tests/run.sh` · คาด: exit 0 (ไม่มีการเปลี่ยน SQL แต่ยืนยันว่า guard ของแคมเปญยังผ่าน)
- [ ] **Step 4:** `npm run build && npm run test:bundle` · คาด: อยู่ในงบ 925 KB ถ้าเกินหยุดและขออนุมัติพร้อมตัวเลข
- [ ] **Step 5:** push ขึ้น `claude/preorder-phase3` และแจ้งผลให้ผู้ใช้

## ความเสี่ยงที่ต้องคุม
- ยอดฐานไม่ตรงกับ `orderTotals` → Task 2 ใช้ `orderTotals` เดียวกันทั้งหมด ไม่เขียนสูตรใหม่
- ส่วนลดเปลี่ยนค่าส่งและ VAT → ค่าส่งหลังลดเป็นฐาน VAT ตามเดิม (เทสต์ Task 2 ตรวจยอดรวม)
- ขั้นที่แก้หลังเปิดรับแล้ว → ตัว guard เดิมเทียบ `data - 'name'` จึงล็อก `shipOff` อัตโนมัติ (ตรวจด้วย `run.sh`)
