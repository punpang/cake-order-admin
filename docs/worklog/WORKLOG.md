# บันทึกงาน cake-order-admin

## ดูก่อน (อ่านแค่ส่วนนี้ = Read offset 1, limit 20)
- ล่าสุด 2026-11-22 · main = ดู `git log -1 origin/main` (ส่ง SMS ได้แล้ว · ลิงก์หลักเป็น punpang.com) · dev = `80e8a1e` (ยังไม่ merge · ไม่ได้ Release) · sms-send v50 verify_jwt=true · Cloudflare build ตรวจไม่ได้ (connector ขอสิทธิ์เพิ่ม)
- **รอผู้ใช้:** สั่ง "merge + Release" อีกครั้ง (เลือกข้อ 1: เพิ่มกฎ push main แคบในเครื่อง · ยังไม่ทดสอบว่ามีผล) · จากนั้น push dev→main แล้ว Release migration `20261122100000` (confirm=RUN จาก main)
- **ปิดแล้ว:** B13 cron timeout (ตรวจ 22 พ.ย.: HTTP 200 ทุกรอบที่ยังเก็บผล) · B12 ดัชนีเบอร์ลูกค้ามีบน production · B6 แผนฟรี ยอมรับความเสี่ยง ไม่ถามซ้ำ · ลบ Worker sms-tls-probe · www.punpang.com ใน Turnstile และ ALLOWED_ORIGINS แล้ว
- งบบันเดิล 875.8/876 KB (เหลือ 0.2 KB · เกินให้หยุดถามก่อนขอเพิ่ม) · ขั้น 2 อยู่บน dev แล้ว (ต้อง Release) · ค้างไว้: หัวกลุ่มวันที่ตารางผลิตโปร่งแสง 90% (เสนอให้ทึบ)
- URL ทดสอบ (ไม่ใช่ production): https://claude-zen-gauss-5qbmyh.cake-order-admin.pages.dev
- **กติกา:** รายการใหม่อยู่บนสุด (ทำอะไร · ทำไม · รอ) · commit พร้อมงานรอบนั้น (dev เท่านั้น) · compact แล้วต้องจดก่อนทำต่อ
- **ขนาด:** บล็อกนี้ ≤ 3 KB · ไฟล์นี้ ≤ 30 KB หรือ ≤ 10 รายการ · เกินให้ย้ายรายการเก่าไป `WORKLOG-archive-YYYY-MM.md`
- **ป้ายระบบ:** ใส่ในหัวรายการ [ลูกค้า] [LIFF] [ครัว] [POS] [ออร์เดอร์] [SMS] [Release] [DB] [ระบบ] · ค้นงานระบบเดียว: `grep -n '\[ครัว\]' docs/worklog/*.md`
- **การถามผู้ใช้:** ถามเป็นข้อ ๆ (หน้าต่างคำถาม) ข้อละ 2–4 ตัวเลือก · ตัวเลือกที่ดีที่สุดอยู่ข้อแรกพร้อม "(แนะนำ)" และเหตุผลสั้น ๆ · ถามเฉพาะเรื่องที่ผู้ใช้ต้องตัดสิน

---

## 2026-11-22 · [ระบบ][LIFF][ลูกค้า] ย้ายลิงก์หลักเป็น punpang.com: Worker, เมนู ถุงเงิน, เมนูใน LINE, ลิงก์สุ่มรางวัล · อยู่บน main แล้ว

