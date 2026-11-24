# Preorder เฟส 1 (ฐานและโควตา) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** วางฐานข้อมูล (แคมเปญ ออร์เดอร์ ช่องโควตา) + RPC จอง/ปล่อยโควตาแบบ atomic + หน้าตั้งแคมเปญฝั่งร้าน ให้ร้านตั้งและเปิดแคมเปญได้ (ยังไม่มีการสั่งของลูกค้า)

**Architecture:** ตารางแยก `punpang_preorder_*` (จัดเป็น iso ในโหมดทดสอบ) ซิงก์เข้าแอปแบบเดียวกับ `punpang_shifts` (`startSync`, โหลดแบบ lazy ตามกลุ่มข้อมูล `preorders`) ตรรกะตรวจ/คำนวณแคมเปญเป็นฟังก์ชันล้วนใน `src/lib/preorderCampaign.js` ส่วนโค้ดที่ใช้บันทึกอยู่ใน `src/data/preorder.js` (store.js ไม่ import ไฟล์นี้ เหมือน `acct.js`) เพื่อไม่ให้ main chunk โต โควตาทำใน SQL ด้วย `select ... for update` ไม่ใช้การนับแล้วค่อย insert

**Tech Stack:** Vue 3, Supabase/Postgres (migration + RLS + security definer RPC), Node test (`*.test.mjs`), SQL test (`supabase/tests/*.test.sql` ผ่าน `run.sh`), Playwright e2e

**Spec:** `docs/superpowers/specs/2026-11-24-preorder-design.md` (หัวข้อ 2, 3, 6, 7.1, 8, 9)

## Global Constraints
- ชื่อโมดูลใช้ `preorder` เท่านั้น (ห้ามใช้ "campaign" เป็นชื่อไฟล์/ตัวแปรระดับโมดูล เพราะชนกับประกาศ/โฆษณาเดิม) · ตาราง `punpang_preorder_campaigns`, `punpang_preorder_orders`, `punpang_preorder_slots` · สิทธิ์ใหม่ `managePreorder` (ค่าตั้งต้น `admin`)
- มัดจำขั้นต่ำตั้งต้น **50** (ช่วง 1–100) · เวลากำหนดจ่ายมัดจำ `payDueMin` **ไม่มีค่าตั้งต้น ต้องกรอกทุกแคมเปญ** (DB บังคับ `not null` และ `> 0`) · โควตา: เพดานต่อสินค้าต่อวันรับและเพดานรวมต่อวัน เป็นตัวเลขแยกกัน ตั้งหรือไม่ตั้งก็ได้ (`null` = ไม่จำกัด)
- เลขที่ออร์เดอร์ preorder `PRE-ddmmyy-xxxxxx` (6 หลักท้าย) · RPC โควตาเรียกได้เฉพาะ `service_role` (revoke จาก `public, anon, authenticated`) และต้อง `security definer set search_path = ''`
- ห้ามแตะเส้นทาง POS/ออร์เดอร์ปกติ · ห้ามเพิ่ม import แบบ static จาก `src/data/store.js` ไปยัง lib/ไฟล์ preorder (ยกเว้นค่าตั้งต้น `db.preorderCampaigns: []`) · งบ bundle: รวม 904 KB, ไฟล์เดียว 166 KB (gzip) — ถ้าเกินให้หยุดถามผู้ใช้ก่อนขอขยาย
- Migration: ชื่อ `YYYYMMDDHHMMSS_punpang_<ชื่อ>.sql` เลขเวอร์ชันห้ามซ้ำ รันซ้ำได้ (`if not exists`, `drop policy if exists`) ความเห็นหัวไฟล์ภาษาไทย ท้ายไฟล์ที่แตะ schema ต้อง `select punpang_test.punpang_test_sync();` ห้ามรันบน production (รันผ่าน workflow Release ตอน deploy เท่านั้น)
- เทสต์ DB ใหม่ต้องเพิ่มบล็อกใน `supabase/tests/run.sh` ก่อนบล็อก mirror เสมอ · ห้ามคัดลอกบล็อก `no_points` ที่ไม่เก็บ exit code
- Branch: `claude/preorder-phase1` แตกจาก `claude/preorder-design` · commit ท้ายข้อความมี `Claude-Session: https://claude.ai/code/session_01WJf4wweLeZzN4N72FvB7RW` (ไม่ใส่ชื่อโมเดล)
- ถ้าเครื่องไม่มี `psql`/Postgres ให้รันเทสต์ DB ผ่าน CI (job `database`) แทน และบอกผู้ใช้ตามจริงว่าไม่ได้รันในเครื่อง

