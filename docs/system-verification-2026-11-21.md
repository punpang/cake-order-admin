# รายงานตรวจสอบทั้งระบบ (2026-11-21)

ฐานโค้ด: main `5809310` · production: Supabase + Cloudflare Pages · ตรวจแบบอ่านอย่างเดียว ยกเว้นข้อ 3 (เขียนแบบธุรกรรมที่ยกเลิก ไม่ทิ้งข้อมูล)

## สรุป
- ทุกชุดเทสต์ผ่านทั้งหมด (unit 92 ไฟล์ · Deno 174 เทสต์ · e2e 183 ข้อ · DB 21 ไฟล์บน Postgres จริง · CI main #311)
- production ตรงกับโค้ดที่ทดสอบ: migration 133/133 · Edge Function 24/24 · โครงสร้างฐานข้อมูลตรงทุกหมวด ยกเว้น index ที่เกินมา 1 รายการ (B12)
- ทดสอบพฤติกรรมบน production 38 ข้อ (ด่านยอดเกินบิล · ย้อนสถานะ · แต้ม · คิวผู้จัดการ + กระดิ่ง + push · สิทธิ์ตามบทบาท · งวดบัญชีที่ปิดแล้ว) ผ่านทั้งหมด และไม่มีข้อมูลค้าง
- ไม่พบฟังก์ชันที่ใช้ไม่ได้ในสิ่งที่ตรวจ · พบช่องว่าง/ข้อสังเกต 14 ข้อ (ข้อสำคัญสุด: B13 งานตามเวลาถูกตัดที่ 5 วินาที ยังยืนยันผลของรอบที่ถูกตัดไม่ได้ · B12 index ที่สร้างฐานใหม่ไม่ได้)
- **รับประกัน "100%" ไม่ได้** · รายงานนี้บอกว่าแต่ละส่วนผ่านการตรวจชั้นไหน และช่องไหนไม่ได้ตรวจ (ข้อ 4)

## 1. ผลตามชั้นการตรวจ
| ชั้น | วิธี | ผล |
|---|---|---|
| Unit | `npm test` | 92 ไฟล์ ผ่านทั้งหมด |
| Build + งบขนาด | `npm run build` + `bundle-budget` | 870.5 / 872 KB ผ่าน |
| Edge Function (Deno) | ทุกโฟลเดอร์ใน `supabase/tests/functions` (รันในเครื่อง) | 174 เทสต์ ผ่าน 0 ล้ม · CI #311 รัน `_shared`, customer-auth และตรวจชนิดข้อมูลทุกฟังก์ชันผ่านด้วย |
| e2e | `npm run test:e2e:ci` (14 ชุด) | 183 ผ่าน 0 ล้ม (smoke 68 หน้า · มือถือ 375px 65 หน้า · a11y 8 หน้า · สิทธิ์ตามบทบาท 132 การเปิดหน้า · XSS 4 · ดับเบิลคลิก 2 · แจ้งเตือน/สรุปประจำวัน 6 · ลูกค้า lazy 10 · POS/ชำระเงิน/บัญชี 5 · เส้นทางลูกค้า 3 · คูปอง/แต้ม/สมาชิก) |
| DB บน Postgres จริง | `supabase/tests/run.sh` (Postgres 16 ในเครื่อง) | migration 133 ไฟล์ + 21 ไฟล์ทดสอบ ผ่านทั้งหมด |
| CI | main #311 | node ✓ · database ✓ · deno ✓ · e2e ข้าม (รันเฉพาะสั่งเอง) |

## 2. production แบบอ่านอย่างเดียว
| หัวข้อ | ผล |
|---|---|
| Migration | 133/133 ตรง repo (เทียบ md5 ของเวอร์ชัน+ชื่อ) |
| Edge Function | 24/24 ACTIVE ชื่อตรง repo · ฟังก์ชันที่โค้ดใน main ใหม่กว่าที่ deploy ไม่กระทบพฤติกรรม (B5) · เทียบซอร์สจริง `customer-loyalty` ตรง |
| โครงสร้าง DB (public + punpang_test) เทียบฐานจาก migration | column 515/515 · constraint 147/147 · policy 121/121 · trigger 78/78 (เปิดใช้ครบ) · relation/RLS/สิทธิ์ตาราง 80/80 · สิทธิ์ execute 215/215 · publication 10/10 · view 15/15 · function 215/215 ตรรกะตรง (B14) · index ต่าง 2 (B12) · production = PG 17.11, ฐานอ้างอิง = PG 16.15 |
| โค้ด ↔ DB | RPC 29/29 · ตาราง 30/30 · trigger 12/12 มีบน production · สคีมาทดสอบขาด 2 ตาราง (B2) |
| Cron | 5 งาน active · `manee-inbox-purge` ล้ม 2 ครั้ง (15–16 พ.ย. อ้างตารางที่ไม่มี) แก้แล้ว สำเร็จต่อเนื่องถึง 21 พ.ย. · ดู B13 |
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
สถานะ: **B3, B12, B13 แก้แล้วบน dev** (migration `20261121160000_punpang_scheduled_timeout_phone_uniq.sql` + e2e route) รอ merge และ Release · ข้ออื่นยังไม่ได้แก้
| ID | ระดับ | พบ | ทางแก้ที่แนะนำ |
|---|---|---|---|
| B13 | เตือน | cron `punpang-scheduled` (ทุก 15 นาที) ถูก pg_net ตัดที่ 5 วินาที 11 จาก 24 รอบ (08:00–13:50Z) · รอบที่สำเร็จใช้ 3.6–4.9 วินาที (ใกล้เพดาน) · รอบที่ถูกตัดฟังก์ชันบูตปกติ แต่ผลสุดท้ายยืนยันจาก log ไม่ได้ | เพิ่ม `timeout_milliseconds` (เช่น 30000) หรือลดเวลาทำงานของฟังก์ชัน |
| B12 | เตือน (ทำซ้ำไม่ได้) | `punpang_customers_phone_digits_uniq` (unique index เบอร์ที่ตัดอักขระแล้ว · public และ punpang_test) มีบน production แต่ไม่มีใน migration/สคริปต์ใดใน repo (อ้างถึงเฉพาะ `customersSync.js:94` และเทสต์ `customersSync.lazy.test.mjs:79`) → สร้างฐานใหม่จาก migration จะไม่มีด่านเบอร์ซ้ำ และเทสต์ DB ใน CI ไม่ครอบคลุม | เพิ่ม migration `create unique index if not exists` ให้ตรง production (ต้อง Release) |
| B6 | เตือน (ตั้งค่า) | Supabase Auth: Leaked password protection ปิดอยู่ | เปิดที่ Dashboard ของ Supabase Auth |
| B1 | เตือน (เฉพาะโหมดทดสอบ) | `punpang_test.punpang_order_audits` ไม่มี FK ไป `punpang_orders` (production มี) → คิวรี `fetchPendingPosHoldIds` (src/lib/posHold.js:10) ล้ม 400 วันนี้ 16 ครั้ง · เวลาตรงกับเครื่องทดสอบ (ไม่เห็นหัว Accept-Profile ใน log) · คำขออื่นที่ production ตอบ 200 ครั้ง 45 ครั้ง | เติม FK ในสคีมาทดสอบ หรือเปลี่ยนคิวรีไม่ใช้ embed |
| B2 | เตือน (เฉพาะโหมดทดสอบ) | `punpang_line_users` / `punpang_line_messages` ไม่มีใน `punpang_test` · หน้า `/admin/settings/line-history` (ManageLineHistory.vue:20,39) ใช้ client ตามโหมด จึงคิวรีตารางที่ไม่มี | สร้างตารางในสคีมาทดสอบ หรือซ่อนหน้าในโหมดทดสอบ |
| B3 | ปรับปรุง | `e2e/_routes.mjs` STATIC ขาด `/admin/settings/sync-review` (route คงที่ ไม่มีพารามิเตอร์) → ไม่ถูก smoke/375px ครอบคลุม · เส้นทางมีพารามิเตอร์/redirect อีก 14 เส้น ไม่มี e2e | เพิ่ม 1 บรรทัดใน STATIC |
| B7 | ข้อมูล | RPC ที่ anon เรียกได้ 4 ตัว (click_stats / record_click / record_pageview / resolve_short_link) ตั้งใจสำหรับหน้าร้านสาธารณะ · click_stats คืนค่ารวมที่มี ≥3 ผู้เข้าชม · record_* เขียนจากผู้ไม่ล็อกอิน (ยังไม่ได้ตรวจเพดานอัตรา) · `punpang_apply_points` ปลดระวางแล้ว (คืน retired) แต่ authenticated ยัง execute ได้ (ไม่มีผล) | ตรวจเพดานอัตราของ record_* · เพิกถอนสิทธิ์ apply_points |
| B4 | ปรับปรุง | `bot-test` บน production ยังเป็นโค้ดก่อนแก้ aiLog (63cc98d ไม่เก็บข้อความลูกค้า) · เป็นเครื่องมือทดสอบ ข้อมูลอยู่สคีมาทดสอบ ข้อความผ่าน scrubPII ตัดสั้น → ความเสี่ยงต่ำ | deploy `bot-test` ใหม่ผ่าน Release (ต้องอนุมัติ) |
| B10 | ครอบคลุม | หน้าตั้งค่าย่อย 30 หน้า: smoke + 375px + สิทธิ์ เท่านั้น ไม่มี e2e พฤติกรรม CRUD (products / pricing / options / bundles / ingredients / gallery / storefront / links / legal / integrations / photo-requests / deletion-requests ฯลฯ) → พึ่ง unit test ของ lib | เพิ่ม e2e ตามความเสี่ยง (ต้องอนุมัติ) |
| B8 | ต้องดูเพิ่ม | storage sign 400 ×9 (รูปแชท Messenger 04:21Z — ยังไม่ได้ยืนยันว่า UI แสดง placeholder เมื่อรูปหมดอายุ) · sms-send 503 ×2 · telegram-send 403 ×2 · push-send 404 ×4 / 405 ×1 · fb-connect 409 ×20 (โหมดทดสอบถูกปฏิเสธโดยออกแบบ ไม่ใช่ข้อผิดพลาด) | ดูสาเหตุ sms/telegram/push เมื่อมีโอกาส |
| B5 | ข้อมูล | โค้ดใน main ใหม่กว่าที่ deploy แต่ไม่กระทบพฤติกรรม: scheduled / customer-order / fb-webhook (ขาด bell `team_order_review` ที่ตัวมันไม่สร้าง) · order-audit / quote-create (ขาดค่าคงที่ช่อง LINE และ `team_daily_summary` ที่ไม่ได้ใช้) · line-push (ขาดฟังก์ชันอายุข้อความที่ไม่ได้ใช้) · line-webhook (ส่วนที่เปลี่ยนใช้กับ Messenger เท่านั้น) | ไม่ต้องทำอะไร (รวมใน Release ครั้งหน้า) |
| B14 | ข้อมูล | function ใน production: 14 ตัว (×2 สคีมา) มี CR (CRLF) ต่าง repo เฉพาะช่องว่าง · 3 ตัว (`punpang_cust_spin`, `punpang_log_error`, `punpang_purge_customer`) ขาดบรรทัดคอมเมนต์ไทยเทียบ repo · `rls_auto_enable` เป็นฟังก์ชันแพลตฟอร์ม → ไม่มีความต่างเชิงตรรกะ | — |
| B9 | เล็กน้อย | cron `punpang-manee-inbox-purge` ลบ `public.tungngern_inbox` (ชื่อไม่ตรงงาน) | เปลี่ยนชื่อ |

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
| ตั้งค่า (30 หน้าย่อย) | e2e smoke + 375px + สิทธิ์ · unit บางส่วน (settingsPages, bundle*, printConfig, retention, campaigns, displayAds) | — | B10 |
| พิมพ์ใบเสร็จ | unit (printConfig, receiptFacts) · e2e printing.ui | — | Bluetooth/window.print บนเครื่องจริง (นอกขอบเขต) |
| สิทธิ์/ความปลอดภัย | DB security.test (+ ไฟล์ guard ต่าง ๆ) · e2e (roles, xss, a11y) · advisor | S5 | B6, B7 |
| หน้าร้านสาธารณะ (menu/gallery/links) | e2e smoke + 375px · RPC สาธารณะ | อ่านอย่างเดียว | ไม่มี e2e พฤติกรรม · B7 |

## 6. สิ่งที่ไม่ได้ตรวจ (ตามขอบเขต)
- ส่งจริงออกภายนอก: SMS / Facebook / LINE / Telegram / FCM บนมือถือ
- พิมพ์ Bluetooth / `window.print` / iOS / Android บนเครื่องจริง
- สมัครลูกค้าด้วย OTP จริง (ต้องส่ง SMS) · เรียก Edge Function ด้วยบัญชีพนักงานจริง (ไม่มีรหัสผ่าน) — ชั้นนี้อาศัยเทสต์ Deno และ e2e

## 7. ลำดับแก้ที่แนะนำ (ทุกข้อที่แตะ production ต้องอนุมัติ · ข้อ 1, 2, 4 แก้แล้วบน dev รอ Release)
1. B13 — เพิ่ม timeout ของ cron `punpang-scheduled` เป็น 30 วินาที (แก้แล้วบน dev)
2. B12 — เพิ่ม migration สำหรับ unique index เบอร์ให้ตรง production (แก้แล้วบน dev · ทดสอบชุดข้อมูลทดสอบ purge ที่เบอร์ซ้ำด้วย)
3. B6 — เปิด Leaked password protection (ตั้งค่าใน Dashboard)
4. B3 — เพิ่ม `/admin/settings/sync-review` ใน STATIC (แก้แล้วบน dev)
5. B1, B2 — ทำสคีมาทดสอบให้เท่าสคีมาจริง (FK ของ order_audits และตาราง LINE)
6. B7 — ตรวจเพดานอัตราของ RPC สาธารณะ · เพิกถอนสิทธิ์ `punpang_apply_points`
7. B4 — deploy `bot-test` ในรอบ Release ถัดไป
8. B10 — เพิ่ม e2e พฤติกรรมของหน้าตั้งค่าที่เสี่ยงสูง

## 8. ข้อจำกัดของวิธีตรวจ
- การเทียบ Edge Function ที่ deploy กับ main ใช้เวลา deploy เทียบ commit ล่าสุดในกราฟ import + อ่าน diff (เทียบซอร์สจริงเฉพาะ `customer-loyalty`) ไม่ใช่การเทียบทุกตัวแบบไบต์ต่อไบต์
- การตรวจ SECURITY DEFINER ใช้ regex ว่าโค้ดอ้างตัวตน/สิทธิ์หรือไม่ ไม่ได้อ่านทีละตัว
- ฐานอ้างอิงเป็น PG 16 ส่วน production เป็น PG 17 (ผลเทียบที่ตรงกันจึงมีน้ำหนัก · ความต่างของ index ตรวจรายตัวแล้ว)
- B1: ความเชื่อมโยงกับเครื่องทดสอบอนุมานจากเวลาและการไม่มี FK ในสคีมาทดสอบ ไม่ได้เห็นหัว Accept-Profile
- ตารางความครอบคลุมจับคู่จากชื่อไฟล์เทสต์ ไม่ใช่การวัด coverage

## 9. วิธีทำซ้ำ
- `npm test` · `npm run build && npm run test:bundle` · `npm run test:fn` · `npm run test:e2e:ci` · `bash supabase/tests/run.sh` (ต้องมี Postgres)
- เทียบโครงสร้าง: รัน SQL รวมค่า md5 ต่อหมวด (function / policy / trigger / constraint / index / column / สิทธิ์) บนฐานอ้างอิงและ production แล้วเทียบ · ทดสอบบน production: บล็อก `DO` + `RAISE EXCEPTION` ตามข้อ 3 (สคริปต์อยู่นอก repo)