**ทำอะไร:** ตั้งค่า ALLOWED_ORIGINS ของ punpang-files ใน `worker/wrangler.jsonc` ให้มี punpang.com และ www.punpang.com (ตรงกับ dashboard) · เอาการซ่อนเมนู "ถุงเงิน" ออก (`src/lib/adminSystems.js`) · MENU_URL ของบอท LINE (`supabase/functions/_shared/lineliff.ts`) และ LUCKY_SITE_URL (`src/lib/luckyDraw.js`) เป็น punpang.com · deploy Worker punpang-files (run #4), line-webhook (run #6), line-link (run #6) สำเร็จ · ผู้ใช้ลบ Worker `sms-tls-probe` และเพิ่ม www.punpang.com ใน Turnstile กับ ALLOWED_ORIGINS ใน dashboard แล้ว · commit `262c98d` `d05e6b8` `2cf9d35` `cde7b68` `ce61551`
**เหตุผล:** เว็บใช้ punpang.com เป็นโดเมนหลัก · ค่าใน `wrangler.jsonc` ทับค่า dashboard ทุกครั้งที่ deploy จึงต้องเก็บให้ตรงกันในไฟล์ · ผู้ใช้สั่ง "merge deploy" และ "ทำเลย"
**ผล:** deploy-worker run #4 (`cde7b68`), deploy-line-webhook และ deploy-line-link run #6 (`2cf9d35`) สำเร็จ · CI บน main สำเร็จ (`cde7b68`) · ผู้ใช้ยืนยันว่าล็อกอินและส่ง SMS ได้แล้ว · ยังไม่ deploy Worker รอบ www เพราะค่า dashboard ตรงกับไฟล์แล้ว
**รอ:** ผู้ใช้ตรวจบน punpang.com: เห็นเมนู "ถุงเงิน" · อัปโหลดรูปและเปิดสลิปไม่มี CORS error · ลิงก์เมนูในบอท LINE ไป punpang.com · ตั้งลิงก์สุ่มรางวัลใน `/#/admin/settings/lucky` เป็น https://punpang.com ถ้ายังเป็น pages.dev (ค่าที่บันทึกทับค่าในโค้ด) · ตรวจ punpang.com จากเซสชันนี้ไม่ได้ (proxy บล็อกโดเมน)
**งานค้าง:** WAF ที่ sms.punpang.com (ผู้ใช้ต้องสร้างเอง) · เอกสาร docs ที่ยังเขียน pages.dev (pdpa.md, integrations.md, security.md) · ข้อความตัวอย่างใน ManageLucky.vue ยังเป็น pages.dev · สาขา dev `claude/zen-gauss-5qbmyh` ยังแยกจาก main · ระบบระดับสมาชิก 4 ระดับ: ยังไม่เริ่ม รอผู้ใช้ตอบ

## 2026-11-22 · [SMS][ระบบ] ผู้ใช้สั่ง merge เฉพาะงาน SMS → ย้าย URL เกตเวย์เข้าโค้ดเข้า main · ยังไม่ deploy
- **ทำอะไร:** cherry-pick `80e8a1e` ลง main เฉพาะไฟล์โค้ด SMS (`_shared/gwfetch.ts` ค่า `SMS_GATEWAY_URL` คงที่ · `_shared/sms.ts` · `sms-send` · `customer-auth` เฉพาะส่วน SMS · `scheduled` · เทสต์ sms-send · หน้า ManageSms/ManageIntegrations · docs/integrations.md) · ไม่เอา dev ส่วนระดับสมาชิก/migration/tools
- **เหตุผล:** ผู้ใช้เลือก "merge เฉพาะงาน SMS" · main มี SMS ส่วนใหญ่แล้ว (eab1dd4, cb3d6e5, 8352901) เหลือเฉพาะการย้าย URL · ไม่ย้อนโค้ด SMS ที่ main ใหม่กว่า
- **ผล:** เทสต์ sms-send 23/23 · `_shared` 401/401 · `deno check` sms-send/customer-auth/scheduled ผ่าน · หน้าเว็บ build บน Vercel ตรวจหลัง push
- **รอ:** อนุมัติ deploy `sms-send`, `customer-auth`, `scheduled` แยกต่างหาก (ยังไม่ deploy) · หลัง deploy secret `SMS_GATEWAY_URL` ไม่ต้องใช้แล้ว (ลบเมื่อผู้ใช้สั่ง)
- **งานค้าง:** ลบ `sms-probe` ใน Supabase Dashboard (ผู้ใช้ยังไม่ยืนยัน) · งานระดับสมาชิก (dev) ยังไม่ merge

## 2026-11-22 · [ระบบ][Release] ผู้ใช้เลือกข้อ 1: เพิ่มกฎ push main แบบแคบในเครื่อง · ยังไม่ push

**ทำอะไร:** ตรวจก่อน: ไม่มีโฟลเดอร์ `.claude/` ในโปรเจกต์ (ไม่มี deny ระดับโปรเจกต์) · `origin/main` = `2ae7cb3` และ `origin/claude/zen-gauss-5qbmyh` = `46c2a60` ตรงกับเครื่อง · สร้าง `.claude/settings.local.json` มีกฎ allow เดียว `Bash(git push origin claude/zen-gauss-5qbmyh:refs/heads/main)` (ตรงตัวอักษร) · เพิ่มไฟล์นี้ใน `.git/info/exclude` (ระดับเครื่อง ไม่แก้ `.gitignore` จึงไม่เข้า commit) · ย้าย "ทำขั้น 1" ไป archive ให้ไฟล์หลักไม่เกิน 10 รายการ
**ผล:** ยังไม่ push ไม่ merge ไม่ Release · ตรวจแล้ว: JSON ถูกต้อง · ไฟล์ถูก ignore · git status เห็นเฉพาะไฟล์ worklog
**รอ:** ผู้ใช้สั่ง "merge + Release" อีกครั้ง · กฎยังไม่ได้ทดสอบ (ยืนยันตอน push) · ถ้ากฎไม่มีผลในเซสชันนี้ อาจต้องเปิด /hooks หรือเริ่มเซสชันใหม่ · หลัง push สำเร็จ ลบกฎนี้ออกและแจ้งผู้ใช้

## 2026-11-22 · [Release][DB] ผู้ใช้สั่ง "ทำตามคำแนะนำ" (merge + Release) · merge ถูกปฏิเสธ · ยังไม่ Release

**ทำอะไร:** ตรวจก่อน merge: main `2ae7cb3` เป็นบรรพบุรุษของ dev · ไฟล์ต่างกันเฉพาะ migration/เทสต์/docs/worklog ตามที่คาด · ไม่มี `functions` ต้อง deploy · จากนั้นสั่ง fast-forward main → dev (`f49ccd7`) ระบบความปลอดภัยของ Claude Code (auto mode) ปฏิเสธคำสั่ง push ไป main จึงไม่ได้ทำต่อ และไม่ลองวิธีอื่นเพื่อข้ามการปฏิเสธ
**ผล:** main ยังเป็น `2ae7cb3` · dev ยังเป็น `f49ccd7` · ไม่ได้รัน Release (workflow รันได้เฉพาะจาก main)
**รอ:** ผู้ใช้เลือกวิธี: (1) เพิ่มสิทธิ์ Bash ให้ push main แล้วสั่งใหม่ (2) ผู้ใช้ merge เอง แล้วให้ผม trigger Release · ขั้นตรวจ rollback บน production หลัง Release ยังต้องอนุมัติแยก

## 2026-11-22 · [DB][ลูกค้า] ขั้น 2 (ตามแผนปรับ ข้อ 1): เพดานฐานแต้มก่อน VAT · commit dev · ยังไม่ merge/Release

**ทำอะไร:** ผู้ใช้สั่ง "ทำตามข้อ 1" · migration ใหม่ `20261122100000_punpang_award_exvat_ceiling.sql`: เพิ่ม `punpang__order_goods_exvat` (VAT ใน หารออก สูตรเดียวกับ pointsFor · VAT นอก/ไม่มี VAT = เดิม · ไม่มี mode = ใน) แล้ว `create or replace` `punpang_award_order` โดยเปลี่ยนบรรทัดเพดานบรรทัดเดียว (ตรวจด้วยการเทียบกับต้นฉบับแล้ว) · ปิดท้ายด้วย `punpang_test_sync()` ให้สำเนาโหมดทดสอบตรง public (ตามแพตเทิร์นเดิม) · เทสต์ใหม่ `supabase/tests/points_vat.test.sql` 12 กรณี (PV1–PV12) ต่อใน run.sh · แก้ `docs/vat-refund-buyer.md` บรรทัดข้อ 8
**ผล:** `run.sh` บน Postgres 16 ในเครื่อง ผ่านทั้งชุด (138 migration + ทุกเทสต์ รวม mirror) · เทสต์ PV1 ล้มเมื่อใช้เพดานเดิม (ยืนยันว่าเทสต์จับความต่างได้) · ไม่มีการแก้โค้ดแอป จึงไม่รัน unit/e2e ซ้ำ
**ข้อสังเกต:** production ยังไม่มีออร์เดอร์ที่ให้แต้มเลย (ตรวจก่อนหน้า) จึงยังไม่มีข้อมูลจริงให้เทียบ
**รอ:** อนุมัติ merge และ Release (ดูบรรทัดรอผู้ใช้) · หลัง Release ตรวจ rollback บน production ต้องอนุมัติแยก

## 2026-11-22 · [DB][ลูกค้า] ปรับแผนขั้น 2 หลังตรวจข้อมูลจริง (ยังไม่ทำ)

**ทำอะไร:** ผู้ใช้ถาม "แผนนี้ดีกว่านี้ได้ไหม" · ตรวจ production แบบ SELECT อย่างเดียว: ออร์เดอร์ทั้งหมด 8 บิล ส่งมอบ 3 บิล **ไม่เคยให้แต้มเลย 0 บิล** (อัปเดตล่าสุด 21 พ.ย. 10:43Z) · migration `20261121170000` ปิด B1/B2/B7/B9/B13(order-audit) ไปแล้ว จึงไม่มีงานฐานข้อมูลอื่นให้รวมรอบ Release · ตัวช่วย `punpang__order_goods` นับ Σ unitPrice×qty ไม่หักส่วนลดใดเลย (เพดานหลวมกว่า 7% ของ VAT)
**แผนที่ปรับ:** (1) ตัดการรอ 1 วัน เพราะไม่มีข้อมูลให้เรียนรู้ · เครื่องเก่าเสี่ยงเฉพาะพนักงาน 2 คน ให้รีเฟรชก่อน Release (2) ตรวจหลัง Release ด้วยธุรกรรม rollback 1 สถานการณ์ (บิล VAT ใน 107: ฐาน 107 ถูกปฏิเสธ · ฐาน 100 ผ่าน) ต้องอนุมัติแยก (3) เทสต์ DB เพิ่มกรณีปัดเศษ 0.01 หลายบรรทัด และไม่มี `mode`
**รอ:** ผู้ใช้เลือกทางเดิน (ทำตามแผนปรับ / ทำตามแผนเดิม / ไม่ทำขั้น 2) · ยังไม่แก้โค้ด ไม่ Release

## 2026-11-22 · [ระบบ][LIFF][Cloudflare] ผู้ใช้ยืนยันผ่าน: build main และ LIFF บนมือถือ

**ทำอะไร:** ผู้ใช้แจ้งผลข้อ 1 ผ่าน (build main ใน Cloudflare) และข้อ 2 ผ่าน (LIFF บนมือถือที่ `/line/`) · ผลนี้ผู้ใช้แจ้ง ยืนยันเองจากเซสชันนี้ไม่ได้
**ผล:** main = `2ae7cb3` · งานค้างข้อ 1–2 ปิดแล้ว
**รอ:** ข้อ 5 (ขั้น 2 เพดานก่อน VAT) รอคำสั่ง

## 2026-11-22 · [ระบบ][Cloudflare] ผู้ใช้ทำข้อ 1–2 แล้ว · ตรวจ build main จากเซสชันนี้ไม่ได้

**ทำอะไร:** ผู้ใช้แจ้ง "1 ทำแล้ว 2 ทำแล้ว 5 รอ" · ตรวจ commit `2ae7cb3` ผ่าน GitHub ได้ข้อมูล commit แต่ไม่มีสถานะ build · ลองดู deployment ของ Cloudflare Pages (project cake-order-admin) ได้ข้อผิดพลาด "requires additional permissions" จึงยังไม่รู้ผล build
**ผล:** ยังไม่ทราบผล build ของ main และผลทดสอบ LIFF (ผู้ใช้ยังไม่ได้แจ้งผล)
**รอ:** ผลสองข้อจากผู้ใช้ · ถ้า connector ยังใช้ไม่ได้ ให้เปิดเซสชันใหม่หลังเชื่อมแล้วให้ผมตรวจอีกครั้ง · ข้อ 5 (ขั้น 2) รอ

## 2026-11-22 · [DB][ระบบ] ตรวจ cron punpang-scheduled (อ่านอย่างเดียว) · B13 ใช้ได้แล้ว

**ทำอะไร:** ผู้ใช้ตอบลำดับ: ข้อ 1–2 ยืนยันลำดับ (ยังไม่ทำ) · ข้อ 3 ตรวจ · ข้อ 4 ใช้แผนฟรี ห้ามถามอีก · ข้อ 5 รอ · ตรวจ production ด้วย SELECT อย่างเดียว: migration `20261121160000` อยู่ในรายการ production แล้ว · cron jobid 9 `*/15` active มี `timeout_milliseconds := 30000` · ดัชนี `punpang_customers_phone_digits_uniq` มีบน production
**ผล:** รอบหลังแก้ที่ยังเก็บผลตอบกลับอยู่ทั้งหมดเป็น HTTP 200 ไม่มี timeout: 21 พ.ย. 8 รอบ · 22 พ.ย. (00:00Z ถึงตอนนี้) 16 รอบ · cron status succeeded ทั้งหมด · 28 รอบของ 21 พ.ย. ไม่มีผลตอบกลับเหลือ (pg_net เก็บผลราว 6 ชม.) จึงยืนยันไม่ได้ แต่ไม่ใช่หลักฐานว่าล้ม · timeout 11 รอบ (21 พ.ย. 08:00–13:50Z) เป็นก่อนแก้ ไม่ได้ตรวจซ้ำ
**ข้อ 4:** ปิดงาน ใช้แผนฟรี ยอมรับความเสี่ยง Leaked password protection ไม่ทำ ไม่ถามซ้ำ
**รอ:** ผู้ใช้ทำข้อ 1–2 · ข้อ 5 (ขั้น 2) รอตามที่ผู้ใช้ระบุ

## 2026-11-22 · [ระบบ] ถามลำดับงานค้างหลัง merge (ยังไม่ทำ)

**ทำอะไร:** ผู้ใช้ถาม "ควรทำอะไรก่อน" · ตอบเป็นลำดับ: (1) เชื่อม Cloudflare ใหม่แล้วดู build ของ main `2ae7cb3` (2) ทดสอบ LIFF บนมือถือที่ `/line/` (3) ตรวจงาน `punpang-scheduled` ที่ถูกตัดที่ 5 วินาที (รายงาน 21 พ.ย. พบ 11/24 รอบ) (4) เปิด Leaked password protection ใน Supabase Auth · ขั้น 2 ค่อยทำหลังข้อ 1–2 ผ่าน
**ผล:** ยังไม่ได้แก้อะไร · ไม่ได้ตรวจซ้ำวันนี้ อ้างจากรายงานและสถานะ git ล่าสุด
**รอ:** ผู้ใช้เลือกให้เริ่มข้อ 3 (อ่านอย่างเดียว) หรือไม่