## Review Focus
1. จองหลายรายการพร้อมกัน แล้วสินค้าหนึ่งเต็ม → ต้องล้มทั้งคำขอ ไม่มีการจองบางรายการค้างไว้ (Task 3)
2. `qty` เป็น 0, ติดลบ, ทศนิยม หรือ `itemId` ซ้ำในคำขอเดียว → ปฏิเสธ/รวมให้ถูก ไม่ทำให้ตัวนับเพี้ยน (Task 3)
3. ปล่อยโควตามากกว่าที่จองไว้ (เช่น ปล่อยซ้ำ) → ตัวนับไม่ต่ำกว่า 0 (Task 3)
4. ช่วงวันรับข้ามเดือน/ข้ามปี และแคมเปญวันเดียว (`pickupFrom = pickupTo`) → `pickupDays` ถูกต้อง (Task 1)
5. พนักงานที่ไม่มี `managePreorder`/`manage` และผู้ใช้ anon อ่าน/เขียนตาราง preorder ไม่ได้ (Task 2)

---

### Task 1: ฟังก์ชันล้วนของแคมเปญ

**Files:**
- Create: `src/lib/preorderCampaign.js`
- Test: `src/lib/preorderCampaign.test.mjs` (รูปแบบเดียวกับ `src/lib/orderCap.test.mjs`: ตัวช่วย `t(name, fn)` + `process.exit(fail ? 1 : 0)`)

**Interfaces:**
- Produces (Campaign = `{ id, name, status, orderFrom, orderTo, pickupFrom, pickupTo, depositPercent, payDueMin, dayCap, items: [{ retailId, dayCap }] }` วันที่เป็น `'YYYY-MM-DD'`, `dayCap`/`items[].dayCap` เป็น `null` หรือจำนวนเต็ม ≥ 0):
  - `export const CAMPAIGN_STATUS = ['draft', 'open', 'closed']`
  - `export function blankCampaign(): Campaign` — `status:'draft'`, `depositPercent:50`, `payDueMin:null`, `dayCap:null`, `items:[]`, วันที่เป็น `''`
  - `export function campaignError(c: Campaign): string` — `''` เมื่อผ่าน
  - `export function pickupDays(c: Campaign): string[]` — รายการวันรับรวมต้นปลาย เรียงจากน้อยไปมาก `[]` ถ้าช่วงไม่ถูกต้อง
  - `export function campaignPhase(c: Campaign, today: string): 'draft' | 'closed' | 'upcoming' | 'open' | 'ended'` — `draft`/`closed` ตาม status; ถ้า `open`: `today < orderFrom` → `upcoming`, `orderFrom ≤ today ≤ orderTo` → `open`, เกิน → `ended`
  - `export function campaignToRow(c: Campaign): Row` และ `export function rowToCampaign(r: Row): Campaign` โดย `Row = { id, status, order_from, order_to, pickup_from, pickup_to, deposit_percent, pay_due_min, data: { name, dayCap, items } }` (ไม่ผูกกับ tableSync เพื่อให้เป็น pure)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — ชื่อเทสต์และ assertion (ค่าจากสเปก):
  - `blankCampaign: มัดจำตั้งต้น 50 และไม่มีค่าตั้งต้นของ payDueMin` → `assert.equal(c.depositPercent, 50); assert.equal(c.payDueMin, null)`
  - `campaignError: payDueMin ว่างหรือ ≤ 0 → ไม่ผ่าน (ต้องกรอกทุกแคมเปญ)` → ข้อความไม่ว่างทั้งกรณี `null`, `0`, `-5`, `1.5`; ผ่านเมื่อ `120`
  - `campaignError: ชื่อว่าง/ไม่มีสินค้า/retailId ซ้ำ/เพดานติดลบหรือทศนิยม → ไม่ผ่าน`
  - `campaignError: depositPercent นอก 1–100 → ไม่ผ่าน` (0, 101, 49.5)
  - `campaignError: วันที่ผิดลำดับ (orderFrom > orderTo, pickupFrom > pickupTo) หรือรูปแบบผิด → ไม่ผ่าน`
  - `pickupDays: ข้ามเดือนและข้ามปี` → `pickupFrom '2026-12-30'`, `pickupTo '2027-01-02'` ได้ `['2026-12-30','2026-12-31','2027-01-01','2027-01-02']`
  - `pickupDays: แคมเปญวันเดียว` → `['2026-12-24']` · ช่วงผิด → `[]`
  - `campaignPhase: แต่ละสถานะและวันขอบ (orderFrom, orderTo เป็นวันที่ยังเปิด)`
  - `toRow/fromRow: วนกลับได้ค่าเท่าเดิม และ dayCap null ไม่กลายเป็น 0`
