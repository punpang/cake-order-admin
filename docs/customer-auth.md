# ระบบลูกค้า (เบอร์โทร + PIN + OTP) — แผนต่อ Supabase จริง

สถานะตอนนี้: **จำลองในหน่วยความจำ** (`src/data/store.js` + `src/lib/customerAuth.js`) รีเฟรชแล้วหาย · OTP แสดงบนจอ (ยังไม่ส่ง SMS) · PIN hash ในเบราว์เซอร์
ของจริงต้องทำฝั่งเซิร์ฟเวอร์ทั้งหมด ห้ามเชื่อถือการตรวจในเบราว์เซอร์

## URL (โดเมนเดียว hash routing)
| ส่วน | path |
|---|---|
| หน้าร้าน (สาธารณะ) | `#/`, `#/menu`, `#/menu/ready/:id`, `#/menu/custom/:typeId` |
| ระบบลูกค้า | `#/account/login`, `#/account/register`, `#/account/forgot`, `#/account` |
| หลังบ้าน | `#/admin/...` (ลิงก์เก่า `#/orders` ฯลฯ redirect ให้) |

## กติกา
- สมัคร: เบอร์ → OTP → (ชื่อ ถ้าเบอร์ใหม่) → ตั้ง PIN · เบอร์ที่พนักงานสร้างลูกค้าไว้แล้วจะ **ผูกกับลูกค้าเดิม** หลังยืนยัน OTP
- เข้าสู่ระบบ: เบอร์ + PIN 6 หลัก · ผิด 5 ครั้งล็อก 15 นาที (ลืม PIN ปลดล็อก)
- OTP 6 หลัก หมดอายุ 5 นาที ขอใหม่ทุก 60 วินาที ผิด 5 ครั้งต้องขอใหม่ ใช้ได้ครั้งเดียว
- **ต้องยืนยัน OTP:** สมัคร, ลืม PIN, เปลี่ยน PIN, เปลี่ยนเบอร์ (OTP ไปเบอร์ใหม่), ส่งคำขอลบข้อมูล
- PIN ห้ามง่าย: เลขซ้ำ เลขเรียง รูปแบบซ้ำ เลขท้ายเบอร์โทร
- ลูกค้าแก้เองได้: ชื่อ, LINE ID, รับข่าว/โปร · เบอร์แก้ผ่าน OTP · เห็นแต่แก้ไม่ได้: ออร์เดอร์/ยอดชำระ/บิล POS/วันเกิดในออร์เดอร์/คะแนน · **ไม่เห็น** หมายเหตุพนักงาน ต้นทุน/กำไร ประวัติภายใน

## การยินยอม PDPA / คุกกี้ / เงื่อนไข (รอบ A)
- ข้อความ 3 ชุด (`privacy`, `terms`, `cookie`) แก้ได้ที่ `/admin/settings/legal` มีเวอร์ชัน · ร่างตั้งต้นอยู่ที่ `src/lib/legalDefaults.js` **เป็นร่าง ต้องให้ที่ปรึกษากฎหมายตรวจก่อนใช้จริง** และต้องปรับให้ตรงเมื่อต่อ Supabase / เปิดระบบวิเคราะห์
- คุกกี้: แบนเนอร์ตอนเข้าหน้าร้าน (ไม่ใช้คุกกี้ที่ไม่จำเป็นจนกว่าจะยินยอม) เก็บค่าเลือกใน `localStorage` 12 เดือน หรือเมื่อเวอร์ชันนโยบายเปลี่ยน · `cookieAllowed(kind)` ต้องเรียกก่อนโหลดสคริปต์วิเคราะห์/การตลาด
- สมัครสมาชิก: ต้องติ๊กยอมรับ PDPA + เงื่อนไข (ตรวจซ้ำฝั่ง `registerAccount`) · แอดมินแก้ข้อความแล้ว "ขึ้นเวอร์ชัน" → ลูกค้าที่ล็อกอินถูกพาไป `#/account/consent` ให้กดยอมรับก่อนใช้บัญชี (ไม่ยอมรับ = ออกจากระบบ)
- ตาราง `consents (id, customer_id null, kind, version, detail jsonb, at, via)` · เก็บเป็นหลักฐานตลอด แม้ลบข้อมูลลูกค้า (ไม่มีข้อมูลระบุตัวตนนอกจาก id ที่ถูกทำให้นิรนามแล้ว) · `legal_docs (kind pk, version, title, text, updated_at)` + ประวัติเวอร์ชัน (ของจริงควรเก็บทุกเวอร์ชันที่เคยประกาศ)
- RLS: `consents` ลูกค้าเพิ่ม/อ่านเฉพาะของตัวเอง (ผ่าน Edge Function) · `legal_docs` อ่านได้ทุกคน (anon) แก้ได้แอดมินเท่านั้น

## ตาราง (ร่าง)
- `customers` เพิ่ม `deleted bool`, `deleted_at`
- `customer_accounts (customer_id pk fk, phone unique, pin_hash, failed int, locked_until, created_at)` — **ไม่ให้ client อ่านเลย** (เข้าถึงผ่าน Edge Function เท่านั้น)
- `otp_codes (id, phone, purpose, code_hash, attempts, expires_at, verified_until, used, account_id)` — hash รหัส ไม่เก็บ plaintext · ลบแถวหมดอายุ/ใช้แล้วเป็นระยะ (pg_cron)
- `deletion_requests (id, customer_id, status, customer_note, reason, created_at, decided_at, decided_by)`
- `reviews (id, customer_id null, order_id null, source, status, name, rating, text, created_at)`
- `storefront (singleton jsonb)` + รูปใน Supabase Storage (`products.images`, type options `images`, `storefront.gallery`)

