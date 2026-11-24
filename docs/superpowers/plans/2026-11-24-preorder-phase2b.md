# สั่งล่วงหน้า เฟส 2B: โปรและการส่งพัสดุในแคมเปญ (ฝั่งร้าน) Implementation Plan

> **For agentic workers:** Execute task-by-task (Native, inline). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ร้านตั้งส่วนลดตามยอด (ขั้นบันได) และเปิดส่งพัสดุในแคมเปญได้ โดยระบบบังคับว่าสินค้าที่เปิดส่งพัสดุต้องมีน้ำหนักและขนาดครบ ทั้งในแอปและในฐานข้อมูล

**Architecture:** ข้อมูลเพิ่มใน `data` ของแคมเปญ (`deals`, `parcel`) ไม่เพิ่มคอลัมน์ใหม่ · การตรวจทำในฟังก์ชันล้วน `preorderCampaign.js` และ `data/preorder.js` · ฐานข้อมูลขยาย guard เดิมด้วย migration ใหม่ (ไม่แก้ migration ที่ deploy แล้ว)

**Tech Stack:** Vue 3, Node `*.test.mjs`, Playwright e2e, PostgreSQL (`supabase/tests/run.sh`)

**Spec:** `docs/superpowers/specs/2026-11-24-preorder-design.md` หัวข้อ 6.1 ข้อ 1 (ส่วนลดตามยอด) และข้อ 3 (พัสดุ) · แผนรวม `/root/.claude/plans/deep-knitting-zebra.md` หัวข้อ 2B · ต่อจาก `claude/preorder-phase2a` (PR #151)

## Global Constraints
- โปรของแคมเปญรองรับเฉพาะ `kind: 'spend_off'` ที่มี `tiers: [{min, type, value}]` (ตรงกับ `posDeals` ใน `store.js` และ `applyPosPromos`)
- `type` ของขั้นเป็น `'amount'` หรือ `'percent'` · `value` > 0 · percent ≤ 100 · `min` เป็นจำนวนเต็ม ≥ 1 และไม่ซ้ำกัน
- `parcel.enabled` เป็น boolean ค่าเริ่มต้น `false`
- เปิดรับ (`status: 'open'`) ด้วย `parcel.enabled: true` ต้องมีทุกสินค้าที่มี `weightG` (จำนวนเต็ม 1–50000) และ `dimsCm` (w,l,h > 0 และ ≤ 200)
- ห้ามแก้ migration ที่ deploy แล้ว (`20261127100000`–`20261127140000`)
- ข้อความผิดพลาดเป็นภาษาไทย
- งบ bundle: ปัจจุบัน 912 KB (ใช้ไป 911.7) ถ้าเกินต้องหยุดและขออนุมัติ

## Review Focus
1. ขั้นบันไดซ้ำยอด (min เท่ากันสองขั้น) → บันทึกไม่ได้ (Task 1)
2. เปิดส่งพัสดุแต่สินค้าไม่มีน้ำหนักในฐานข้อมูล (ข้อมูลแอปกับฐานไม่ตรงกัน) → ฐานข้อมูลปฏิเสธ (Task 3)
3. ค่า `deals` เก่าที่ไม่มี (แคมเปญที่สร้างก่อนเฟส 2B) → อ่านได้เป็นอาร์เรย์ว่าง ไม่พัง (Task 1)
4. แก้ค่าโปรหรือพัสดุของแคมเปญที่เปิดรับอยู่ → ถูกล็อกเหมือนโครงสร้างเดิม (Task 2)

## File Structure
- Modify `src/lib/preorderCampaign.js` — เพิ่ม `deals`, `parcel` ใน blank/validate/แปลงแถว
- Modify `src/lib/preorderCampaign.test.mjs` — เทสต์ของโมเดลใหม่
- Modify `src/data/preorder.js` — `structOf`, ตรวจสินค้าเมื่อเปิดส่งพัสดุ
- Modify `src/data/preorder.store.test.mjs` — เทสต์ระดับ store
- Create `supabase/migrations/20261127150000_punpang_preorder_parcel_guard.sql` — guard ฝั่งฐานข้อมูล
- Modify `supabase/tests/preorder_guard.test.sql` — เคส P1–P3
- Modify `src/views/manage/ManagePreorders.vue` — ตารางขั้นส่วนลด + สวิตช์ส่งพัสดุ
- Modify `e2e/preorders.ui.e2e.mjs` — เคสหน้าตั้งแคมเปญ

---

### Task 1: โมเดลแคมเปญ (ฟังก์ชันล้วน)

**Files:** Modify `src/lib/preorderCampaign.js`, `src/lib/preorderCampaign.test.mjs`

**Interfaces:**
- Produces: `blankCampaign()` มี `deals: []`, `parcel: { enabled: false }` · `campaignError(c)` ตรวจ deals/parcel · `campaignToRow(c)`/`rowToCampaign(r)` เก็บ `data.deals` และ `data.parcel`
- ข้อความ: `'ขั้นส่วนลดต้องเป็นจำนวนเต็มบาทหรือเปอร์เซ็นต์ที่มากกว่า 0'`, `'ขั้นส่วนลดซ้ำยอดเดียวกัน'`, `'ส่วนลดเปอร์เซ็นต์ต้องไม่เกิน 100'`, `'ค่า parcel.enabled ต้องเป็น true/false'`

- [ ] **Step 1: เทสต์ที่ล้ม** — เพิ่มใน `preorderCampaign.test.mjs`: (a) `blankCampaign().deals` เท่ากับ `[]` และ `parcel.enabled` เท่ากับ `false` (b) แคมเปญที่มี `deals: [{kind:'spend_off', name:'ลด', tiers:[{min:500,type:'amount',value:50},{min:500,type:'percent',value:5}]}]` → `campaignError` คืน `ขั้นส่วนลดซ้ำยอดเดียวกัน` (c) `type:'percent', value:150` → ข้อความเปอร์เซ็นต์ (d) `value:0` หรือ `min:0` → ข้อความ 'ต้องเป็นจำนวนเต็ม...' (e) `parcel: {enabled:'yes'}` → ข้อความ parcel (f) round-trip: `rowToCampaign(campaignToRow(c))` คืน `deals` และ `parcel` เท่าเดิม (g) แถวเก่า `data` ไม่มี deals/parcel → `rowToCampaign` คืน `deals: []` และ `parcel: {enabled:false}`
- [ ] **Step 2: รันให้ล้ม** — `node src/lib/preorderCampaign.test.mjs` → FAIL
- [ ] **Step 3: แก้ `preorderCampaign.js`** — เพิ่มฟังก์ชัน `dealError(d)` (ไม่ใช่ `kind === 'spend_off'` → ข้อความ 'ดีลนี้ใช้ในแคมเปญไม่ได้'), ตรวจ tiers ตามกติกาใน Global Constraints · ใน `campaignError` เรียกหลังตรวจรายการสินค้า · `campaignToRow` ใส่ `deals`/`parcel` ใน `data` · `rowToCampaign` ใช้ค่าเริ่มต้นเมื่อไม่มี
- [ ] **Step 4: รันให้ผ่าน** — `node src/lib/preorderCampaign.test.mjs` → ALL PASS
- [ ] **Step 5: Commit** — `feat(preorder): โมเดลส่วนลดตามยอดและการส่งพัสดุของแคมเปญ`

---

### Task 2: กฎในแอป (store) — สินค้าเมื่อเปิดส่งพัสดุ และล็อกโครงสร้าง

**Files:** Modify `src/data/preorder.js`, `src/data/preorder.store.test.mjs`

**Interfaces:**
- Consumes: `hasParcelDims` (`src/lib/parcelShipping.js`), `deals`/`parcel` (Task 1)
- Produces: `structOf` รวม `deals` และ `parcel.enabled` · `itemsError(c)` คืน `'สินค้า <id> ยังไม่มีน้ำหนักหรือขนาด (ต้องกรอกในหน้าสินค้าก่อนเปิดส่งพัสดุ)'` เมื่อ `parcel.enabled` และสินค้าใดไม่ผ่าน `hasParcelDims`

- [ ] **Step 1: เทสต์ที่ล้ม** — ใน `preorder.store.test.mjs` (ตามรูปแบบเดิม): (a) สินค้า `A` ไม่มี weightG → `savePreorderCampaign({...base(), parcel:{enabled:true}})` คืน error ที่มี `ไม่มีน้ำหนัก` (b) ตั้ง `db.retailItems` ของ `A` ให้มี `weightG:800, dimsCm:{w:20,l:20,h:10}` แล้วบันทึกได้ และ `setPreorderCampaignStatus(id,'open')` ผ่าน (c) แคมเปญเปิดรับแล้วเปลี่ยน `deals` → error `ปิดรับก่อน` (d) แคมเปญเปิดรับแล้วเปลี่ยนชื่อ → ผ่าน
- [ ] **Step 2: รันให้ล้ม** — `node src/data/preorder.store.test.mjs` → FAIL ที่ (a) และ (c)
- [ ] **Step 3: แก้ `preorder.js`** — `structOf` เพิ่ม `c.deals` (แปลงเป็น JSON ของ kind/name/tiers) และ `c.parcel?.enabled === true` · `itemsError` เพิ่มการตรวจ parcel ตามข้อความด้านบน
- [ ] **Step 4: รันให้ผ่าน** — `node src/data/preorder.store.test.mjs` → ALL PASS
- [ ] **Step 5: Commit** — `feat(preorder): กฎแอปสำหรับส่งพัสดุและล็อกโปรของแคมเปญที่เปิดรับ`

---

### Task 3: guard ฐานข้อมูลสำหรับสินค้าพัสดุ

**Files:** Create `supabase/migrations/20261127150000_punpang_preorder_parcel_guard.sql` · Modify `supabase/tests/preorder_guard.test.sql`

**Interfaces:**
- Produces: ฟังก์ชัน `public.punpang_preorder_campaign_guard()` นิยามใหม่ (คัดลอกจาก `20261127130000` และเพิ่มด่าน parcel) · ข้อความ `campaign_parcel_dims: สินค้าที่เปิดส่งพัสดุต้องมีน้ำหนักและขนาดครบ`
- Consumes: `punpang_items.data` (`weightG`, `dimsCm.{w,l,h}`)

- [ ] **Step 1: เคสที่ล้ม** — เพิ่มใน `preorder_guard.test.sql` (ก่อน `rollback;`): ตั้งสินค้า `gp1` (kind retail, active, data `{}`) และ `gp2` (data `{"weightG":800,"dimsCm":{"w":20,"l":20,"h":10}}`) · P1: แคมเปญ `open` มี `parcel.enabled:true` และ items `[gp1]` → `like 'ERR:23514:campaign_parcel_dims%'` · P2: items `[gp2]` → `= 'OK'` · P3: แคมเปญ `draft` (ไม่เปิด) มี parcel.enabled และ items `[gp1]` → `= 'OK'`
- [ ] **Step 2: รันให้ล้ม** — `bash supabase/tests/run.sh` → ล้มที่ P1 (ยังไม่มี migration)
- [ ] **Step 3: เขียน migration** — คัดลอกฟังก์ชันจาก `20261127130000_punpang_preorder_guard.sql` ทั้งฟังก์ชัน เพิ่มในช่วง open-check: เมื่อ `new.data->'parcel'->>'enabled' = 'true'` ให้นับสินค้าที่ `pi.data->>'weightG'` ไม่เป็นจำนวนเต็ม 1–50000 หรือ `pi.data->'dimsCm'` ไม่ครบ w/l/h ระหว่าง >0 ถึง ≤200 → raise `campaign_parcel_dims` · `create or replace`, คง `security definer`, `set search_path = ''`, revoke จาก public/anon/authenticated, จบด้วย `select punpang_test.punpang_test_sync();`
- [ ] **Step 4: รันให้ผ่าน** — `bash supabase/tests/run.sh` ผ่านทั้งหมด รวม P1–P3 และ G1–G14
- [ ] **Step 5: Commit** — `feat(preorder): guard ฐานข้อมูลบังคับน้ำหนัก/ขนาดของสินค้าที่เปิดส่งพัสดุ`

---

### Task 4: หน้าตั้งแคมเปญ (ตารางขั้นส่วนลด + สวิตช์ส่งพัสดุ)

**Files:** Modify `src/views/manage/ManagePreorders.vue` · Modify `e2e/preorders.ui.e2e.mjs`

**Interfaces:** Consumes `blankCampaign`, `savePreorderCampaign` (Task 1–2)

- [ ] **Step 1: e2e ที่ล้ม** — เพิ่มเคสใน `e2e/preorders.ui.e2e.mjs`: เปิดฟอร์มสร้างแคมเปญ เพิ่มขั้นส่วนลด (ยอด 500 ลด 50 บาท) บันทึก → `db.preorderCampaigns` มี `deals[0].tiers` = `[{min:500,type:'amount',value:50}]` · เปิดสวิตช์ "ส่งพัสดุไปรษณีย์" แล้วบันทึกด้วยสินค้าที่ไม่มีน้ำหนัก → แสดงข้อความ `ไม่มีน้ำหนักหรือขนาด`
- [ ] **Step 2: รันให้ล้ม** — `node e2e/preorders.ui.e2e.mjs` → ล้มที่เคสใหม่
- [ ] **Step 3: แก้ Vue** — เพิ่ม `deals` ใน `form` ผ่าน `blankCampaign` · ส่วนขั้นส่วนลด: ปุ่ม "+ เพิ่มขั้น" และแถว (ยอดขั้นต่ำ, ประเภท บาท/%, ค่า) · สวิตช์ `parcel.enabled` ใช้ `AppSwitch` · `submit()` ส่ง `deals` (ดีลเดียว kind spend_off) และ `parcel` ที่ทำความสะอาดแล้ว · ไม่แก้หน้าอื่น
- [ ] **Step 4: รันให้ผ่าน** — e2e preorders 5/5 · `node src/views/pages.ssr.test.mjs` ผ่าน
- [ ] **Step 5: Commit** — `feat(preorder): ตั้งขั้นส่วนลดตามยอดและสวิตช์ส่งพัสดุในหน้าแคมเปญ`

---

### Task 5: ตรวจรวม

- [ ] `npm test` ผ่าน · `bash supabase/tests/run.sh` ผ่าน · `node e2e/preorders.ui.e2e.mjs` และ `node e2e/parcelSettings.ui.e2e.mjs` ผ่าน
- [ ] `npm run build && npm run test:bundle` — ถ้าเกินงบ 912 KB: หยุด รายงานตัวเลข และขออนุมัติขยายงบ (ห้ามแก้ `bundle-budget.mjs` เอง)
- [ ] `git push -u origin claude/preorder-phase2b` · ไม่เปิด PR จนกว่าผู้ใช้สั่ง