- [ ] **Step 2: รัน `node src/lib/preorderCampaign.test.mjs`** — ต้องล้ม (module ไม่มี)
- [ ] **Step 3: ทำฟังก์ชันตาม Interfaces** — คิดวันด้วย `Date.UTC` + วนทีละ 1 วัน (ไม่พึ่ง timezone) · รูปแบบวันที่ตรวจด้วย `/^\d{4}-\d{2}-\d{2}$/` และต้องเป็นวันที่จริง
- [ ] **Step 4: รันเทสต์เดิม** — ต้องผ่านทั้งหมด
- [ ] **Step 5: Commit** — `feat(preorder): ฟังก์ชันล้วนตรวจและแปลงแคมเปญ`

---

### Task 2: Migration แกนตารางและโหมดทดสอบ

**Files:**
- Create: `supabase/migrations/20261127100000_punpang_preorder_core.sql`
- Create: `supabase/tests/preorder_core.test.sql`
- Modify: `supabase/tests/run.sh` (บล็อกใหม่ก่อน mirror), `supabase/tests/mirror.test.sql` (A1: ตารางฐาน `punpang_test` `27` → `30`)

**Interfaces:**
- Produces ตาราง (ทั้งหมดเป็น `public`, และถูกจัดเป็น iso):
  - `punpang_preorder_campaigns(id text pk, status text not null default 'draft' check in ('draft','open','closed'), order_from date not null, order_to date not null, pickup_from date not null, pickup_to date not null, deposit_percent integer not null default 50 check between 1 and 100, pay_due_min integer not null check (pay_due_min > 0), data jsonb not null default '{}', created_at/updated_at timestamptz not null default now())` + check `order_from <= order_to`, `pickup_from <= pickup_to` + ดัชนี `(updated_at, id)`
  - `punpang_preorder_slots(campaign_id text not null, pickup_date date not null, item_id text not null default '', reserved integer not null default 0 check (reserved >= 0), updated_at timestamptz not null default now(), primary key (campaign_id, pickup_date, item_id))` — `item_id = ''` คือแถวยอดรวมต่อวัน
  - `punpang_preorder_orders(id text pk, campaign_id text not null, code text not null unique, status text not null, pickup_date date not null, customer_id text, data jsonb not null default '{}', created_at/updated_at timestamptz not null default now())` + ดัชนี `(campaign_id, pickup_date)` และ `(updated_at, id)`
- Consumes: `public.punpang_has_perm(text)`, `public.punpang_touch_updated()` (trigger `before update` ตั้ง `updated_at`)

- [ ] **Step 1: เขียน `preorder_core.test.sql`** (ครอบด้วย `begin; ... rollback;`, ผู้ใช้ทดสอบ uuid prefix `d7000000-0000-4000-8000-00000000000N`, แบบ `consign_rounds.test.sql`) — assertion:
  - `PC1` ผู้ใช้ `managePreorder` insert/update campaigns ได้ · `PC2` ผู้ใช้ `manage` อย่างเดียว insert/update ได้ (policy มี `or manage`) · `PC3` ผู้ใช้ `sales` (`createOrder`,`pos`) อ่าน/เขียนไม่ได้ (`left(...,10) = 'ERR:42501:'` หรือ 0 แถว) · `PC4` `anon` อ่านไม่ได้
  - `PC5` insert แคมเปญไม่มี `pay_due_min` → `ERR:23502`; `pay_due_min = 0` → `ERR:23514`; `deposit_percent = 101` → `ERR:23514`; `order_from > order_to` → `ERR:23514`
  - `PC6` authenticated (แม้มีสิทธิ์) delete campaigns/slots ไม่ได้ และ insert ลง `punpang_preorder_orders`/`slots` โดยตรงไม่ได้ (มีเฉพาะ select/update ตามนโยบาย orders; slots select อย่างเดียว)
  - `PC7` โหมดทดสอบ: หลัง migration มีตารางเดียวกันใน `punpang_test` และ `punpang_test.punpang_reset_test_data()` (เรียกโดย admin) ล้างแถว preorder ในสำเนา โดยตารางจริงไม่ถูกแตะ (แบบ SR22–SR25 ใน `sync_review.test.sql`)