## Edge Functions
`otp-request`, `otp-verify` (คืน token ใช้ครั้งเดียว), `register`, `login` (คืน session ของ Supabase Auth ผูก `customer_id` ใน JWT claim), `reset-pin`, `change-pin`, `change-phone`, `request-deletion`, `admin-approve-deletion` (เฉพาะแอดมิน)
- **ส่ง SMS:** เรียก URL ระบบ SMS ของร้าน (เก็บ URL/คีย์ใน Supabase secrets) · ข้อความ OTP ไม่เกิน 70 ตัวอักษรไทย · จำกัดจำนวน OTP ต่อเบอร์/ต่อ IP/ต่อวัน (กันยิง SMS ถล่ม)
- **PIN:** argon2id (หรือ bcrypt cost ≥ 12) + pepper ใน secrets · จำกัดจำนวนครั้งที่ลองฝั่งเซิร์ฟเวอร์ (ไม่ใช่แค่ใน UI) · PIN 6 หลักมีแค่ 1,000,000 แบบ ต้องพึ่งการล็อกบัญชี
- ข้อความ error ตอนล็อกอินเหมือนกันทุกกรณี (ไม่บอกว่าเบอร์มีในระบบไหม) · หน้าสมัคร/ลืม PIN ก็ควรตอบแบบทั่วไปเมื่อต่อจริง (ตอนนี้จำลองบอกเหตุผลตรง ๆ)

## RLS (ลูกค้าเห็น/แก้เฉพาะของตัวเอง)
เปิด RLS ทุกตาราง ใช้ `auth.jwt() ->> 'customer_id'`
- `customers`: SELECT แถวตัวเอง · UPDATE เฉพาะคอลัมน์ `name, line, promo_opt_in` (ใช้ column privilege หรือ view + function ไม่ให้แก้ `phone, note, ledger`)
- `orders` + `order_items` + `payments`: SELECT เฉพาะ `customer_id` ตัวเอง และผ่าน view ที่ตัด `history`, ต้นทุน, หมายเหตุภายใน
- `coupons`, `ledger`: SELECT ของตัวเอง · แลกของ/หมุนกาชา ผ่าน RPC `security definer` ที่ตรวจเจ้าของ
- `reviews`: INSERT ได้เมื่อออร์เดอร์เป็นของตัวเองและ `delivered` (1 รีวิวต่อออร์เดอร์) `status = pending` · SELECT สาธารณะเฉพาะ `approved`
- `deletion_requests`: INSERT/SELECT ของตัวเอง (ผ่าน Edge Function หลัง OTP)
- `customer_accounts`, `otp_codes`: ไม่มี policy ให้ client (service role เท่านั้น)
- หน้าร้าน (anon): SELECT `products`/ตัวเลือกที่ `active` + `storefront` + `reviews approved` ผ่าน view ที่ไม่มีสูตร/ต้นทุน

## ลบข้อมูล (แอดมินอนุมัติ)
เงื่อนไขอนุมัติ: ไม่มีออร์เดอร์ที่ยังไม่จบ และไม่มียอดค้างชำระ · ปฏิเสธต้องมีเหตุผล (ลูกค้าเห็นในหน้าบัญชี)
**ลบ (ทำใน transaction เดียว):** ชื่อ เบอร์ LINE userId / FB PSID หมายเหตุ → ตั้งเป็น "ลูกค้าที่ลบแล้ว" · บัญชี/PIN/OTP · แชทและใบเสนอ · คะแนน/คูปอง · รีวิว · คิวข้อความที่อ้างออร์เดอร์/ที่อยู่ผู้รับ · key ทักวันเกิด/แจ้งเตือน · ในออร์เดอร์: วันเกิด ที่อยู่ หมายเหตุรายการ รูปอ้างอิง ข้อความบนเค้ก/ข้อความที่พิมพ์เอง สลิป/หมายเหตุการชำระ
**เก็บ (นิรนาม):** ออร์เดอร์ รายการ ยอดเงิน การชำระ (จำนวน/ช่องทาง/วันที่) เพื่อบัญชี/ภาษี ผูกกับ customer_id ที่ถูกลบตัวตนแล้ว
ของจริงต้องลบ/ปิดบังใน backup ตามรอบ และลบไฟล์รูปใน Storage ที่เกี่ยวข้อง (ตอนนี้จำลองไม่มีไฟล์จริง)

## สิ่งที่ต้องตัดสินใจตอนต่อจริง
- URL ระบบ SMS ของร้าน (ผู้ใช้จะให้ภายหลัง) รูปแบบ request/response และโควตา
- ระยะเก็บ OTP/ล็อกการใช้งาน, ระยะเก็บบัญชีที่ไม่ได้ใช้งาน
- ลบบัญชีลูกค้าที่มีออร์เดอร์ค้าง: ตอนนี้ "ปฏิเสธ + แจ้งเหตุผล" ไม่มีขั้นตอนบังคับยกเลิกออร์เดอร์
