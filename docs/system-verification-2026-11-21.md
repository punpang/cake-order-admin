# รายงานตรวจสอบทั้งระบบ (2026-11-21)

ฐานโค้ด: main `d6844af` (อัปเดตหลัง Release #11 · #12 และเทสต์กะ POS · รายงานชุดแรกอิง main `5809310`) · production: Supabase + Cloudflare Pages · ตรวจแบบอ่านอย่างเดียว ยกเว้นข้อ 3 (เขียนแบบธุรกรรมที่ยกเลิก ไม่ทิ้งข้อมูล · ไม่ได้รันซ้ำในรอบอัปเดตนี้)

## สรุป
- ทุกชุดเทสต์ผ่านทั้งหมด (unit 92 ไฟล์ · Deno 174 เทสต์ · e2e 183 ข้อ + 4 กรณีใหม่ `settingsCrud` · DB 22 ไฟล์บน Postgres จริง รวม `shifts_guard` ใหม่ · CI main #315 ผ่าน)
- production ตรงกับโค้ดที่ทดสอบ: migration 135/135 · Edge Function 24/24 · โครงสร้างฐานข้อมูลตรงทุกหมวดที่เทียบ (column 530 · constraint 152 · policy 121 · trigger 78 · relation 82 · index 176) ความต่างที่เหลือเป็นเรื่องแพลตฟอร์ม/เวอร์ชัน PG (ดูข้อ 2)
- ทดสอบพฤติกรรมบน production 38 ข้อ (ด่านยอดเกินบิล · ย้อนสถานะ · แต้ม · คิวผู้จัดการ + กระดิ่ง + push · สิทธิ์ตามบทบาท · งวดบัญชีที่ปิดแล้ว) ผ่านทั้งหมด และไม่มีข้อมูลค้าง
- ไม่พบฟังก์ชันที่ใช้ไม่ได้ในสิ่งที่ตรวจ · ช่องว่าง 14 ข้อ: แก้แล้ว 6 ข้อ (B1, B2, B3, B9, B12, B13) · แก้บางส่วน 1 (B7) · รอการอนุมัติหรือการตัดสินใจ (B4, B5, B10 ส่วนที่เหลือ, B7 เพดานอัตรา) · ดูข้อ 4 และ 9–10
- **รับประกัน "100%" ไม่ได้** · รายงานนี้บอกว่าแต่ละส่วนผ่านการตรวจชั้นไหน และช่องไหนไม่ได้ตรวจ (ข้อ 4)

## 1. ผลตามชั้นการตรวจ
| ชั้น | วิธี | ผล |
|---|---|---|
| Unit | `npm test` | 92 ไฟล์ ผ่านทั้งหมด |
| Build + งบขนาด | `npm run build` + `bundle-budget` | 870.5 / 872 KB ผ่าน |
| Edge Function (Deno) | ทุกโฟลเดอร์ใน `supabase/tests/functions` (รันในเครื่อง) | 174 เทสต์ ผ่าน 0 ล้ม · CI #311 รัน `_shared`, customer-auth และตรวจชนิดข้อมูลทุกฟังก์ชันผ่านด้วย |
| e2e | `npm run test:e2e:ci` (14 ชุด · รอบอัปเดตเพิ่ม `settingsCrud` 4 กรณี ผ่านในเครื่อง แต่ยังไม่ได้รันชุดเต็มใน CI) | 183 ผ่าน 0 ล้ม (smoke 68 หน้า · มือถือ 375px 65 หน้า · a11y 8 หน้า · สิทธิ์ตามบทบาท 132 การเปิดหน้า · XSS 4 · ดับเบิลคลิก 2 · แจ้งเตือน/สรุปประจำวัน 6 · ลูกค้า lazy 10 · POS/ชำระเงิน/บัญชี 5 · เส้นทางลูกค้า 3 · คูปอง/แต้ม/สมาชิก) |
| DB บน Postgres จริง | `supabase/tests/run.sh` (Postgres 16 ในเครื่อง) | migration 135 ไฟล์ + 22 ไฟล์ทดสอบ (รวม `shifts_guard` ใหม่) ผ่านทั้งหมด |
| CI | main #315 (`d6844af`) | node ✓ · database ✓ · deno ✓ · e2e ข้าม (รันเฉพาะสั่งเอง) |

## 2. production แบบอ่านอย่างเดียว
| หัวข้อ | ผล |
|---|---|
| Migration | 135/135 ตรง repo (เทียบ md5 ของเวอร์ชัน+ชื่อ ได้ค่าเดียวกันทั้งสองฝั่ง) |
| Edge Function | 24/24 ACTIVE ชื่อตรง repo · ฟังก์ชันที่โค้ดใน main ใหม่กว่าที่ deploy ไม่กระทบพฤติกรรม (B5) · เทียบซอร์สจริง `customer-loyalty` ตรง |
| โครงสร้าง DB (public + punpang_test) เทียบฐานจาก migration (วิธีเดียวกันทั้งสองฝั่ง) | column 530/530 · constraint 152/152 · policy 121/121 · trigger 78/78 · relation (ตาราง/วิว/RLS) 82/82 · สิทธิ์ execute ฟังก์ชัน 501/501 · publication public 10/10 (production มีเพิ่ม 7 พาร์ทิชันของแพลตฟอร์ม) · index 176/176 (4 ตัวต่างแค่การแสดงผล `extensions.gin_trgm_ops`) · function 215: 6 ต่างเพราะ production ไม่มีบรรทัดคอมเมนต์ (ตรรกะตรงเมื่อตัดคอมเมนต์ ดู B14) + `rls_auto_enable` 2 ตัวเป็นฟังก์ชันแพลตฟอร์ม · สิทธิ์ตาราง 1273 ตรง ส่วนต่าง 128 = สิทธิ์ MAINTAIN (มีใน PG 17 ของ production) · production = PG 17.11, ฐานอ้างอิง = PG 16.15 |
| โค้ด ↔ DB | RPC 29/29 · ตาราง 30/30 · trigger 12/12 มีบน production · สคีมาทดสอบขาด 2 ตาราง (B2) |
| Cron | 5 งาน active (งานลบกล่องเข้าเปลี่ยนชื่อเป็น `punpang-tungngern-inbox-purge` แล้ว) · `manee-inbox-purge` ล้ม 2 ครั้ง (15–16 พ.ย.) แก้แล้ว · `punpang-scheduled` ไม่มีประวัติรันตั้งแต่สร้างใน Release #11 (14:14Z) จนถึง 15:00Z แล้วรันสำเร็จ และได้ 200 ทั้งรอบ 15:00 และ 15:15 (ดู B13) |
| คิวผู้จัดการ | 0 แถว |
| Vault / pg_net | มี `push_send_key`, `scheduled_key` · pg_net ตอบ 200 ×50 / 404 ×4 / timeout ×11 (B13) |
| Log 24 ชม. | function_logs ไม่มี error · Postgres ERROR 4 (2 จากเครื่องมือตรวจเอง · 2 จากคำขอ PostgREST ที่ไม่มีสิทธิ์ เวลา 09:15Z ซึ่ง edge ตอบ 401/406) · edge ≥400: ดู B1, B8 |
| Advisor ความปลอดภัย | ไม่มีตารางปิด RLS · 13 ตาราง RLS ไม่มี policy (token/session/OTP/ตัวนับ ตั้งใจ) · SECURITY DEFINER ที่ authenticated เรียกได้ 33 ตัว: 28 อ้างตัวตน/สิทธิ์ในโค้ด (ตรวจด้วย regex) · อีก 5 = สาธารณะตั้งใจ 4 + ปลดระวาง 1 (B7) · Leaked password protection ปิด (B6) |
| Advisor ประสิทธิภาพ | multiple permissive policies 7 (kv/items/records) · index ซ้ำ 2 คู่ (เฉพาะ punpang_test) · index ไม่ใช้ 21 (INFO) |

## 3. production แบบธุรกรรมที่ยกเลิก (38 ข้อ ผ่านทั้งหมด)
รันในบล็อก `DO` เดียวที่จบด้วย `RAISE EXCEPTION` จึงยกเลิกทั้งหมด · จำลองพนักงาน 6 บทบาท (ข้อมูลทดสอบขึ้นต้น `QA-` ในธุรกรรมเท่านั้น) · `net.http_post` เพียงแทรกแถวเข้าคิวในธุรกรรมเดียวกัน จึงไม่มีการแจ้งออกจริง · ตัวนับเลขเป็นตาราง จึงไม่กินเลขเอกสาร/บัญชี
| ชุด | สิ่งที่ตรวจบนสคีมา `public` จริง | ผล |
|---|---|---|
| S0 | สลับบทบาทเป็น authenticated ได้ | ผ่าน |
| S1 | ยอดยืนยันเท่ายอดบิลสร้างได้ · เกินยอดบิลถูกบล็อก (P0001) ทั้งตอนสร้างและตอนแก้ | ผ่าน 4/4 |
| S2 | ย้อนสถานะ (cancelled→delivered, delivered→cancelled) ต้องมี `revertStatus` · การยกเลิกปกติผ่าน | ผ่าน 4/4 |
| S3 | พนักงานขายแก้ spins/ledger ตรงไม่ได้ · แอดมินปรับแต้มผ่าน RPC ได้ · พนักงานขายปรับแต้มไม่ได้ | ผ่าน 5/5 |
| S4 | พนักงานขายเข้าคิวได้ · อ่านคิวไม่ได้ · ผู้จัดการอ่าน/ปิดพร้อมเหตุผลได้ · คนขับและ anon เข้าคิวไม่ได้ · กระดิ่ง `team_order_review` 1 แถว · push ถูกเข้าคิวส่ง (delta=1) | ผ่าน 10/10 |
| S5 | anon อ่าน orders/customers/payments/acct_entries/acct_invoices/staff/sync_review/shifts ไม่ได้ · คนขับไม่เห็นออร์เดอร์ทั่วไป · พนักงานขายลบข้อมูลลูกค้า (purge) ไม่ได้ · anon purge ไม่ได้ | ผ่าน 12/12 |
| S6 | ลงรายการบัญชีงวดเปิดผ่าน · งวดที่ปิดแล้วถูกบล็อก (P0001) | ผ่าน 2/2 |

หลังรัน: แถว `QA-` ทุกตาราง = 0 · ตัวนับ (`punpang_counters`, `punpang_acct_counters`) ตรงก่อน/หลัง · คิว pg_net = 0 · จำนวนแถวตารางหลักเท่าเดิม

## 4. ช่องว่างและข้อสังเกต (เรียงตามความเสี่ยง)
สถานะ (อัปเดตหลัง Release #11 และ #12): **แก้แล้วและ Release แล้ว:** B3, B12, B13 (Release #11 · `b85d8f8`) · B1, B2, B9 และ B7 ส่วน apply_points (Release #12 · `31a31a9`) · **แก้บางส่วน:** B7 (ยังไม่ได้ตรวจเพดาน `record_*`) · **รอการอนุมัติหรือการตัดสินใจ:** B4, B5, B10 ส่วนที่เหลือ, B7 เพดาน · **ผู้ใช้แจ้งว่าทำแล้ว (ยังไม่ได้ตรวจซ้ำจากที่นี่):** B6 · B8 ไม่พบการเกิดซ้ำหลัง 11:06Z
| ID | ระดับ | พบ | ทางแก้ที่แนะนำ |
|---|---|---|---|
| B13 | เตือน · **แก้แล้ว** (timeout 30 วินาที, Release #11 · รอบ 15:00 และ 15:15 ได้ 200) | cron `punpang-scheduled` (ทุก 15 นาที) ถูก pg_net ตัดที่ 5 วินาที 11 จาก 24 รอบ (08:00–13:50Z) · รอบที่สำเร็จใช้ 3.6–4.9 วินาที (ใกล้เพดาน) · รอบที่ถูกตัดฟังก์ชันบูตปกติ แต่ผลสุดท้ายยืนยันจาก log ไม่ได้ | เพิ่ม `timeout_milliseconds` (เช่น 30000) หรือลดเวลาทำงานของฟังก์ชัน |
| B12 | เตือน (ทำซ้ำไม่ได้) · **แก้แล้ว** (migration `20261121160000`, Release #11) | `punpang_customers_phone_digits_uniq` (unique index เบอร์ที่ตัดอักขระแล้ว · public และ punpang_test) มีบน production แต่ไม่มีใน migration/สคริปต์ใดใน repo (อ้างถึงเฉพาะ `customersSync.js:94` และเทสต์ `customersSync.lazy.test.mjs:79`) → สร้างฐานใหม่จาก migration จะไม่มีด่านเบอร์ซ้ำ และเทสต์ DB ใน CI ไม่ครอบคลุม | เพิ่ม migration `create unique index if not exists` ให้ตรง production (ต้อง Release) |
| B6 | เตือน (ตั้งค่า) · ผู้ใช้แจ้งว่าเปิดแล้ว (ยังไม่ได้ตรวจซ้ำ) | Supabase Auth: Leaked password protection ปิดอยู่ | เปิดที่ Dashboard ของ Supabase Auth |
| B1 | เตือน (เฉพาะโหมดทดสอบ) · **แก้แล้ว** (Release #12) | `punpang_test.punpang_order_audits` ไม่มี FK ไป `punpang_orders` (production มี) → คิวรี `fetchPendingPosHoldIds` (src/lib/posHold.js:10) ล้ม 400 วันนี้ 16 ครั้ง · เวลาตรงกับเครื่องทดสอบ (ไม่เห็นหัว Accept-Profile ใน log) · คำขออื่นที่ production ตอบ 200 ครั้ง 45 ครั้ง | เติม FK ในสคีมาทดสอบ หรือเปลี่ยนคิวรีไม่ใช้ embed |
| B2 | เตือน (เฉพาะโหมดทดสอบ) · **แก้แล้ว** (Release #12) | `punpang_line_users` / `punpang_line_messages` ไม่มีใน `punpang_test` · หน้า `/admin/settings/line-history` (ManageLineHistory.vue:20,39) ใช้ client ตามโหมด จึงคิวรีตารางที่ไม่มี | สร้างตารางในสคีมาทดสอบ หรือซ่อนหน้าในโหมดทดสอบ |
| B3 | ปรับปรุง · **แก้แล้ว** (Release #11) | `e2e/_routes.mjs` STATIC ขาด `/admin/settings/sync-review` (route คงที่ ไม่มีพารามิเตอร์) → ไม่ถูก smoke/375px ครอบคลุม · เส้นทางมีพารามิเตอร์/redirect อีก 14 เส้น ไม่มี e2e | เพิ่ม 1 บรรทัดใน STATIC |
| B7 | ข้อมูล · **แก้บางส่วน** (apply_points เพิกถอนแล้ว · เพดานอัตรา `record_*` รอการตัดสินใจ) | RPC ที่ anon เรียกได้ 4 ตัว (click_stats / record_click / record_pageview / resolve_short_link) ตั้งใจสำหรับหน้าร้านสาธารณะ · click_stats คืนค่ารวมที่มี ≥3 ผู้เข้าชม · record_* เขียนจากผู้ไม่ล็อกอิน (ยังไม่ได้ตรวจเพดานอัตรา) · `punpang_apply_points` ปลดระวางแล้ว (คืน retired) แต่ authenticated ยัง execute ได้ (ไม่มีผล) | ตรวจเพดานอัตราของ record_* · เพิกถอนสิทธิ์ apply_points |
| B4 | ปรับปรุง | `bot-test` บน production ยังเป็นโค้ดก่อนแก้ aiLog (63cc98d ไม่เก็บข้อความลูกค้า) · เป็นเครื่องมือทดสอบ ข้อมูลอยู่สคีมาทดสอบ ข้อความผ่าน scrubPII ตัดสั้น → ความเสี่ยงต่ำ | deploy `bot-test` ใหม่ผ่าน Release (ต้องอนุมัติ) |
| B10 | ครอบคลุม · **บางส่วน** (`settingsCrud` 4 กรณี: ลิงก์ย่อ · สิทธิ์ · เอกสารกฎหมาย · หน้าร้าน · ที่เหลือ 26 หน้า) | หน้าตั้งค่าย่อย 30 หน้า: smoke + 375px + สิทธิ์ เท่านั้น ไม่มี e2e พฤติกรรม CRUD (products / pricing / options / bundles / ingredients / gallery / storefront / links / legal / integrations / photo-requests / deletion-requests ฯลฯ) → พึ่ง unit test ของ lib | เพิ่ม e2e ตามความเสี่ยง (ต้องอนุมัติ) |
| B8 | ตรวจสาเหตุแล้ว · ไม่พบการเกิดซ้ำหลัง 11:06Z | ส่วนใหญ่เกิด 10:20–10:37Z ซึ่งเป็นช่วงทดสอบ push วันนี้ · push-send 404 ×4 (`record`) = ไม่มีแถวกระดิ่งในช่วงนั้นเหลืออยู่ (แถวทดสอบถูกลบแล้ว) · push-send 405 ×1 (11:06Z) = เรียกด้วยวิธีที่ไม่ใช่ POST · sms-send 503 ×2 = โค้ดตอบ "ยังไม่ได้ตั้งค่าเกตเวย์ SMS" · telegram-send 403 ×2 = ไม่ใช่ปลายทางถูกบล็อกในโหมดทดสอบ (ไม่มีแถว blocked) สาเหตุยังไม่ยืนยัน · storage sign 400 ×9 (รูป Messenger 04:21Z) = หน้าแชทแสดง "โหลดไม่ได้" ตามออกแบบ (ตรวจโค้ดแล้ว) · fb-connect 409 = โหมดทดสอบปฏิเสธตามออกแบบ | ค้างคำถาม: SMS ควรเปิดใช้หรือยัง · telegram 403 ต้องดูเพิ่มถ้าต้องการ |
| B5 | ข้อมูล | โค้ดใน main ใหม่กว่าที่ deploy แต่ไม่กระทบพฤติกรรม: scheduled / customer-order / fb-webhook (ขาด bell `team_order_review` ที่ตัวมันไม่สร้าง) · order-audit / quote-create (ขาดค่าคงที่ช่อง LINE และ `team_daily_summary` ที่ไม่ได้ใช้) · line-push (ขาดฟังก์ชันอายุข้อความที่ไม่ได้ใช้) · line-webhook (ส่วนที่เปลี่ยนใช้กับ Messenger เท่านั้น) | ไม่ต้องทำอะไร (รวมใน Release ครั้งหน้า) |
| B14 | ข้อมูล | function ใน production: 14 ตัว (×2 สคีมา) มี CR (CRLF) ต่าง repo เฉพาะช่องว่าง · 3 ตัว (`punpang_cust_spin`, `punpang_log_error`, `punpang_purge_customer`) ขาดบรรทัดคอมเมนต์ไทยเทียบ repo · `rls_auto_enable` เป็นฟังก์ชันแพลตฟอร์ม → ไม่มีความต่างเชิงตรรกะ | — |
| B9 | เล็กน้อย · **แก้แล้ว** (Release #12) | cron `punpang-manee-inbox-purge` ลบ `public.tungngern_inbox` (ชื่อไม่ตรงงาน) | เปลี่ยนชื่อ |

## 5. ส่วนของระบบ × ชั้นที่ตรวจ (จับคู่จากชื่อไฟล์เทสต์ ไม่ใช่การวัด coverage ของโค้ด)
| ส่วนของระบบ | เทสต์อัตโนมัติ | production | ช่องว่าง |
|---|---|---|---|
| POS ขาย/คืนเงิน/กะ | unit (posBills, posAudit, posHoldRules, refund, RefundEditor) · DB (payment_over_bill, payment_bill_parity, card_gate, pickup_guard, over_bill_shipping, balance_sync) · Deno order-create · e2e (ขายเงินสด+คืนเงิน, ดับเบิลคลิก, สแกนคูปอง/สมาชิก) | S1, S2 | พิมพ์จริง/เครื่องจริง (นอกขอบเขต) · B1 (โหมดทดสอบ) |
| ออร์เดอร์/สถานะ/ซิงก์ออฟไลน์ | unit (orderCreate, orderGate, orderCap, ordersSync.*, tableSync.*, syncStatus.*, shiftsSync) · DB (status_reversal, quote_order) · Deno (order-create, order-audit, order-link) · e2e flows | S2 | — |
| ชำระเงิน/สลิป/ถุงเงิน | unit (payBind, payFields, payFresh, slipAccount, slipBind, slipChecks, promptpay, payAccounts) · DB payment_* · Deno tungngern-* · e2e ยืนยันยอด | S1 | รับโอนจริงผ่านภายนอก |
| ลูกค้า/สมาชิก/PIN/PDPA | unit (customersSync.lazy, consent, scan, staffSessionHint) · DB (member_scan, purge_customer, customer_deleted_guard) · Deno (customer-auth, customer-order, customer-loyalty) · e2e (สมัคร+OTP+PIN, สแกนสมาชิก, ค้นแบบ lazy) | S3, S5 (purge) | OTP/SMS จริง · B12 |
| คูปอง/แต้ม/กาชา/ลุ้นโชค | unit (coupons, creditCoupons, pointsCoupon*, luckyDraw, scratch) · DB (coupon_modes, credit_coupons, points_coupon, lucky, points_clear_guard) · Deno (lucky, loyalty) · e2e (creditCoupons.ui, pointsCoupon.ui) | S3 | — |
| ใบเสนอราคา | unit (quotePrice) · DB quote_order · Deno (quote-create, flows/quote-to-order) | — | ไม่ได้ลองบน production |
| แชท/Messenger/LINE/บอท | unit (chatSync*, chatPing, chatPresence, chatVisibility, lineChannel, aiStats) · Deno (fb-webhook, line-webhook, line-link, fb-connect, bot-test, messaging) · e2e XSS แชท | log (B8) | ส่งออกจริง · B2 · B4 · รูปหมดอายุ (B8) |
| แจ้งเตือน (กระดิ่ง/push/SMS/Telegram) | unit (notifyEvents, notifyPicker, notifyPlan, dailySummary, testRecipients) · Deno (push-send, scheduled, sms-send, messaging, campaign) · e2e (dailyFeatures.ui) | S4 (push เข้าคิว) · cron (B13) | ส่งจริงถึงมือถือ/ผู้รับ (นอกขอบเขต) |
| บัญชี/ใบกำกับภาษี | unit (acct/derive.credit, taxInvoice) · DB acct_opening · Deno tax-invoice · e2e เปิดหน้าบัญชี | S6 | — |
| คิวผู้จัดการ (รอตรวจ) | unit (syncReview*, reviewView) · DB (sync_review, review_resend) · Deno (order-create เข้าคิว) | S4 | e2e ของหน้า sync-review ไม่มีใน repo (B3) · หน้าผู้จัดการเคยตรวจบนเครื่องจริงรอบก่อน (docs/device-test-checklist.md) |
| ตั้งค่า (30 หน้าย่อย) | e2e smoke + 375px + สิทธิ์ · e2e พฤติกรรม `settingsCrud` (ลิงก์ย่อ · เอกสารกฎหมาย · หน้าร้าน · สิทธิ์) · unit บางส่วน (settingsPages, bundle*, printConfig, retention, campaigns, displayAds) | — | B10 (ที่เหลือ 26 หน้า) |
| พิมพ์ใบเสร็จ | unit (printConfig, receiptFacts) · e2e printing.ui | — | Bluetooth/window.print บนเครื่องจริง (นอกขอบเขต) |
| สิทธิ์/ความปลอดภัย | DB security.test (+ ไฟล์ guard ต่าง ๆ) · e2e (roles, xss, a11y) · advisor | S5 | B6, B7 |
| หน้าร้านสาธารณะ (menu/gallery/links) | e2e smoke + 375px · RPC สาธารณะ | อ่านอย่างเดียว | ไม่มี e2e พฤติกรรม · B7 |

## 6. สิ่งที่ไม่ได้ตรวจ (ตามขอบเขต)
- ส่งจริงออกภายนอก: SMS / Facebook / LINE / Telegram / FCM บนมือถือ
- พิมพ์ Bluetooth / `window.print` / iOS / Android บนเครื่องจริง
- สมัครลูกค้าด้วย OTP จริง (ต้องส่ง SMS) · เรียก Edge Function ด้วยบัญชีพนักงานจริง (ไม่มีรหัสผ่าน) — ชั้นนี้อาศัยเทสต์ Deno และ e2e

## 7. ลำดับแก้ที่แนะนำ (อัปเดตแล้ว · ทุกข้อที่แตะ production ต้องอนุมัติ)
1. B13 — แก้แล้ว (Release #11) · ยืนยันรอบ 15:00 และ 15:15 แล้ว
2. B12 — แก้แล้ว (Release #11) · ทดสอบ purge ที่เบอร์ซ้ำในชุดทดสอบ
3. B6 — ผู้ใช้แจ้งว่าเปิดแล้ว (ยังไม่ได้ตรวจซ้ำ)
4. B3 — แก้แล้ว (Release #11)
5. B1, B2 — แก้แล้ว (Release #12)
6. B7 — apply_points เพิกถอนแล้ว (Release #12) · **รอการตัดสินใจ**: เพดานอัตรา `record_*` (ดูข้อ 10)
7. B4 — deploy `bot-test` ผ่าน Release ถัดไป (**รอการอนุมัติ**)
8. B10 — เริ่มแล้ว 4 กรณี (`settingsCrud`) · ที่เหลือ 26 หน้า (**รอการอนุมัติ merge เมื่อพร้อม**)

## 8. ข้อจำกัดของวิธีตรวจ
- การเทียบ Edge Function ที่ deploy กับ main ใช้เวลา deploy เทียบ commit ล่าสุดในกราฟ import + อ่าน diff (เทียบซอร์สจริงเฉพาะ `customer-loyalty`) ไม่ใช่การเทียบทุกตัวแบบไบต์ต่อไบต์
- การตรวจ SECURITY DEFINER ใช้ regex ว่าโค้ดอ้างตัวตน/สิทธิ์หรือไม่ ไม่ได้อ่านทีละตัว
- ฐานอ้างอิงเป็น PG 16 ส่วน production เป็น PG 17 (ผลเทียบที่ตรงกันจึงมีน้ำหนัก · ความต่างของ index ตรวจรายตัวแล้ว)
- B1: ความเชื่อมโยงกับเครื่องทดสอบอนุมานจากเวลาและการไม่มี FK ในสคีมาทดสอบ ไม่ได้เห็นหัว Accept-Profile
- ตารางความครอบคลุมจับคู่จากชื่อไฟล์เทสต์ ไม่ใช่การวัด coverage
- ตาราง `net._http_response` ไม่เก็บ URL จึงระบุปลายทางของ timeout จากเวลาและ edge log ที่ตรงกันเท่านั้น (รอบ 14:30 ที่ timeout อนุมานว่าเป็นงานเก่า ไม่ได้ยืนยันจากตาราง)
- ตัวเลขโครงสร้างในข้อ 2 ใช้วิธีเดียวกันทั้งสองฝั่งและครอบคลุม `public` + `punpang_test` ตัวเลขของรายงานชุดแรกใช้ขอบเขตแคบกว่า จึงถูกแทนที่ด้วยชุดนี้

## 9. วิธีทำซ้ำ
- `npm test` · `npm run build && npm run test:bundle` · `npm run test:fn` · `npm run test:e2e:ci` · `bash supabase/tests/run.sh` (ต้องมี Postgres)
- เทียบโครงสร้าง: รัน SQL รวมค่า md5 ต่อหมวด (function / policy / trigger / constraint / index / column / สิทธิ์) บนฐานอ้างอิงและ production แล้วเทียบ · ทดสอบบน production: บล็อก `DO` + `RAISE EXCEPTION` ตามข้อ 3 (สคริปต์อยู่นอก repo)

## 9. การเปลี่ยนแปลงหลังรายงานชุดแรก (2026-11-21)
- **Release #11** (main `b85d8f8` · migration `20261121160000`): timeout `punpang-scheduled` 30 วินาที · unique index เบอร์ให้ตรง production · เพิ่ม route sync-review ใน e2e · ผ่าน
- **Release #12** (main `31a31a9` · migration `20261121170000`): timeout `punpang-order-audit` 30 วินาที · เปลี่ยนชื่องานลบกล่องเข้า · เพิกถอน execute `punpang_apply_points` · สำเนาโหมดทดสอบ: FK ของ `order_audits` และตาราง LINE ว่าง 2 ตาราง · ผ่าน
- **เทสต์กะ POS** (main `d6844af`, CI #315 ผ่าน): `supabase/tests/shifts_guard.test.sql` 14 ข้อผ่าน · ข้อความ commit เขียนว่า 19 ข้อ จำนวนที่ถูกคือ 14 ข้อ
- **เทสต์หน้าตั้งค่า** `e2e/settingsCrud.ui.e2e.mjs` (4 กรณี ผ่านในเครื่อง · เพิ่มในสคริปต์ `test:e2e` และ `test:e2e:ci` แล้ว)
- **การตั้งค่าในฐานข้อมูลจริง (ไม่ผ่าน migration)**: `punpang_kv` config/integrations `sms.enabled` = false (ก่อนหน้า true) เพื่อหยุดการเรียก sms-send ที่ตอบ 503
- **`punpang-scheduled`**: ไม่รันตั้งแต่สร้าง (14:14Z) จนถึง 15:00Z · รอบ 15:00 และ 15:15 รันสำเร็จ 200 · สาเหตุของช่วงแรกยังไม่ทราบ

## 10. ที่ต้องอนุมัติหรือตัดสินใจ
- **B7 เพดานอัตรา `record_*`**: เสนอให้นับต่อ IP (แฮช) ต่อช่วงเวลาในฐานข้อมูล ภายใน RPC โดยอ่าน IP จาก request headers · ต้องมี migration และ Release (**รอการอนุมัติ**) ทางเลือกอีกทางคือย้ายไป Edge Function ที่มีการจำกัดอัตรา
- **B4 และ B5**: deploy Edge Functions ที่เก่ากว่า main ผ่าน Release รอบถัดไป (**รอการอนุมัติ**)
- **B10 ส่วนที่เหลือ 26 หน้า** และการ merge ไฟล์ทดสอบที่เพิ่มเข้า main (**รอการอนุมัติ**)
- **ทดสอบบนเครื่องจริง** (ผู้ใช้): checklist ข้อ 3–4 และ queue ข้อ 3 (`docs/device-test-checklist.md`)
- **ผู้ใช้ตรวจเอง**: Leaked password protection (B6) และ deployment ของ Cloudflare Pages ว่าตรงกับ main