- [ ] **Step 2: รัน `bash supabase/tests/run.sh`** — ต้องล้ม (ตารางยังไม่มี)
- [ ] **Step 3: เขียน migration** ตามตาราง Interfaces: เปิด RLS, `revoke all ... from public, anon, authenticated`, grant เฉพาะ verb ที่ใช้ (campaigns: select/insert/update; orders: select/update; slots: select) policy ใช้ `(select public.punpang_has_perm('managePreorder')) or (select public.punpang_has_perm('manage'))` · trigger `punpang_touch_updated` ทั้ง 3 ตาราง · แพตช์ iso list ด้วยแบบ `do $$ ... pg_get_functiondef ... replace ...` ของ `20261122110000_punpang_member_levels.sql` โดย anchor `'punpang_member_events'];` (ต้องเจอพอดี 1 ครั้ง, รันซ้ำได้) เพิ่มชื่อ 3 ตาราง · `create or replace public.punpang_reset_test_data()` โดยคัดนิยามล่าสุดจาก `20261121140000_punpang_test_reset_sync_review.sql` แล้วเพิ่ม 3 ตารางใน truncate พร้อม `revoke ... from public, anon; grant execute ... to authenticated, service_role` · ท้ายไฟล์ `select punpang_test.punpang_test_sync();`
- [ ] **Step 4: เพิ่มบล็อก `preorder_core.test.sql` ใน `run.sh` (ก่อน mirror) และแก้ A1 เป็น 30** แล้วรัน `bash supabase/tests/run.sh` — ต้องผ่านทั้งชุด (รวม `mirror.test.sql`)
- [ ] **Step 5: Commit** — `feat(preorder): ตารางแคมเปญ/ออร์เดอร์/ช่องโควตา + RLS + โหมดทดสอบ`

---

### Task 3: RPC จอง/ปล่อยโควตา

**Files:**
- Create: `supabase/migrations/20261127110000_punpang_preorder_quota.sql`
- Create: `supabase/tests/preorder_quota.test.sql`
- Modify: `supabase/tests/run.sh` (บล็อกใหม่ + บล็อก concurrency 2 เซสชันตามแบบ W-4 ใน `run.sh`)

**Interfaces:**
- Consumes: ตารางจาก Task 2 (ใช้ `punpang_preorder_campaigns.data->'items'` = `[{retailId, dayCap}]` และ `data->>'dayCap'`)
- Produces (ทั้งสองตัว: `security definer set search_path = ''`, `revoke all ... from public, anon, authenticated`, `grant execute ... to service_role`):
  - `public.punpang_preorder_reserve(p_campaign text, p_pickup date, p_lines jsonb, p_enforce_window boolean default true) returns jsonb` — `p_lines = [{"itemId": text, "qty": integer}]` · สำเร็จ `{"ok": true}` · ล้ม `{"ok": false, "error": <code>, "itemId": text|null, "left": integer|null}` โดย code ∈ `closed` (status ≠ open), `outside_order_window` (วันนี้ตามเวลา Asia/Bangkok นอก order_from..order_to), `bad_date` (วันรับนอก pickup_from..pickup_to), `bad_item` (ไม่อยู่ในแคมเปญ), `bad_qty` (ไม่ใช่จำนวนเต็ม ≥ 1), `item_full`, `day_full` (`left` = ที่ว่างเหลือจริง)
  - `p_enforce_window = false` (ใช้ตอนร้านอนุมัติขยายเวลาแล้วจองโควตากลับ ซึ่งอาจเกิดหลังช่วงรับสั่งหรือหลังปิดรับ) ข้ามเฉพาะการตรวจ `closed` และ `outside_order_window` ส่วนวันรับ/สินค้า/จำนวน/เพดานตรวจเสมอ
  - `public.punpang_preorder_release(p_campaign text, p_pickup date, p_lines jsonb) returns jsonb` — ลดตัวนับตามคำขอ ไม่ต่ำกว่า 0 · คืน `{"ok": true}`
- รับรองว่า: รายการซ้ำใน `p_lines` ถูกรวม qty ก่อนตรวจ · ล็อกแถวช่อง (รวมแถวยอดรวม `item_id=''`) เรียงตาม `item_id` ในธุรกรรมเดียวกันเพื่อกัน deadlock · ล้มแล้วไม่มีการเปลี่ยนตัวนับใดๆ

