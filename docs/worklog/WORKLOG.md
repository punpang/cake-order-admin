# บันทึกงาน cake-order-admin

## ดูก่อน (อ่านแค่ส่วนนี้ = Read offset 1, limit 20)
- ล่าสุด 2026-11-22 · main = 8991fac (ระดับสมาชิกอยู่บน main · โหมดปิด) · แก้ป้ายค้าง (POS) รอ push · สาขาทำงาน `claude/member-pos-fix` · production: migration สมาชิก 3 ไฟล์ (Release #21) · customer-auth v75 (Release #22) · sms-send v50 verify_jwt=true · sms-probe verify_jwt=false ยังอยู่ · Cloudflare build ตรวจไม่ได้ (connector ขอสิทธิ์เพิ่ม)
- **รอผู้ใช้:** push patch (POS + docs) เข้า main เอง · ร้านเปิดใช้จริงเองตามคู่มือ (ข้ามทดลอง · อัตรา 25/0.10 และระดับ ร้านตั้งเอง · ข้อ 8 ข้อความยาว) · ตัดสิน `sms-probe`
- **ปิดแล้ว:** B13 cron timeout · B12 ดัชนีเบอร์ลูกค้ามีบน production · B6 แผนฟรี ยอมรับความเสี่ยง ไม่ถามซ้ำ
- งบบันเดิล 882.0/886 KB (เกินให้หยุดถามก่อนขอเพิ่ม) · ค้างไว้: หัวกลุ่มวันที่ตารางผลิตโปร่งแสง 90% (เสนอให้ทึบ)
- URL ทดสอบ (ไม่ใช่ production): https://claude-zen-gauss-5qbmyh.cake-order-admin.pages.dev
- **กติกา:** รายการใหม่อยู่บนสุด (ทำอะไร · ทำไม · รอ) · commit พร้อมงานรอบนั้น (dev เท่านั้น) · compact แล้วต้องจดก่อนทำต่อ
- **ขนาด:** บล็อกนี้ ≤ 3 KB · ไฟล์นี้ ≤ 30 KB หรือ ≤ 10 รายการ · เกินให้ย้ายรายการเก่าไป `WORKLOG-archive-YYYY-MM.md`
- **ป้ายระบบ:** ใส่ในหัวรายการ [ลูกค้า] [LIFF] [ครัว] [POS] [ออร์เดอร์] [SMS] [Release] [DB] [ระบบ] · ค้นงานระบบเดียว: `grep -n '\[ครัว\]' docs/worklog/*.md`
- **การถามผู้ใช้:** ถามเป็นข้อ ๆ (หน้าต่างคำถาม) ข้อละ 2–4 ตัวเลือก · ตัวเลือกที่ดีที่สุดอยู่ข้อแรกพร้อม "(แนะนำ)" และเหตุผลสั้น ๆ · ถามเฉพาะเรื่องที่ผู้ใช้ต้องตัดสิน

---

## 2026-11-23 · [Release][DB][POS][ลูกค้า] รวมงาน Telegram POS + ตัดเตือนนัดรับ + จอลูกค้าแสดงสมาชิก · merge main + Release รอนุมัติ

**ทำอะไร:** commit `12fbaf2` (แจ้งทีม Telegram เมื่อ POS ปิดบิล/ยกเลิก/แลกคืนเงิน/ปิดบิลมีส่วนลด · ตัดเตือนนัดรับ · จอลูกค้าแสดงแถบสมาชิก) + แก้ `displayMember` ไม่ให้ขึ้น "ระดับสูงสุด" เมื่อป้ายยังเป็น RPC รุ่นเดิม · migration `20261123100000_punpang_member_card_progress.sql` (ป้ายระดับมี nextName/toNext/pct)
**เหตุผล:** ผู้ใช้สั่ง merge deploy ทั้งหมดที่ค้าง · production `memberLevels` เป็น live อยู่แล้ว → ถ้าเว็บขึ้นก่อน migration จอลูกค้าจะแสดงชื่อระดับโดยไม่มีหลอด จึงให้โค้ดทนกรณีนี้ก่อน
**ผล:** `npm test` 100 ไฟล์ผ่าน · build ผ่าน · bundle 884.4 / 886 KB · `run.sh` บน Postgres 16 ท้องถิ่นผ่านทั้งชุด · หน้า /display ทดสอบ 7 สถานะ ไม่มีชื่อ/เบอร์เต็ม
**รอ:** Release (migration `20261123100000` + function 8 ตัว: customer-order, fb-webhook, order-audit, order-create, quote-create, scheduled, tax-invoice, tungngern-receiver + sms-send) รออนุมัติ environment production บน GitHub · หลัง Release ลบแถว `pickup_reminder` ใน `notifyRules` และ `pickupRemindHours` ใน `shop`
**งานค้าง:** ลบ edge function `sms-probe` ใน Supabase Dashboard (เครื่องมือที่มีลบไม่ได้) · สาขา `claude/zen-gauss-5qbmyh` 31 commit ยังไม่ merge (ชนไฟล์ 12+ ไฟล์ รวม migration ที่รันบน production แล้ว) รอผู้ใช้ตัดสิน

---

## 2026-11-22 · [POS][ลูกค้า] ป้ายระดับสมาชิกไม่ค้างตอนสลับลูกค้า (บรรทัดเดียวจาก phase1) · ตัดสินก่อนเปิดใช้จริงครบ · ส่ง patch ให้ผู้ใช้ push

**ทำอะไร:** `Pos.vue` รีเซ็ตป้ายระดับเป็นค่าว่างก่อนโหลดการ์ดของสมาชิกคนใหม่ (บรรทัดเดียวจาก `claude/member-tiers-phase1`) · `docs/loyalty-tiers.md` ปรับสถานะให้ตรง Release #21–#22 · ใช้ค่าที่ร้านจะตั้ง: อัตรา 25/0.10 · ระดับ 0/500/1,500/3,000 · ตัวคูณ ×1/×2/×3/×5 · ขั้นตอนเปิดใช้ 5 ขั้น · คู่มือร้านเขียนใหม่ 4 ขั้น · ย้ายรายการเก่า 1 รายการไป archive (เหลือ 9)
**เหตุผล:** ผู้ใช้ตอบ: ข้ามทดลอง เปิดใช้จริงเลย · อัตราแต้ม 25 บาท = 1 แต้ม · 10 แต้ม = 1 บาท (ร้านตั้งเองในหน้า ไม่แก้โค้ด/SQL) · ระดับ LV2–LV4 เริ่ม 500 / 1,500 / 3,000 · ตัวคูณ ×2 / ×3 / ×5 (LV4 ยืนยันแล้ว 2026-11-23 · เดิมตอบ ×4) · ส่งเป็น patch ให้ผู้ใช้ push เอง · ข้อ 8 ใช้ข้อความยาว · แต้มจริงคิดที่เซิร์ฟเวอร์ (`memberMultFor` → `punpang_member_preview`) ป้ายค้างจึงกระทบการแสดงผลอย่างเดียว
**ผล:** `npm test` 95 ไฟล์ผ่าน · `npm run build` ผ่าน · `test:bundle` 882.3 / 886 KB · e2e `creditCoupons.ui` ผ่านทุกกรณี (รวม POS สแกนสมาชิก) · ฐานข้อมูล production ไม่แตะ (โหมดปิด อัตราเดิม) · รอบนี้แก้เฉพาะเอกสาร ตรวจกับโค้ดแล้ว (ชื่อเมนู ปุ่ม ช่องกรอก ข้อความ PDPA ข้อ 2/3/7 และข้อ 8) · **ยังไม่ push main:** ระบบความปลอดภัยของ Claude Code (auto mode) ปฏิเสธคำสั่ง push จึงไม่ลองทางอื่น · commit นี้อยู่ในเครื่องเท่านั้น
**รอ:** (1) ผู้ใช้ push patch เข้า main เอง → deploy ผ่าน · (2) ร้านประกาศข้อ 2/3/7 และข้อ 8 (ข้อความยาว) ใน ManageLegal · (3) ร้านแปลงแต้มค้าง แล้วตั้งอัตรา 25/0.10 และระดับ → บันทึก → แท็บระดับ ใช้จริง → บันทึก · (4) ตรวจป้ายที่ POS หลังเปิดใช้จริง (สมาชิก 2 คนที่ระดับต่างกัน · โหมดปิดไม่มีป้าย) ถ้ายังค้างให้หยุดใช้จริง
**งานค้าง:** ลูกค้านับยอดตั้งแต่วันเปิดใช้จริง ไม่มีการย้อนนับ · ค่าตั้งต้นในโค้ด/SQL ยังค่าเดิม (แก้ต้องมี migration + Release อนุมัติแยก) · มูลค่า 1 แต้มกระทบแต้มค้างด้วย แปลงเป็นคูปองก่อนตั้ง 0.10 · ราคาแต้มไม่ปรับ (รอร้าน) · ข้อ 7 ระยะเก็บรอการตัดสิน (งานลบอัตโนมัติที่มีอยู่ไม่ครอบคลุมข้อมูลสมาชิก) · เฟส 2–3 ยังไม่เริ่ม

---

## 2026-11-22 · [Release][DB][ลูกค้า] ระดับสมาชิก: merge เข้า main + Release #22 (customer-auth v75) · ตรวจ rollback production ผ่าน

**ทำอะไร:** ผู้ใช้สั่ง "ทำเลยทุกข้อ" · merge `claude/member-tiers-phase1` → main (`aa1507f..90b8ac9`) · CI main ผ่าน (`45036841535`) · Release #22 (`45036845443`) ผ่านทุกขั้น test · release · deploy customer-auth → v75 verify_jwt=false · ตรวจ rollback บน production ผ่าน · e2e `routes.smoke` ล้มเหลวเพราะ node_modules ของ worktree เป็น symlink นอก root ของ Vite → เปลี่ยนเป็นสำเนา hardlink (`cp -al`) แล้วผ่าน 69/69 · ประกาศความเป็นส่วนตัวข้อ 2: เพิ่มแถว 'สมาชิก (ระดับ)' ฐาน 'สัญญา' ตามที่ผู้ใช้ยืนยัน (`docs/pdpa.md`)
**เหตุผล:** ผู้ใช้อนุมัติ merge + deploy และขอให้ตรวจ rollback ก่อนเปิดโหมดทดลอง · การเปิดโหมดทดลองยังต้องอนุมัติแยก
**ผล:** test และ release ผ่าน · production (ตรวจอย่างเดียว): โหมด `off` (ไม่มีแถว config) · `punpang_member_events` = 0 · ลูกค้า 2 · ออร์เดอร์ 10 · สิทธิ์แอดมินครบทั้งสองคน · ไม่มีข้อมูลค้างหลังตรวจ
**รอ:** อนุมัติเปิดโหมดทดลอง (shadow) แยกต่างหาก · ถ้อยคำข้อ 8 ManageLegal และอัตรา 10/0.10 ก่อนใช้จริง · `sms-probe` (v5 verify_jwt=false ไม่ได้มาจากรอบนี้ ไม่มีโค้ดในรีโป): ผู้ใช้เลือกลบใน Supabase Dashboard เอง ยังไม่ยืนยันว่าลบแล้ว
**งานค้าง:** `/push2.log` ผู้ใช้ลบเอง (`rm -f /push2.log`) · ประกาศข้อ 3 ยังไม่มีระยะเก็บของ 'สมาชิก (ระดับ)' (ยังไม่ทำ รอคำสั่ง) · `docs/loyalty-tiers.md` ขั้นเปิดใช้ข้อ 1 ยังเป็นแผน · เฟส 2–3 ตามเดิม

---

## 2026-11-22 · [Release][DB][ลูกค้า] ระดับสมาชิก: Release #21 สำเร็จ (3 ไฟล์) · ตรวจ production อ่านอย่างเดียวผ่าน

**ทำอะไร:** ผู้ใช้เลือก "รัน 3 ไฟล์" · สั่ง Release run #21 บน main (`45034731976`, head `aa1507f`) `confirm=RUN` · `db_migrations` = `110000 110100 110200` · `functions` ว่าง · environment production อนุมัติแล้ว · อ่าน production อย่างเดียว (SELECT): `schema_migrations`, ฟังก์ชัน/ตารางสมาชิก, config/memberLevels
**เหตุผล:** `20261122100000` ถูกบันทึกบน production แล้วจาก run #19 (04:10Z) จึงไม่รันซ้ำ · run #20 ทั้งสองครั้งถูกขั้นตรวจปฏิเสธก่อนรัน migration (ไม่มีการเปลี่ยน DB)
**ผล:** test ผ่าน · release ผ่านทุกขั้น: ตรวจ → รัน 3 ไฟล์ในธุรกรรมเดียว → บันทึกประวัติ · deploy ฟังก์ชันข้าม (ไม่ได้ระบุ) · log ไม่มี ERROR (NOTICE ปกติ: ข้ามของที่ไม่มี · mirror `punpang_test` ข้ามฟังก์ชันที่ยังอ้าง public) · production: `schema_migrations` ครบ 4 เวอร์ชัน (รวม 100000) · ฟังก์ชันที่ตรวจ 14 ตัวมีครบ ตัวละ 1 · `punpang_award_order` บันทึก `punpang_member_events` แล้ว · ตาราง `punpang_member_events` มีแล้ว · ไม่มีแถว memberLevels → โหมด `off` (ค่าเริ่มต้นในโค้ด)
**รอ:** อนุมัติ merge `claude/member-tiers-phase1` → main และ deploy customer-auth · อนุมัติตรวจ rollback บน production ก่อนเปิดโหมดทดลอง
**งานค้าง:** ถ้อยคำข้อ 8 ManageLegal และอัตรา 10/0.10 (ตอนเปิดใช้จริง) · ประกาศความเป็นส่วนตัวข้อ 2 (ยังไม่ตัดสิน ยังไม่แก้) · `docs/loyalty-tiers.md` ขั้นเปิดใช้ข้อ 1 ยังเป็นแผน (ยังไม่อัปเดตผล)

---

## 2026-11-22 · [Release][DB][ลูกค้า] ระดับสมาชิก: ผู้ใช้ตอบตามข้อแนะนำทั้ง 4 ข้อ · Release รอวิธีนำไฟล์ขึ้น main

**ทำอะไร:** แก้ `docs/loyalty-tiers.md` ตามคำตอบ: (1) ถ้อยคำบัตรสิทธิ์พัก/วันทอง ใช้ข้อความปัจจุบันไปก่อน (2) ข้อ 8 ManageLegal เพิ่มตอนเปิดใช้จริงหลังยืนยันถ้อยคำ (ยังไม่แก้) (3) Release ก่อน merge (4) คงอัตรา 20/0.20 จนถึงเปิดใช้จริง · ตรวจก่อนตอบ: `release.yml` รันได้เฉพาะจาก main และต้องมีไฟล์ migration บน main · `20261122100000` อยู่บน main แล้ว เหมือนกันทุกสาขา · ฟังก์ชัน award ของสาขานี้คงเพดานก่อน VAT ครบ (ต่างจาก main เฉพาะส่วนสมาชิก) · dev มีเลขเวอร์ชัน migration ซ้ำ 2 เลข (110000, 110100) ห้ามรวม dev เข้า main
**เหตุผล:** อัตรา 20/0.20 กับ 10/0.10 ให้มูลค่า 1% ต่อบาทเท่ากัน รายงานต้นทุน % จึงไม่เปลี่ยน · เปลี่ยนตอนนี้โดยไม่แปลงแต้มคงค้างทำให้มูลค่าแต้มที่ลูกค้าถือลดครึ่งหนึ่ง · ของแลก/กาชา/สิทธิ์หมุนที่ตั้งเป็นแต้มต้องพิจารณาปรับด้วย
**ผล:** แก้เฉพาะเอกสาร · ไม่มีโค้ด/DB/production · ยังไม่ merge · ยังไม่ Release · ยังไม่ deploy customer-auth
**รอ:** ผู้ใช้เลือกวิธีนำไฟล์ migration ขึ้น main ก่อน Release และยืนยันว่ารวม `20261122100000` ด้วย (ตามบันทึกยังไม่ Release · ยังไม่ตรวจ production)
**งานค้าง:** ประกาศความเป็นส่วนตัวหัวข้อ 2 (ยังไม่ตัดสิน ยังไม่แก้) · เฟส 2–3 ตามเดิม

---

## 2026-11-22 · [DB][ระบบ] ระดับสมาชิก: แท็บระดับแสดงต้นทุน 2 ค่า (ส่วนเพิ่ม/สูตรเต็ม) · กฎสื่อสารใช้ข้อความปัจจุบันชั่วคราว

**ทำอะไร:** `punpang_member_report` เพิ่ม `fullCostPct` ต่อระดับและแถวรวม (แก้ migration `20261122110200` ซึ่งยังไม่ Release) · แท็บ "ระดับ": รายงานและตัวจำลองแสดงต้นทุน 2 ค่า (ส่วนเพิ่ม · สูตรเต็ม) · `levelCost` คืนค่า `fullCostPct` · เทสต์ใหม่ DB R4b และ `memberLevels.test.mjs` · อัปเดต docs/loyalty-tiers.md
**เหตุผล:** ผู้ใช้เลือก "แสดงทั้งสองค่า" ตามข้อเสนอแนะ · ผู้ใช้เลือก "ใช้ข้อความปัจจุบันไปก่อน" สำหรับกฎสื่อสาร 3 บรรทัด (หาในเอกสารรีโปไม่พบ)
**ผล:** `npm test` 95 ไฟล์ผ่าน · `memberLevels.test.mjs` ผ่านทั้งหมด · build ผ่าน · `test:bundle` 882.4 / 886 KB · `test:db` ผ่านทั้งชุด (R4 · R4b · member_levels · member_staff · mirror) · ไม่ได้รัน e2e ซ้ำ (ค้นแล้วไม่มีเทสต์ใดอ้างแท็บนี้) · ยังไม่ได้เปิดแท็บในเบราว์เซอร์
**รอ:** ผู้ใช้ตัดสิน 4 ข้อ: (1) ถ้อยคำบรรทัดสิทธิ์พัก/วันทองของบัตรระดับ (2) ร่างถ้อยคำ ManageLegal ข้อ 8 (ยังไม่แก้) (3) อนุมัติ merge + Release 3 migration + deploy customer-auth (4) ตั้งอัตรา 10 / 0.10 ก่อนใช้จริง
**งานค้าง:** ยังไม่มีเทสต์ e2e ของแท็บระดับ · เฟส 2–3 ตามเดิม

## 2026-11-22 · [ลูกค้า][POS][DB] ระดับสมาชิก เฟส 1 (หน้าจอ): แท็บระดับ ป้าย POS การ์ดลูกค้า · โหมดเริ่มต้นปิด · ไม่ merge ไม่ Release

**ทำอะไร:** แท็บ "ระดับ" ในคะแนน & รางวัล (`ManageTiers.vue` โหลดแบบ lazy: โหมด · ระดับ/ตัวคูณ · รอบสมาชิก · รายงาน · ตัวจำลองต้นทุน) · `src/lib/memberLevels.js` (ค่าเริ่มต้น ตรวจค่าให้ตรง SQL ข้อความบัตร ต้นทุน) · `src/lib/memberRemote.js` + migration `20261122110200` (`punpang_member_staff_card` `punpang_member_quote` `punpang_member_report` เฉพาะผู้จัดการ) · POS: ป้ายระดับ และแต้มที่จะได้ (เฉพาะใช้จริง) · บัญชีลูกค้า: การ์ดระดับ (เฉพาะใช้จริง) · `store.js`: ขอตัวคูณจาก `punpang_member_preview` ก่อนให้แต้ม · customer-auth แนบ `tier` (allow-list ไม่มียอดสะสม ล้มเหลวเป็นปิด) · งบบันเดิล 876 → 886 KB · `docs/loyalty-tiers.md` ใหม่ (แทนฉบับ dev เดิม)
**เหตุผล:** ผู้ใช้สั่ง "เริ่มเลย" (ไม่ merge · ไม่ Release · ไม่แตะ production) · ลูกค้าเห็นระดับเฉพาะโหมดใช้จริง · เซิร์ฟเวอร์คิดตัวคูณเอง หน้าจอแสดงผลอย่างเดียว
**ผล:** `npm test` 95 ไฟล์ผ่าน · `build` ผ่าน · `test:bundle` 882.1 / 886 KB · Deno 634 ผ่าน 0 ไม่ผ่าน · `test:db` ผ่านทั้งชุด (รวม member_levels, member_staff, mirror) · `test:e2e:ci` จบโดยไม่มีรายการไม่ผ่าน · visual (`e2e/visual.e2e.mjs`) ผ่าน 5 หน้า ไม่ได้อัปเดตภาพอ้างอิง · **ต้นทุนในหน้าจอคิดเฉพาะส่วนเพิ่ม (x3 = 0.8%)** ต่างจากเอกสาร dev เดิมและแผน (สูตรเต็ม x3 = 1.2%)
**รอ:** ผู้ใช้ตัดสิน 6 ข้อ: (1) สูตรต้นทุน ส่วนเพิ่มหรือสูตรเต็ม (2) ถ้อยคำบัตรระดับ สิทธิ์พัก/วันทอง (3) ความหมาย "กฎสื่อสาร 3 บรรทัด" (หาในเอกสารรีโปไม่พบ) (4) ถ้อยคำ ManageLegal ข้อ 8 (ยังไม่แก้) (5) อนุมัติ merge + Release 3 migration + deploy customer-auth (6) ตั้งอัตรา 10 / 0.10 ก่อนใช้จริง
**งานค้าง:** เฟส 2 (สิทธิประโยชน์ เดือนเกิด โหมดคูปองใหม่) · เฟส 3 (ข้อความอัตโนมัติ ด่านหน้าจ่ายเงิน) · รายงานต้องรอข้อมูลจากโหมดทดลอง

## 2026-11-22 · [DB][ลูกค้า] ระดับสมาชิก เฟส 1 (ฐานข้อมูล): เครื่องยนต์ระดับ + ตัวคูณแต้ม · โหมดเริ่มต้นปิด · ไม่ merge ไม่ Release

**ทำอะไร:** เริ่มใหม่จาก origin/main `8f86305` บนสาขา `claude/member-tiers-phase1` (ไม่ต่อจาก dev เดิม `80e8a1e`) · migration `20261122110000_punpang_member_levels.sql`: ตาราง `punpang_member_events` (เพิ่มอย่างเดียว · ลบได้เฉพาะตอนลบข้อมูลลูกค้า), ตั้งค่า `config/memberLevels` (off/shadow/live, ค่าเริ่มต้น LV1–LV4), คำนวณระดับรายวัน (ต่ออายุเมื่อยอดวันถึง 150 ก่อน VAT · Active 90 วัน · พักสิทธิ์ 91–364 · โปรทอง 91–104 · ลดขั้นทุก 365 วันจนถึง LV1), ทริกเกอร์ถอนยอด/ย้ายผู้ซื้อ/ลบลูกค้า, RPC `punpang_member_preview` และ `punpang_member_card` (service_role) · migration `20261122110100_punpang_member_award_cap.sql`: `punpang_award_order` คิดตัวคูณ · เพดานแต้มคูณตัวคูณเฉพาะโหมดใช้จริง · บันทึกยอดคู่กับการให้แต้ม · เทสต์ `member_levels.test.sql` 60 กรณี ต่อใน run.sh · mirror นับ 27 ตาราง · ตัด toNext ออกจากบัตรระดับ · วันครบ 365 วัน: บิลต่ออายุใช้ตัวคูณระดับก่อนลด (preMult)
**เหตุผล:** ผู้ใช้สั่ง "เริ่มใหม่" และ "ทำเลย" ตามแผนเฟส 1 · โหมด off/shadow/live ให้เปิดทดลองก่อนคูณจริง · เก็บยอดสะสมฝั่งเซิร์ฟเวอร์ เพราะ `customer.data` ส่งให้ลูกค้าทั้งก้อน · เซิร์ฟเวอร์คิดตัวคูณเอง เพราะถ้าแค่ยกเพดานเป็น 10 พนักงานจะให้ x10 กับทุกระดับได้
**ผล:** `run.sh` ผ่านทั้งชุด EXIT=0 (migration 140 ไฟล์ · security · ... · points_vat · member_levels 60/60 · mirror) · ตรวจแล้ว test.ok ล้มเมื่อเงื่อนไขไม่จริง · โหมดปิดไม่เปลี่ยนแต้มเดิม (points_vat ผ่าน) · ไม่แก้โค้ดแอป จึงไม่รัน unit/e2e/build · ไม่ merge/Release · ไม่แตะ production
**รอ:** ผู้ใช้อนุมัติแล้ว: push ไป `claude/member-tiers-phase1` · งบบันเดิล +10 KB (ใช้ตอนทำ frontend) · ตัด toNext · วันครบ 365 ใช้ระดับก่อนลด · นับ 90 วันจากวันซื้อแรก · ยังรอ: สั่งเริ่ม frontend
**งานค้าง:** frontend ระดับ (`src/lib/memberLevels.js`, แท็บ "ระดับ" ใน ManageLoyalty, ป้ายใน POS, การ์ดในบัญชีลูกค้า, customer-auth ส่งบัตรระดับ) · `punpang_member_report` (รายงานโหมดทดลอง) · อัตราแต้ม 10 บาท = 1 แต้ม (0.10 บาท) ผ่านหน้าตั้งค่า · docs/loyalty-tiers.md และถ้อยคำข้อ 8 บน ManageLegal (ผู้ใช้ยืนยันก่อนเปิดใช้จริง) · ตรวจ production แบบ rollback และ Release ต้องอนุมัติแยก

## 2026-11-22 · [ระบบ][LIFF][ลูกค้า] ย้ายลิงก์หลักเป็น punpang.com: Worker, เมนู ถุงเงิน, เมนูใน LINE, ลิงก์สุ่มรางวัล · อยู่บน main แล้ว

**ทำอะไร:** ตั้งค่า ALLOWED_ORIGINS ของ punpang-files ใน `worker/wrangler.jsonc` ให้มี punpang.com และ www.punpang.com (ตรงกับ dashboard) · เอาการซ่อนเมนู "ถุงเงิน" ออก (`src/lib/adminSystems.js`) · MENU_URL ของบอท LINE (`supabase/functions/_shared/lineliff.ts`) และ LUCKY_SITE_URL (`src/lib/luckyDraw.js`) เป็น punpang.com · deploy Worker punpang-files (run #4), line-webhook (run #6), line-link (run #6) สำเร็จ · ผู้ใช้ลบ Worker `sms-tls-probe` และเพิ่ม www.punpang.com ใน Turnstile กับ ALLOWED_ORIGINS ใน dashboard แล้ว · commit `262c98d` `d05e6b8` `2cf9d35` `cde7b68` `ce61551`
**เหตุผล:** เว็บใช้ punpang.com เป็นโดเมนหลัก · ค่าใน `wrangler.jsonc` ทับค่า dashboard ทุกครั้งที่ deploy จึงต้องเก็บให้ตรงกันในไฟล์ · ผู้ใช้สั่ง "merge deploy" และ "ทำเลย"
**ผล:** deploy-worker run #4 (`cde7b68`) และ run #5 (`7733361`), deploy-line-webhook และ deploy-line-link run #6 (`2cf9d35`) สำเร็จ · หลัง run #5 Worker อนุญาต www.punpang.com แล้ว (ก่อนหน้านั้น Worker ตอบ CORS เป็น pages.dev สำหรับ www) · โดเมนอื่นในรายการไม่เปลี่ยน · CI บน main สำเร็จ (`cde7b68`) · ผู้ใช้ยืนยันว่าล็อกอินและส่ง SMS ได้แล้ว
**รอ:** ไม่มี · ผู้ใช้ตรวจ 4 ข้อบน punpang.com เรียบร้อยแล้ว (เมนูถุงเงิน, อัปโหลดรูป/สลิปทั้งสองโดเมน, เมนูบอท LINE, ลิงก์สุ่มรางวัล)
**งานค้าง:** WAF ที่ sms.punpang.com (ผู้ใช้ต้องสร้างเอง) · เอกสาร docs ที่ยังเขียน pages.dev (pdpa.md, integrations.md, security.md) · ข้อความตัวอย่างใน ManageLucky.vue ยังเป็น pages.dev · สาขา dev `claude/zen-gauss-5qbmyh` ยังแยกจาก main · ระบบระดับสมาชิก 4 ระดับ: ยังไม่เริ่ม รอผู้ใช้ตอบ

## 2026-11-22 · [SMS][ระบบ] ผู้ใช้สั่ง merge เฉพาะงาน SMS → ย้าย URL เกตเวย์เข้าโค้ดเข้า main · ยังไม่ deploy
- **ทำอะไร:** cherry-pick `80e8a1e` ลง main เฉพาะไฟล์โค้ด SMS (`_shared/gwfetch.ts` ค่า `SMS_GATEWAY_URL` คงที่ · `_shared/sms.ts` · `sms-send` · `customer-auth` เฉพาะส่วน SMS · `scheduled` · เทสต์ sms-send · หน้า ManageSms/ManageIntegrations · docs/integrations.md) · ไม่เอา dev ส่วนระดับสมาชิก/migration/tools
- **เหตุผล:** ผู้ใช้เลือก "merge เฉพาะงาน SMS" · main มี SMS ส่วนใหญ่แล้ว (eab1dd4, cb3d6e5, 8352901) เหลือเฉพาะการย้าย URL · ไม่ย้อนโค้ด SMS ที่ main ใหม่กว่า
- **ผล:** เทสต์ sms-send 23/23 · `_shared` 401/401 · `deno check` sms-send/customer-auth/scheduled ผ่าน · หน้าเว็บ build บน Vercel ตรวจหลัง push
- **รอ:** อนุมัติ deploy `sms-send`, `customer-auth`, `scheduled` แยกต่างหาก (ยังไม่ deploy) · หลัง deploy secret `SMS_GATEWAY_URL` ไม่ต้องใช้แล้ว (ลบเมื่อผู้ใช้สั่ง)
- **งานค้าง:** ลบ `sms-probe` ใน Supabase Dashboard (ผู้ใช้ยังไม่ยืนยัน) · งานระดับสมาชิก (dev) ยังไม่ merge