- [ ] **Step 1: เขียน `preorder_quota.test.sql`** (seed แคมเปญ `open` วันรับ `2026-12-24..2026-12-26`, สินค้า A เพดาน 2, สินค้า B เพดาน 5, เพดานรวม 6; เรียกด้วย `service_role`):
  - `Q1` จอง A×2 สำเร็จ แล้วจอง A×1 ได้ `{ok:false, error:'item_full', itemId:'A', left:0}`
  - `Q2` **(Review Focus 1)** จอง `[A×1, B×9]` (B เกินเพดาน) ล้ม และตัวนับของ A **ไม่เพิ่ม** (อ่านตาราง slots ยืนยัน)
  - `Q3` เพดานรวม: จอง B×5 + แล้ว A×2 (รวม 7 > 6) → `day_full` และ `left` = ที่ว่างรวมจริง
  - `Q4` **(Review Focus 2)** qty `0`, `-1`, `1.5`, `"2"` → `bad_qty`; `itemId` ซ้ำสองบรรทัด `[A×1, A×1]` ถูกรวมเป็น A×2 ตรวจเพดานถูก
  - `Q5` สินค้าไม่อยู่ในแคมเปญ → `bad_item` · วันรับ `2026-12-27` → `bad_date` · แคมเปญ `draft`/`closed` → `closed` · วันนี้นอกช่วงรับสั่ง → `outside_order_window`
  - `Q6` **(Review Focus 3)** release A×2 แล้ว release A×2 อีกครั้ง → ตัวนับ A = 0 ไม่ติดลบ · release แล้วจองใหม่ได้
  - `Q7` สิทธิ์: `authenticated` (staff มี `managePreorder`) และ `anon` เรียก RPC ไม่ได้ (`ERR:42501`)
  - `Q8` เพดาน `null` (ไม่จำกัด) ของสินค้า/ยอดรวม → จองได้ไม่จำกัดจนถึงอีกด้าน
  - `Q9` `p_enforce_window=false`: แคมเปญ `closed` และวันนี้พ้นช่วงรับสั่งแล้วยังจองได้ถ้ายังมีที่ว่าง · แต่ `bad_date`/`bad_item`/`bad_qty`/`item_full` ยังเกิดตามเดิม
- [ ] **Step 2: รัน `bash supabase/tests/run.sh`** — ต้องล้ม (ฟังก์ชันยังไม่มี)
- [ ] **Step 3: เขียน migration RPC** ตาม Interfaces: อ่านแคมเปญด้วย `select ... for update` ก่อน แล้ว `insert ... on conflict do nothing` ช่อง 0 ของทุก (วัน, สินค้า, ยอดรวม) ที่เกี่ยวข้อง แล้วล็อกด้วย `for update` ตามลำดับ `item_id` · วันนี้คำนวณด้วย `(now() at time zone 'Asia/Bangkok')::date` · ท้ายไฟล์ `select punpang_test.punpang_test_sync();` (RPC ถูกคัดลอกเข้า `punpang_test` อัตโนมัติ)
- [ ] **Step 4: เพิ่มบล็อก concurrency ใน `run.sh`** (แบบ W-4): เซสชัน 1 เปิดธุรกรรมแล้วจองที่ว่างชิ้นสุดท้ายค้างไว้ด้วย `pg_sleep`, เซสชัน 2 ตั้ง `lock_timeout` สั้นแล้วจองชิ้นเดียวกัน → ต้องรอล็อก/หมดเวลา **ไม่ใช่** สำเร็จทั้งคู่; หลังเซสชัน 1 commit ตัวนับ = เพดานพอดี
- [ ] **Step 5: รัน `bash supabase/tests/run.sh`** — ต้องผ่านทั้งชุด
- [ ] **Step 6: Commit** — `feat(preorder): RPC จอง/ปล่อยโควตาแบบ atomic`

---

### Task 4: เลขที่ `PRE-` และตัวนับ

**Files:**
- Create: `supabase/migrations/20261127120000_punpang_preorder_number.sql`
- Create: `supabase/tests/preorder_number.test.sql`
- Modify: `src/lib/docNo.js` (`DOC_DIGITS` เพิ่ม `PRE: 6`), `supabase/functions/_shared/schedlib/docNo.js` (สร้างด้วย `node scripts/sync-schedlib.mjs`), `supabase/tests/run.sh`
- Test: `src/lib/docNo.test.mjs` ถ้ามีไฟล์อยู่ให้เพิ่มเคส มิฉะนั้นสร้าง `src/lib/docNoPre.test.mjs`

**Interfaces:**
- Produces: `formatNo('PRE', '241124', 7) === 'PRE-241124-000007'` · `parseNo('PRE-241124-000007')` คืน prefix `PRE` · ตัวนับ `punpang_counters` รับ prefix `PRE` · `public.punpang_alloc_numbers_server(p_prefix text, p_day text, p_n integer)` รับ `'PRE'` (ปัจจุบันรับเฉพาะ `'PAY'`; ยังจำกัด `p_n <= 10` และ grant เฉพาะ `service_role`)

- [ ] **Step 1: เขียนเทสต์ที่ล้ม** — node: `formatNo`/`parseNo` ของ `PRE` ตามค่าด้านบน และ `DOC_PREFIXES` มี `'PRE'` · SQL (`preorder_number.test.sql`): `service_role` เรียก `punpang_alloc_numbers_server('PRE','241124',2)` ได้เลขต่อเนื่องไม่ซ้ำ; prefix `'XXX'` ถูกปฏิเสธ; `authenticated` เรียกไม่ได้
- [ ] **Step 2: รันเทสต์ node + `run.sh`** — ต้องล้ม
- [ ] **Step 3: แก้ `docNo.js`, รัน `node scripts/sync-schedlib.mjs`** และเขียน migration: drop/add CHECK ของ `punpang_counters.prefix` เพิ่ม `'PRE'`, `create or replace punpang_alloc_numbers_server` (คัดนิยามล่าสุดจาก `20261108031014_punpang_alloc_numbers_server.sql` แล้วเปลี่ยนเงื่อนไข prefix เป็น `in ('PAY','PRE')` โดย grant/revoke เหมือนเดิม) · ห้ามแตะ `punpang_alloc_numbers` (ฝั่งพนักงาน) · ท้ายไฟล์ `punpang_test_sync()`
- [ ] **Step 4: เพิ่มบล็อก `preorder_number.test.sql` ใน `run.sh`; รัน `node src/lib/schedlibSync.test.mjs`, เทสต์ docNo และ `bash supabase/tests/run.sh`** — ต้องผ่านหมด
- [ ] **Step 5: Commit** — `feat(preorder): เลขที่ PRE- และตัวนับฝั่งเซิร์ฟเวอร์`

---

### Task 5: สิทธิ์ `managePreorder`

**Files:**
- Modify: `src/lib/constants.js` (`PERMISSIONS`, `PERM_GROUPS`), `docs/permissions.md` (เพิ่มบรรทัดสั้นๆ เหมือนบรรทัด "สิทธิ์ของระบบบัญชีเตรียมไว้แล้ว")
- Test: `src/lib/preorderPerm.test.mjs`

**Interfaces:**
- Produces: `PERMISSIONS.managePreorder = ['admin']` · รายการ `{ key: 'managePreorder', label: 'ตั้งและจัดการสั่งล่วงหน้า' }` ในกลุ่ม PERM_GROUPS ที่ว่าด้วย "ต้นทุน / ตั้งค่า / ผู้ใช้"

- [ ] **Step 1: เขียน `preorderPerm.test.mjs`** — `assert.deepEqual(PERMISSIONS.managePreorder, ['admin'])` · `ALL_PERMS.includes('managePreorder')` · `rolePreset('admin').includes('managePreorder')` และ `rolePreset('sales')` ไม่มี · พบ key ใน `PERM_GROUPS` เพียงหนึ่งครั้ง
- [ ] **Step 2: รัน `node src/lib/preorderPerm.test.mjs`** — ต้องล้ม
- [ ] **Step 3: เพิ่มค่าตาม Interfaces** (ไม่ต้องแก้ `punpang_has_perm` ใน DB)
- [ ] **Step 4: รันเทสต์เดิม** — ต้องผ่าน และ `npm test` ไม่มีเทสต์ที่เกี่ยวกับสิทธิ์ล้ม
- [ ] **Step 5: Commit** — `feat(preorder): สิทธิ์ managePreorder`

---

### Task 6: โมดูลข้อมูลฝั่งแอป

**Files:**
- Create: `src/data/preorder.js`
- Modify: `src/data/store.js` (เพิ่ม `preorderCampaigns: []` ใน `db` ที่ `export const db = reactive({` เท่านั้น)
- Test: `src/data/preorder.store.test.mjs` (รูปแบบ vite SSR ของ `holdMoney.store.test.mjs`; `session.role` ตั้งต้นเป็น admin)

**Interfaces:**
- Consumes: `campaignError`, `blankCampaign` จาก Task 1; `db`, `can` จาก store
- Produces (`src/data/preorder.js`, ไม่ถูก import จาก store.js):
  - `export const preorderCampaigns = (): Campaign[]` — คืน `db.preorderCampaigns` เรียงใหม่ก่อน
  - `export function savePreorderCampaign(form: Campaign): { ok: true, campaign: Campaign } | { error: string }` — ต้อง `can('managePreorder')` (ไม่ผ่าน → `{ error: 'ไม่มีสิทธิ์' }`) · ตรวจด้วย `campaignError` · `form.id` ว่าง = สร้าง id ใหม่ `pc<time36><seq>` · ตรวจว่า `retailId` ทุกตัวมีใน `db.retailItems` และไม่ใช่สินค้า `openPrice`
  - `export function setPreorderCampaignStatus(id: string, status: 'draft'|'open'|'closed'): { ok: true } | { error: string }` — เปิด (`open`) ได้เมื่อ `campaignError` ผ่านเท่านั้น
  - ไม่มีฟังก์ชันลบ (ปิดรับแทน ตรงกับ DB ที่ไม่มี policy delete)

- [ ] **Step 1: เขียน `preorder.store.test.mjs`** — บันทึกแคมเปญใหม่ได้ id และอยู่ใน `db.preorderCampaigns` · `payDueMin` ว่าง → error · สินค้า `openPrice` หรือไม่มีใน `retailItems` → error · แก้แคมเปญเดิมไม่เพิ่มแถว · `session.role='sales'` → `{ error:'ไม่มีสิทธิ์' }` และไม่แก้ `db` · เปิดแคมเปญที่ไม่ผ่านตรวจ → error และ status ไม่เปลี่ยน
- [ ] **Step 2: รัน `node src/data/preorder.store.test.mjs`** — ต้องล้ม
- [ ] **Step 3: เพิ่ม `db.preorderCampaigns` และทำ `src/data/preorder.js`** ตาม Interfaces
- [ ] **Step 4: รันเทสต์** — ต้องผ่าน และรัน `npm run build && npm run test:bundle` ยืนยันว่า main chunk ไม่โต (store.js เพิ่มแค่ค่าตั้งต้น)
- [ ] **Step 5: Commit** — `feat(preorder): โมดูลข้อมูลแคมเปญฝั่งแอป`

---

### Task 7: ซิงก์ตารางแคมเปญ

**Files:**
- Create: `src/lib/preorderSync.js`
- Modify: `src/lib/staffAuth.js` (`GROUP_LOADERS` เพิ่มกลุ่ม `preorders`)
- Test: `src/lib/preorderSync.test.mjs` (fake client แบบ `shiftsSync.test.mjs`)

**Interfaces:**
- Consumes: `campaignToRow`, `rowToCampaign` (Task 1); `startSync`, `withVer`, `fillArray` จาก `tableSync.js`
- Produces (แบบเดียวกับ `shiftsSync.js`): `loadPreorderCampaigns(client)`, `loadPreorderCampaignsSince(client, since)`, `pushPreorderCampaigns(client, { upserts })`, `startPreorderSync({ client, db, canWrite, onError, debounceMs })` (label `'แคมเปญสั่งล่วงหน้า'`, `poll: true`) · แถวที่โหลดมาผ่าน `withVer(rowToCampaign(r), r.updated_at)`
- `GROUP_LOADERS.preorders`: คืน `null` ถ้าผู้ใช้ไม่มีทั้ง `managePreorder` และ `manage`; มิฉะนั้น `await import('./preorderSync')` แล้ว `startPreorderSync({ client: c.client, db: c.store.db, canWrite: c.has('managePreorder') || c.has('manage'), onError: c.onError })` และเมื่อไม่มีสิทธิ์ต้องล้าง `db.preorderCampaigns` ตามแบบที่ `staffAuth.js` ล้าง `db.shifts`

- [ ] **Step 1: เขียน `preorderSync.test.mjs`** — `load` แปลงแถวเป็นแคมเปญ (`dayCap null` คงเป็น `null`) · `pushPreorderCampaigns` เรียก `upsert` ตาราง `punpang_preorder_campaigns` ด้วย `campaignToRow` · error จาก client คืน `{ error }` ที่อ่านได้ · `since` ใช้ `gte('updated_at', since)`
- [ ] **Step 2: รัน `node src/lib/preorderSync.test.mjs`** — ต้องล้ม
- [ ] **Step 3: ทำ `preorderSync.js` และลงทะเบียนใน `GROUP_LOADERS`** ตาม Interfaces
- [ ] **Step 4: รัน `node src/lib/preorderSync.test.mjs` และ `npm test`** — ต้องผ่าน
- [ ] **Step 5: Commit** — `feat(preorder): ซิงก์แคมเปญเข้าแอปแบบ lazy`

---

### Task 8: หน้า ManagePreorders

**Files:**
- Create: `src/views/manage/ManagePreorders.vue`, `e2e/preorders.ui.e2e.mjs` (แบบ `e2e/consignRounds.ui.e2e.mjs`)
- Modify: `src/router.js` (lazy import + route), `src/lib/settingsPages.js`, `e2e/_routes.mjs`

**Interfaces:**
- Consumes: `preorderCampaigns`, `savePreorderCampaign`, `setPreorderCampaignStatus` (Task 6); `campaignPhase`, `blankCampaign`, `pickupDays` (Task 1)
- Produces: route `/admin/settings/preorders` มี `meta: { perms: ['managePreorder'], data: ['preorders'] }` (lazy: `const ManagePreorders = () => import('./views/manage/ManagePreorders.vue')`) · รายการเมนู `{ group: 'shop', to: '/admin/settings/preorders', icon: 'calendar', title: 'สั่งล่วงหน้า (Preorder)', perm: 'managePreorder', keywords: 'preorder สั่งล่วงหน้า แคมเปญ โควตา มัดจำ' }` (ตรวจให้ `settingsPages.test.mjs` ผ่าน: กลุ่มมีจริง, `to` ไม่ซ้ำ)

- [ ] **Step 1: เขียน `e2e/preorders.ui.e2e.mjs`** (Playwright + vite server ตามแบบ `consignRounds.ui.e2e.mjs`, ล็อกอินเป็น admin ผ่าน store) — เปิด `#/admin/settings/preorders` เห็นหัวข้อและปุ่ม "+ สร้างแคมเปญ" · กดบันทึกโดยเว้น "ต้องจ่ายมัดจำภายใน" ว่าง → ข้อความ error แสดงและแคมเปญไม่ถูกสร้าง · กรอกครบ (ชื่อ, ช่วงรับสั่ง, ช่วงรับสินค้า, ชั่วโมงจ่าย, เลือกสินค้า 1 รายการพร้อมเพดาน) → มีการ์ดแคมเปญสถานะ "ร่าง" · กด "เปิดรับสั่ง" → สถานะเปลี่ยน · ผู้ใช้ role `sales` เข้าหน้าได้รับ "ไม่มีสิทธิ์เข้าหน้านี้" · viewport 375px ไม่มี horizontal overflow
- [ ] **Step 2: รัน `node e2e/preorders.ui.e2e.mjs`** — ต้องล้ม
- [ ] **Step 3: ทำหน้า `ManagePreorders.vue`** ตามแบบ `ManageLinks.vue`/`ManagePromos.vue` (`ManageShell perm="managePreorder" guard`, `AppModal wider`, `askConfirm`, `AppSwitch`, `ThaiDateField`): ช่องกรอก — ชื่อ, ช่วงรับสั่ง, ช่วงวันรับสินค้า, มัดจำขั้นต่ำ % (ตั้งต้น 50), **ต้องจ่ายมัดจำภายใน (ชั่วโมง) บังคับกรอก** (เก็บเป็นนาที `payDueMin = ชั่วโมง × 60`), โควตารวมต่อวัน (ว่าง = ไม่จำกัด), รายการสินค้า (เลือกจาก `db.retailItems` ที่ `active`, `showInPos !== false`, ไม่ใช่ `openPrice`, ไม่มี `modifierIds`) พร้อมเพดานต่อวันของแต่ละตัว (ว่าง = ไม่จำกัด) · การ์ดรายการแสดงสถานะจาก `campaignPhase` และปุ่มเปิดรับ/ปิดรับ · ไม่มีปุ่มลบ
- [ ] **Step 4: ลงทะเบียน route/เมนู/`e2e/_routes.mjs`** (ถ้าลืมเพิ่ม `_routes.mjs` หน้านี้จะไม่ถูกทดสอบ responsive/roles เงียบๆ)
- [ ] **Step 5: ตรวจทั้งชุด** — `node e2e/preorders.ui.e2e.mjs` ผ่าน · `npm test` ผ่าน (รวม `pages.ssr.test.mjs` ที่ค้นหน้าใหม่เอง และ `settingsPages.test.mjs`) · `npm run build && npm run test:bundle` ผ่าน (ถ้าเกินงบ หยุดและรายงานผู้ใช้ ห้ามขยายเอง) · เทสต์ DB ผ่านใน CI job `database` (หรือในเครื่องถ้ามี `psql`)
- [ ] **Step 6: Commit** — `feat(preorder): หน้าตั้งแคมเปญสั่งล่วงหน้า`

---

## ส่งมอบเฟส 1
เปิด PR จาก `claude/preorder-phase1` ไป `main` เมื่อ CI ผ่านครบ · **ยังไม่ deploy**: migration 3 ไฟล์ (`20261127100000`, `20261127110000`, `20261127120000`) รันผ่าน workflow Release (`db_migrations` ใส่ชื่อไฟล์ทั้งสาม) ก่อน แล้วค่อยปล่อยเว็บ ลำดับ migration → เว็บ · ฟังก์ชัน Edge Function ยังไม่มีในเฟสนี้
