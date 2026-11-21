# รายงานตรวจสอบทั้งระบบ (2026-11-21)

ฐานโค้ด: main `b1aca1b` (หลัง Release #11–#16 · เทสต์กะ POS/หน้าตั้งค่า · B10 รอบ 2 · order-create ใช้สำเนาทดสอบ) · Release #17 รอ Approve (งาน test ผ่าน · ยังไม่ deploy) · production: Supabase + Cloudflare Pages · ตรวจแบบอ่านอย่างเดียว ยกเว้นข้อ 3 (ธุรกรรมที่ยกเลิก ไม่ทิ้งข้อมูล · รันซ้ำ 3 รอบ: 21 พ.ย. 13:57Z · ~15:57Z หลัง Release #14 · 17:17Z)

## สรุป
- ทุกชุดเทสต์ผ่านทั้งหมด (unit 92 ไฟล์ · Edge Function (`test:fn`) 181 เทสต์ · e2e เต็มชุด `test:e2e:ci` exit 0 ไม่มี FAIL (รวม settingsCrud 4 · settingsPages 6 · settingsRisk 6) · DB 23 ไฟล์บน Postgres จริง รวม `shifts_guard` · CI main #327 (`b1aca1b`) สำเร็จทั้ง run)
- production ตรงกับโค้ดที่ทดสอบ: migration 137/137 · Edge Function 24/24 · โครงสร้างฐานข้อมูลตรงทุกหมวดที่เทียบ (11 หมวด) หลังตัดความต่างของแพลตฟอร์มและเวอร์ชัน PG (ข้อ 2) · ความต่างที่เหลือ: MAINTAIN ของ PG 17 (128 รายการ) · พาร์ทิชัน realtime ของแพลตฟอร์ม (7 แถว) · B14
- ทดสอบพฤติกรรมบน production แบบยกเลิกธุรกรรม: 13:57Z 38 ข้อ ผ่านทั้งหมด · 17:17Z 39 ข้อ ผ่าน 38 (ข้อที่ไม่ผ่านตั้งเงื่อนไขผิด ยืนยันด้วยชุดแยกแล้ว) · รอบ ~15:57Z ตามข้อ 3 · ไม่มีข้อมูลค้าง (ข้อ 3)
- ไม่พบฟังก์ชันที่ใช้ไม่ได้ในสิ่งที่ตรวจ · ช่องว่าง 13 ข้อ (B1–B14 ไม่มี B11 · B11 ย้ายไปข้อ 6): แก้แล้ว 9 ข้อ (B1, B2, B3, B4, B5, B7, B9, B12, B13) · แก้บางส่วน 1 (B10) · ยังไม่ได้ตรวจซ้ำ 1 (B6) · ตรวจแล้วยังไม่ปิด 1 (B8) · ข้อมูลอ้างอิง 1 (B14) · **รออนุมัติ 1: Release #17 (ข้อ 11)** · ดูข้อ 4 และ 10–11
- **รับประกัน "100%" ไม่ได้** · รายงานนี้บอกว่าแต่ละส่วนผ่านการตรวจชั้นไหน และช่องไหนไม่ได้ตรวจ (ข้อ 4)

## 1. ผลตามชั้นการตรวจ
| ชั้น | วิธี | ผล |
|---|---|---|
| Unit | `npm test` | 92 ไฟล์ ผ่านทั้งหมด |
| Build + งบขนาด | `npm run build` + `bundle-budget` | 870.5 / 872 KB ผ่าน |
| Edge Function (Deno) | ทุกโฟลเดอร์ใน `supabase/tests/functions` (รันในเครื่อง) | 181 เทสต์ (`test:fn` หลัง `b1aca1b`) ผ่าน 0 ล้ม · CI รัน `_shared`, customer-auth และตรวจชนิดข้อมูลทุกฟังก์ชันด้วย |
| e2e | `npm run test:e2e:ci` เต็มชุดในเครื่อง (รอบ 16:31–16:38Z หลังเพิ่ม settingsCrud/Pages/Risk) · ยังไม่รันใน CI (CI รันเฉพาะเมื่อสั่งเอง) | exit 0 · ไม่มี FAIL (smoke 69 หน้า · มือถือ 375px 66 หน้า · a11y 8 หน้า · สิทธิ์ตามบทบาท 135 การเปิดหน้า · XSS 4 · ดับเบิลคลิก 2 · แจ้งเตือน/สรุปประจำวัน 6 · ลูกค้า lazy 10 · POS/ชำระเงิน/บัญชี 5 · เส้นทางลูกค้า 3 · คูปอง/แต้ม 2 ชุด · หน้าตั้งค่า 16 กรณี: settingsCrud 4 · settingsPages 6 · settingsRisk 6) |
| DB บน Postgres จริง | `supabase/tests/run.sh` (Postgres 16 ในเครื่อง) | migration 137 ไฟล์ + 23 ไฟล์ทดสอบ (รวม `shifts_guard`) ผ่านทั้งหมด |
| CI | main #327 (`b1aca1b`) | สำเร็จทั้ง run |

## 2. production แบบอ่านอย่างเดียว
| หัวข้อ | ผล |
|---|---|
| Migration | 137/137 ตรง repo (md5 ของรายการเวอร์ชันเท่ากันทั้งสองฝั่ง · ล่าสุด `20261121190000`) |
| Edge Function | 24/24 ACTIVE ชื่อตรง repo · ฟังก์ชันที่ B4/B5 ระบุ (8 ตัว) deploy จาก main แล้ว (Release #14 และ #15) · ยืนยัน version และ verify_jwt หลัง Release #15 แล้ว (ข้อ 10) · เทียบซอร์สจริง `customer-loyalty` ตรง |
| โครงสร้าง DB (public + punpang_test) เทียบกับฐานอ้างอิงจาก migration (วิธีและข้อยกเว้นดูข้อ 8) | column 530/530 · constraint 152/152 · policy 121/121 · trigger 78/78 · relation (ตาราง/วิว/RLS) 82/82 · view 15/15 · function 215/215 (ไม่นับ `rls_auto_enable` ที่มีทั้งสองฝั่ง · ตัดคอมเมนต์และช่องว่างก่อนเทียบ · ดู B14) · index 176/176 (ปรับ `extensions.gin_trgm_ops` ให้เป็นรูปเดียวกันทั้งสองฝั่ง) · publication 10/10 (public + punpang_test) · production มีเพิ่ม 7 แถวของพาร์ทิชัน `realtime.messages_2026_11_18` ถึง `_24` ของแพลตฟอร์ม · สิทธิ์ตาราง 1203/1203 (ไม่นับ MAINTAIN) · production มี MAINTAIN อีก 128 รายการ (มีเฉพาะ PG 17) · สิทธิ์ execute ฟังก์ชัน 501/501 · production = PG 17.11, ฐานอ้างอิง = PG 16.15 |
| โค้ด ↔ DB | RPC 29/29 · ตาราง 30/30 · trigger 12/12 มีบน production · ตาราง LINE 2 ตารางในสคีมาทดสอบ แก้แล้วใน Release #12 (B2) |
| Cron | 5 งาน active (งานลบกล่องเข้าเปลี่ยนชื่อเป็น `punpang-tungngern-inbox-purge` แล้ว) · `manee-inbox-purge` ล้ม 2 ครั้ง (15–16 พ.ย.) แก้แล้ว · `punpang-scheduled` ไม่มีประวัติรันตั้งแต่สร้างใน Release #11 (14:14Z) จนถึง 15:00Z แล้วรันสำเร็จ และได้ 200 ทั้งรอบ 15:00 และ 15:15 (ดู B13) |
| คิวผู้จัดการ | 0 แถว (ยืนยันหลังรอบ 17:17Z ด้วย) |
| Vault / pg_net | มี `push_send_key`, `scheduled_key` · pg_net ตอบ 200 ×50 / 404 ×4 / timeout ×11 (B13) |
| Log 24 ชม. | function_logs ไม่มี error · Postgres ERROR 4 (2 จากเครื่องมือของเรา · 2 จาก anon) · edge ≥400: ดู B1, B8 |
| Advisor ความปลอดภัย | ไม่มีตารางปิด RLS · 13 ตาราง RLS ไม่มี policy (token/session/OTP/ตัวนับ ตั้งใจ) · SECURITY DEFINER ที่ authenticated เรียกได้ 33 ตัว (นับก่อน Release #12): 28 อ้างตัวตน/สิทธิ์ในโค้ด (ตรวจด้วย regex) · อีก 5 = สาธารณะตั้งใจ 4 + ปลดระวาง 1 (B7 · เพิกถอน execute แล้วใน Release #12) · Leaked password protection ปิด (B6) |
| Advisor ประสิทธิภาพ | multiple permissive policies 7 (kv/items/records) · index ซ้ำ 2 คู่ (เฉพาะ punpang_test) · index ไม่ใช้ 21 (INFO) |

## 3. production แบบธุรกรรมที่ยกเลิก (รันซ้ำ 3 รอบ · ไม่มีข้อมูลค้าง)
รันในบล็อก `DO` เดียวที่จบด้วย `RAISE EXCEPTION` จึงยกเลิกทั้งหมด · ข้อมูลทดสอบขึ้นต้น `QA-` และสร้างในธุรกรรมเท่านั้น · `net.http_post` เพียงแทรกแถวเข้าคิวในธุรกรรมเดียวกัน จึงไม่มีการแจ้งออกจริง · ตัวนับเลขเอกสารเป็นตาราง จึงไม่กินเลขเอกสาร/บัญชี (sequence ของ log เลื่อนได้ ดูหัวข้อย่อย 21 พ.ย.)

### รอบ 13:57Z (21 พ.ย.) — 38 ข้อ ผ่านทั้งหมด
จำลองพนักงาน 6 บทบาท และผู้ไม่ล็อกอิน
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

### รอบ ~15:57Z (หลัง Release #14)
รันสองบล็อก `DO` ที่จบด้วย `RAISE EXCEPTION` (ยกเลิกทั้งหมด) · ใช้พนักงานจริงที่มีสิทธิ์ครบ 1 คน และผู้ใช้ทดสอบที่ไม่มีสิทธิ์ 1 คน
| ชุด | ผล |
|---|---|
| S1 กะ POS | เปิดกะซ้ำถูกปฏิเสธ 23505 (มีกะเปิด 1 กะอยู่แล้ว) · ผู้ไม่มีสิทธิ์ pos เปิดกะถูกปฏิเสธ 42501 · แก้กะที่ปิดแล้ว **ข้าม** (ไม่มีกะปิดให้ทดสอบ) |
| S2 สถานะออร์เดอร์ | สถานะไม่ถูกต้องทั้งตอนอัปเดตและตอนเพิ่มถูกปฏิเสธ 23514 |
| S4 คิวรอตรวจ | พนักงานที่มีสิทธิ์เข้าคิวได้ และกระดิ่ง `team_order_review` เกิด · ผู้ไม่มีสิทธิ์เข้าคิวถูกปฏิเสธ 42501 · ระบุผู้สร้างเป็นคนอื่นถูกปฏิเสธ 42501 |
| S5 สิทธิ์อ่าน | ผู้ไม่มีสิทธิ์อ่านออร์เดอร์ได้ 0 แถว · anon อ่านบัญชีถูกปฏิเสธ 42501 |
| S6 งวดบัญชี | ลงในวันที่งวดปิด (7 พ.ย. 2026) ถูกปฏิเสธ P0001 · ลงงวดเปิดได้ |

รอบเพิ่มเติม (ย้อนธุรกรรมทั้งหมด): S1c แก้กะที่ปิดแล้ว (ปิดกะที่เปิดอยู่ในธุรกรรม) ปฏิเสธ P0001 ตามที่คาด · S3 คูปอง: ใช้กับออร์เดอร์ใหม่ ok · ใช้ซ้ำกับออร์เดอร์เดิม ok · ออร์เดอร์อื่น used · ไม่มีคูปอง missing · โหมดเครดิต invalid · ผู้ไม่มีสิทธิ์ 42501 · คืนคูปองโดยพนักงานได้ true และสถานะเป็น pending (ตามที่ออกแบบ) · คืนแต้มจากแอปไม่ได้ เพราะเพิกถอนสิทธิ์ authenticated และไม่มีแอปเรียก (ตามที่ออกแบบ)
ยังไม่ได้ทดสอบ: สมาชิก · ขายครบวงจรผ่าน Edge Function (ต้องใช้บัญชีลูกค้าจริง) · ด่านยอดเกินบิลและย้อนสถานะอยู่ในรอบก่อนหน้า (ตาราง S1, S2)
รอบแรกของ S4 ใช้ค่า status และ created_by ไม่ตรงนโยบาย จึงถูกปฏิเสธ 42501 ซึ่งเป็นความผิดของการทดสอบเอง แก้แล้วในรอบเดียวกัน
หลังรัน: แถว `QA-` = 0 ทุกตาราง · กะเปิด 1 เท่าเดิม · ออร์เดอร์ 8 · บัญชี 0 · คิวรอตรวจ 0 · กระดิ่ง 158 เท่าเดิม · คิว pg_net = 0 · หลังรอบเพิ่มเติม: คูปอง QA = 0 และกะเปิดยังเป็น 1

### รอบ 21 พ.ย. 17:17Z — 39 ข้อ · ผ่าน 38 · ไม่ผ่าน 1 (ตั้งเงื่อนไขผิด)
- ก่อนรันจริงทดสอบกลไกด้วยแถวทดสอบ 1 แถว: ในธุรกรรมเห็นแถว 1 · หลังยกเลิกเหลือ 0
- รอบแรก (17:16Z) ได้ FAIL 14 ข้อ เพราะสคริปต์ทดสอบของเราใช้ `INTO` กับคำสั่ง DML (42601) ไม่ใช่ข้อบกพร่องของระบบ · แก้สคริปต์แล้วรันใหม่เป็นผลด้านล่าง
- พนักงานทดสอบ 4 คนที่สร้างในธุรกรรม (ขาย · ผู้จัดการ · ไม่มีสิทธิ์ · ย้อนสถานะ) และผู้ไม่ล็อกอิน (anon)

| ชุด | ผล |
|---|---|
| S1 กะ/POS/การชำระ | ผู้มีสิทธิ์ pos เปิดกะซ้อนถูกปฏิเสธ 23505 (มีกะเปิด 1 กะก่อนรัน · ไม่ปิดกะจริง) · ผู้ไม่มีสิทธิ์ pos เปิดกะ 42501 · anon เปิดกะ 42501 · ผู้ไม่มีสิทธิ์ปิดกะจริงไม่ได้ (กะเปิดยังเป็น 1) · ด่านยอดเกินบิล: เกินไม่ถึง 1 สตางค์ผ่าน · เกิน 2 สตางค์ถูกบล็อก (P0001) · ด่านบัตร: ไม่มีธงยืนยันถูกบล็อก (P0001) · มีธงผ่าน |
| S1 เวลานัดรับ | ผู้ไม่มีสิทธิ์มองไม่เห็นออร์เดอร์และเวลานัดไม่เปลี่ยน · ผู้ดูได้แต่ไม่มี editPickup ถูกปฏิเสธ 42501 · ผู้มี editPickup/manage แก้ได้ (ผลจากชุดเป้าหมาย) |
| S2 สถานะ | ไม่มี revertStatus ย้อน delivered→cancelled ไม่ได้ (42501) · มี revertStatus ย้อนได้ทั้งสองทาง · สถานะที่ย้อนถูกบันทึกในธุรกรรม |
| S3 แต้ม/ลูกค้า | พนักงานขายและผู้จัดการแก้ pointsUsed ตรงไม่ได้ (42501) · `punpang_remove_points` ได้ (ok) · คืนคะแนนเข้าก้อนเดิม (QA-L1 กลับเป็น 100) และล้าง pointsUsed · ออร์เดอร์ใหม่ของลูกค้าที่ถูกลบถูกบล็อก (P0001) · ลูกค้าปกติผ่าน |
| S4 คิวรอตรวจ/กระดิ่ง | พนักงานขายเข้าคิวได้ · มองไม่เห็นคิว (0) · ผู้จัดการเห็น (1) · แก้ต้นฉบับไม่ได้ (42501) · ปิดไม่มีเหตุผลถูกปฏิเสธ (23514) · ปิดพร้อมเหตุผลได้และฐานข้อมูลบันทึกผู้ปิดเป็นผู้จัดการ · เปิดรายการที่ปิดแล้วไม่ได้ (42501) · กระดิ่ง `team_order_review` 1 แถว · pg_net เข้าคิว +1 ในธุรกรรม (ยกเลิกแล้วไม่ส่ง) |
| S5 สิทธิ์ | anon อ่านและเพิ่มออร์เดอร์ไม่ได้ (42501) · ลบออร์เดอร์ไม่ได้ (42501) · พนักงานขายเพิ่มสิทธิ์ `manage` ให้ตัวเองไม่ได้ (ตรวจค่าหลังคำสั่ง) · ผู้ไม่มีสิทธิ์บัญชีมองไม่เห็นรายการบัญชี |
| S6 บัญชี | ออกใบกำกับใบแรกของออร์เดอร์ได้ · ใบที่สองของออร์เดอร์เดิมถูกปฏิเสธ (23505) · ลงรายการงวดเปิด (หลัง 7 พ.ย.) ได้ · งวดปิดถึง 7 พ.ย. ถูกบล็อก (P0001) |

ผล: 38 ผ่าน · 1 ไม่ผ่าน คือ "S1 เวลานัดรับ: ผู้ไม่มีสิทธิ์แก้ไม่ได้ (42501)" ซึ่งตั้งเงื่อนไขผิด: RLS ซ่อนออร์เดอร์จากผู้ไม่มีสิทธิ์ จึงไม่เกิด error (ผลคำสั่ง OK และไม่มีแถวถูกแก้) · ยืนยันด้วยชุดเป้าหมายแยก (17:17Z): ผู้ไม่มีสิทธิ์มองไม่เห็น (0) และเวลานัดไม่เปลี่ยน · ผู้ดูได้แต่ไม่มี editPickup ถูกปฏิเสธ 42501 และเวลาไม่เปลี่ยน · ผู้มี editPickup เปลี่ยนเวลาได้

หลังรัน (ก่อน → หลัง): แถว `QA-` = 0 ทุกตาราง · ออร์เดอร์ 8 → 8 · ลูกค้า 2 → 2 · records 309 → 309 · กะเปิด 1 → 1 · พนักงาน 2 → 2 · auth.users 2 → 2 · คิวรอตรวจ 0 · ใบกำกับ 0 · บัญชี 0 · คิว pg_net 0 · sequence `punpang_order_changes_id_seq` 1 → 3 (sequence ไม่ย้อนค่าเมื่อยกเลิกธุรกรรม · เป็นลำดับของ log ไม่ใช่เลขเอกสาร)

## 4. ช่องว่างและข้อสังเกต (เรียงตามความเสี่ยง)
สถานะ (อัปเดตหลัง Release #11 · #12 · #13 · #14 · #15 · #16 · Release #17 รออนุมัติ ดูข้อ 11): **แก้แล้วและ Release แล้ว:** B3, B12, B13 (Release #11 · `b85d8f8`) · B1, B2, B9 และ B7 ส่วน apply_points (Release #12 · `31a31a9`) · **Release #13 (`3678c69`):** B7 เพดานอัตรา `record_*` (migration `20261121180000`) · **Release #14 (`5d17a64`):** B4 และ B5 ส่วน 6 ฟังก์ชัน · **Release #15 (`efca447`, ผ่านหลังอนุมัติ):** B5 ส่วน order-audit และ quote-create · B10 ส่วนที่เหลือ · **Release #16 (`905a2b0`, migration `20261121190000`):** B7 ปิดแล้ว (ใช้ `cf-connecting-ip`) · **B10 รอบ 2 (merge แล้ว `f2ad997`):** `settingsRisk` 6 กรณี · **ผู้ใช้แจ้งว่าทำแล้ว (ยังไม่ได้ตรวจซ้ำจากที่นี่):** B6 · B8 ไม่พบการเกิดซ้ำหลัง 11:06Z
| ID | ระดับ | พบ | ทางแก้ที่แนะนำ |
|---|---|---|---|
| B13 | เตือน · **แก้แล้ว** (timeout 30 วินาที, Release #11 · รอบ 15:00 และ 15:15 ได้ 200) | cron `punpang-scheduled` (ทุก 15 นาที) ถูก pg_net ตัดที่ 5 วินาที 11 จาก 24 รอบ (08:00–13:50Z) · รอบที่สำเร็จใช้ 3.6–4.9 วินาที (ใกล้เพดาน) · รอบที่ถูกตัดฟังก์ชันบูตปกติ แต่ผลสุดท้ายยืนยันจาก log ไม่ได้ | เพิ่ม `timeout_milliseconds` (เช่น 30000) หรือลดเวลาทำงานของฟังก์ชัน |
| B12 | เตือน (ทำซ้ำไม่ได้) · **แก้แล้ว** (migration `20261121160000`, Release #11) | `punpang_customers_phone_digits_uniq` (unique index เบอร์ที่ตัดอักขระแล้ว · public และ punpang_test) มีบน production แต่ไม่มีใน migration/สคริปต์ใดใน repo (อ้างถึงเฉพาะ `customersSync.js:94` และเทสต์ `customersSync.lazy.test.mjs:79`) → สร้างฐานใหม่จาก migration จะไม่มีด่านเบอร์ซ้ำ และเทสต์ DB ใน CI ไม่ครอบคลุม | เพิ่ม migration `create unique index if not exists` ให้ตรง production (ต้อง Release) |
| B6 | เตือน (ตั้งค่า) · ผู้ใช้แจ้งว่าเปิดแล้ว (ยังไม่ได้ตรวจซ้ำ) | Supabase Auth: Leaked password protection ปิดอยู่ | เปิดที่ Dashboard ของ Supabase Auth |
| B1 | เตือน (เฉพาะโหมดทดสอบ) · **แก้แล้ว** (Release #12) | `punpang_test.punpang_order_audits` ไม่มี FK ไป `punpang_orders` (production มี) → คิวรี `fetchPendingPosHoldIds` (src/lib/posHold.js:10) ล้ม 400 วันนี้ 16 ครั้ง · เวลาตรงกับเครื่องทดสอบ (ไม่เห็นหัว Accept-Profile ใน log) · คำขออื่นที่ production ตอบ 200 ครั้ง 45 ครั้ง | เติม FK ในสคีมาทดสอบ หรือเปลี่ยนคิวรีไม่ใช้ embed |
| B2 | เตือน (เฉพาะโหมดทดสอบ) · **แก้แล้ว** (Release #12) | `punpang_line_users` / `punpang_line_messages` ไม่มีใน `punpang_test` · หน้า `/admin/settings/line-history` (ManageLineHistory.vue:20,39) ใช้ client ตามโหมด จึงคิวรีตารางที่ไม่มี | สร้างตารางในสคีมาทดสอบ หรือซ่อนหน้าในโหมดทดสอบ |
| B3 | ปรับปรุง · **แก้แล้ว** (Release #11) | `e2e/_routes.mjs` STATIC ขาด `/admin/settings/sync-review` (route คงที่ ไม่มีพารามิเตอร์) → ไม่ถูก smoke/375px ครอบคลุม · เส้นทางมีพารามิเตอร์/redirect อีก 14 เส้น ไม่มี e2e | เพิ่ม 1 บรรทัดใน STATIC |
| B7 | ข้อมูล · **แก้แล้ว** (apply_points เพิกถอนแล้วใน Release #12 · เพดานอัตรา record_* ใน Release #13 · migration `20261121180000`: จำกัด 60 ครั้งต่อนาทีต่อ IP) · **ปิดแล้ว (Release #16)** | RPC ที่ anon เรียกได้ 4 ตัว (click_stats / record_click / record_pageview / resolve_short_link) ตั้งใจสำหรับหน้าร้านสาธารณะ · click_stats คืนค่ารวมที่มี ≥3 ผู้เข้าชม · record_* เขียนจากผู้ไม่ล็อกอิน (มีเพดานอัตราต่อ IP แล้ว) · `punpang_apply_points` ปลดระวางแล้ว (คืน retired) และเพิกถอน execute แล้ว | ตรวจบน production แล้ว: `X-Forwarded-For` ปลอมไม่มีผลต่อตัวนับ · ใช้ `cf-connecting-ip` ที่ Cloudflare ตั้ง · คำขอที่ส่ง `CF-Connecting-IP` เองถูก 403 ที่ขอบ · ลบข้อมูลทดสอบแล้ว |
| B4 | ปรับปรุง · **แก้แล้ว** (Release #14) | `bot-test` บน production ยังเป็นโค้ดก่อนแก้ aiLog (63cc98d ไม่เก็บข้อความลูกค้า) · เป็นเครื่องมือทดสอบ ข้อมูลอยู่สคีมาทดสอบ ข้อความผ่าน scrubPII ตัดสั้น → ความเสี่ยงต่ำ | deploy แล้วใน Release #14 (version 8 · verify_jwt เดิม) |
| B10 | ครอบคลุม · **บางส่วน** (`settingsCrud` 4 กรณี: ลิงก์ย่อ · สิทธิ์ · เอกสารกฎหมาย · หน้าร้าน · `settingsPages` 6 กรณี: ราคา/วัตถุดิบ · ตัวเลือก/ชุดสินค้า · การเชื่อมต่อ · คำขอลบ · คำขอรูป · สิทธิ์พนักงาน · `settingsRisk` 6 กรณี (สะสมแต้ม/คูปอง · โปรโมชัน · คลังสินค้า · การเก็บข้อมูลอัตโนมัติ · โหมดทดสอบ: เปิดหน้า + ฟังก์ชันย่อย · คิวรอตรวจ: เปิดหน้า) · หน้าที่เหลือยังไม่มี e2e พฤติกรรม) | หน้าตั้งค่าย่อย 30 หน้า: smoke + 375px + สิทธิ์ เท่านั้น ไม่มี e2e พฤติกรรม CRUD (products / pricing / options / bundles / ingredients / gallery / storefront / links / legal / integrations / photo-requests / deletion-requests ฯลฯ) → พึ่ง unit test ของ lib | เพิ่ม e2e ตามความเสี่ยงที่เหลือ · โหมดทดสอบและคิวรอตรวจยังไม่ทดสอบขั้นตอนที่ต่อ Supabase จริง |
| B8 | ตรวจสาเหตุแล้ว · ไม่พบการเกิดซ้ำหลัง 11:06Z | ส่วนใหญ่เกิด 10:20–10:37Z ซึ่งเป็นช่วงทดสอบ push วันนี้ · push-send 404 ×4 (`record`) = ไม่มีแถวกระดิ่งในช่วงนั้นเหลืออยู่ (แถวทดสอบถูกลบแล้ว) · push-send 405 ×1 (11:06Z) = เรียกด้วยวิธีที่ไม่ใช่ POST · sms-send 503 ×2 = โค้ดตอบ "ยังไม่ได้ตั้งค่าเกตเวย์ SMS" · telegram-send 403 ×2 = ไม่ใช่ปลายทางถูกบล็อกในโหมดทดสอบ (ไม่มีแถว blocked) สาเหตุยังไม่ยืนยัน · storage sign 400 ×9 (รูป Messenger 04:21Z) = หน้าแชทแสดง "โหลดไม่ได้" ตามออกแบบ (ตรวจโค้ดแล้ว) · fb-connect 409 = โหมดทดสอบปฏิเสธตามออกแบบ | ค้างคำถาม: SMS ควรเปิดใช้หรือยัง · telegram 403 ต้องดูเพิ่มถ้าต้องการ |
| B5 | ข้อมูล · **แก้แล้ว** (Release #14 และ #15) | โค้ดใน main ใหม่กว่าที่ deploy แต่ไม่กระทบพฤติกรรม: scheduled / customer-order / fb-webhook (ขาด bell `team_order_review` ที่ตัวมันไม่สร้าง) · order-audit / quote-create (ขาดค่าคงที่ช่อง LINE และ `team_daily_summary` ที่ไม่ได้ใช้) · line-push (ขาดฟังก์ชันอายุข้อความที่ไม่ได้ใช้) · line-webhook (ส่วนที่เปลี่ยนใช้กับ Messenger เท่านั้น) | deploy ครบ 8 ฟังก์ชัน: 6 ใน Release #14 · order-audit และ quote-create ใน Release #15 หลังเพิ่มชื่อใน `release.yml` (ดูข้อ 10) |
| B14 | ข้อมูล | function ใน production: 14 ตัว (×2 สคีมา) มี CR (CRLF) ต่าง repo เฉพาะช่องว่าง · 3 ตัว (`punpang_cust_spin`, `punpang_log_error`, `punpang_purge_customer`) ขาดบรรทัดคอมเมนต์ไทยเทียบ repo · `rls_auto_enable` เป็นฟังก์ชันของแพลตฟอร์มที่มีทั้งสองฝั่ง → ไม่มีความต่างเชิงตรรกะ (ยืนยันหลังตัดคอมเมนต์และช่องว่างแล้ว) | — |
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
| ตั้งค่า (30 หน้าย่อย) | e2e smoke + 375px + สิทธิ์ · e2e พฤติกรรม `settingsCrud` (ลิงก์ย่อ · เอกสารกฎหมาย · หน้าร้าน · สิทธิ์) · `settingsPages` · `settingsRisk` · unit บางส่วน (settingsPages, bundle*, printConfig, retention, campaigns, displayAds) | — | B10 (หน้าที่เหลือ ดูแถว B10) |
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
6. B7 — apply_points เพิกถอนแล้ว (Release #12) · เพดานอัตรา `record_*` Release แล้ว (#13) · ยืนยัน header แล้ว · ปิดแล้ว (`cf-connecting-ip` · Release #16)
7. B4 — แก้แล้ว (Release #14) · B5 — deploy ครบ 8 ฟังก์ชันแล้ว (Release #14 และ #15)
8. B10 — 16 กรณี (`settingsCrud` 4 · `settingsPages` 6 · `settingsRisk` 6) · หน้าที่เหลือยังไม่มี e2e พฤติกรรม · merge เข้า main แล้ว (`f2ad997`)
9. โหมดทดสอบ: ราคาใบเสนอ/ออร์เดอร์จากสำเนา และ line-push ปฏิเสธโหมดทดสอบ — แก้แล้วในโค้ด (`b1aca1b`) · รอ Release #17 (ดูข้อ 10–11)

## 8. ข้อจำกัดของวิธีตรวจ
- การเทียบ Edge Function ที่ deploy กับ main ใช้เวลา deploy เทียบ commit ล่าสุดในกราฟ import + อ่าน diff (เทียบซอร์สจริงเฉพาะ `customer-loyalty`) ไม่ใช่การเทียบทุกตัวแบบไบต์ต่อไบต์
- การตรวจ SECURITY DEFINER ใช้ regex ว่าโค้ดอ้างตัวตน/สิทธิ์หรือไม่ ไม่ได้อ่านทีละตัว
- ฐานอ้างอิงเป็น PG 16.15 ส่วน production เป็น PG 17.11 · ความต่างที่ยอมรับได้มีเพียง MAINTAIN (PG 17 เท่านั้น) พาร์ทิชัน realtime ของแพลตฟอร์ม และการแสดงผล `extensions.gin_trgm_ops` (ทั้งสองฝั่งปรับให้เป็นรูปเดียวกันก่อนเทียบ)
- ฐานอ้างอิงสร้างจาก migration ชุดก่อนหน้า แล้วเติม `20261121180000` และ `20261121190000` ด้วยการรัน SQL โดยตรง (ฐานนี้ไม่มีตาราง `supabase_migrations`) · ก่อนเติมสองไฟล์นี้ การเทียบพบความต่างใน function สิทธิ์ routine และ policy · หลังเติมทุกหมวดตรงกัน (ดูข้อ 10)
- B1: ความเชื่อมโยงกับเครื่องทดสอบอนุมานจากเวลาและการไม่มี FK ในสคีมาทดสอบ ไม่ได้เห็นหัว Accept-Profile
- ตารางความครอบคลุมจับคู่จากชื่อไฟล์เทสต์ ไม่ใช่การวัด coverage
- ตาราง `net._http_response` ไม่เก็บ URL จึงระบุปลายทางของ timeout จากเวลาและ edge log ที่ตรงกันเท่านั้น (รอบ 14:30 ที่ timeout อนุมานว่าเป็นงานเก่า ไม่ได้ยืนยันจากตาราง)
- ตัวเลขโครงสร้างในข้อ 2 ใช้วิธีเดียวกันทั้งสองฝั่งและครอบคลุม `public` + `punpang_test` ตัวเลขของรายงานชุดแรกใช้ขอบเขตแคบกว่า จึงถูกแทนที่ด้วยชุดนี้
- ชุด rollback ยกเลิกทั้งธุรกรรม แต่ sequence ไม่ย้อนค่า และ pg_net เข้าคิวได้ในธุรกรรม (ยกเลิกแล้วไม่ส่ง)

## 9. วิธีทำซ้ำ
- `npm test` · `npm run build && npm run test:bundle` · `npm run test:fn` · `npm run test:e2e:ci` · `bash supabase/tests/run.sh` (ต้องมี Postgres)
- เทียบโครงสร้าง: รัน SQL รวมค่า md5 ต่อหมวด (function / policy / trigger / constraint / index / column / relation / view / publication / สิทธิ์ตารางและ routine) บนฐานอ้างอิงและ production แล้วเทียบ โดยปรับความต่างตามข้อ 8 · ทดสอบบน production: บล็อก `DO` + `RAISE EXCEPTION` ตามข้อ 3 (สคริปต์อยู่นอก repo)

## 10. การเปลี่ยนแปลงหลังรายงานชุดแรก (2026-11-21)
- **Release #11** (main `b85d8f8` · migration `20261121160000`): timeout `punpang-scheduled` 30 วินาที · unique index เบอร์ให้ตรง production · เพิ่ม route sync-review ใน e2e · ผ่าน
- **Release #12** (main `31a31a9` · migration `20261121170000`): timeout `punpang-order-audit` 30 วินาที · เปลี่ยนชื่องานลบกล่องเข้า · เพิกถอน execute `punpang_apply_points` · สำเนาโหมดทดสอบ: FK ของ `order_audits` และตาราง LINE ว่าง 2 ตาราง · ผ่าน
- **เทสต์กะ POS** (main `d6844af`, CI #315 ผ่าน): `supabase/tests/shifts_guard.test.sql` 14 ข้อผ่าน · ข้อความ commit เขียนว่า 19 ข้อ จำนวนที่ถูกคือ 14 ข้อ
- **เทสต์หน้าตั้งค่า** `e2e/settingsCrud.ui.e2e.mjs` (4 กรณี ผ่านในเครื่อง · เพิ่มในสคริปต์ `test:e2e` และ `test:e2e:ci` แล้ว)
- **เทสต์หน้าตั้งค่าความเสี่ยงสูง** `e2e/settingsPages.ui.e2e.mjs` (6 กรณี ผ่านในเครื่อง 6/6 · ราคา/วัตถุดิบ · ตัวเลือก/ชุดสินค้า · การเชื่อมต่อ Telegram · คำขอลบข้อมูล · คำขอไม่ให้ใช้รูป · พนักงานที่ไม่มีสิทธิ์ manage · เพิ่มในสคริปต์ `test:e2e` และ `test:e2e:ci` แล้ว)
- **การตั้งค่าในฐานข้อมูลจริง (ไม่ผ่าน migration)**: `punpang_kv` config/integrations `sms.enabled` = false (ก่อนหน้า true) เพื่อหยุดการเรียก sms-send ที่ตอบ 503
- **`punpang-scheduled`**: ไม่รันตั้งแต่สร้าง (14:14Z) จนถึง 15:00Z · รอบ 15:00 และ 15:15 รันสำเร็จ 200 · สาเหตุของช่วงแรกยังไม่ทราบ
- **Release #14** (main `5d17a64`, run `44921549957`): deploy `bot-test`, `scheduled`, `customer-order`, `fb-webhook`, `line-push`, `line-webhook` · version เพิ่ม 1 ทุกตัว · verify_jwt เดิม · งาน test ผ่าน · งาน release ไม่หยุดรอการกด Approve ที่ environment · ไม่มี migration
- **Release #15** (main `efca447`, run `44922750953` · 16:06:45–16:10:23Z): เพิ่ม order-audit และ quote-create ใน `release.yml` · งาน test ผ่าน · งาน release ผ่านหลังอนุมัติ environment `production` · deploy สองฟังก์ชัน · ตรวจหลัง deploy ด้วย list_edge_functions: order-audit version 15 verify_jwt = false (ตรง production) · quote-create version 16 verify_jwt = true (ตรง production) · updated_at ของทั้งสองอยู่ในขั้น deploy (16:10:18Z และ 16:10:20Z)
- **Release #16** (main `905a2b0` · run `44924188085` · migration `20261121190000`): เปลี่ยนตัวจำกัดอัตราจาก `x-forwarded-for` เป็น `cf-connecting-ip` · งาน test ผ่าน · งาน release ผ่านหลังผู้ใช้เอา required reviewer ของ environment `production` ออก · ตรวจ production หลังรัน: ฟังก์ชันอ้าง `cf-connecting-ip` · migration ถูกบันทึก · `X-Forwarded-For` ปลอมไม่มีผลต่อคีย์ตัวนับ · ล้างข้อมูลทดสอบแล้ว (pageViews กลับ 3)
- **เทสต์หน้าตั้งค่าความเสี่ยงสูง รอบ 2** `e2e/settingsRisk.ui.e2e.mjs` (6 กรณี ผ่านในเครื่อง 6/6 · สะสมแต้ม/คูปอง · โปรโมชัน POS · คลังสินค้า · การเก็บข้อมูลอัตโนมัติ · โหมดทดสอบ · คิวรอตรวจ · เพิ่มในสคริปต์ `test:e2e` และ `test:e2e:ci` แล้ว)
- **ทดสอบ production แบบ rollback 2 รอบเพิ่ม** (~15:57Z หลัง Release #14 · 17:17Z ของ 21 พ.ย.): ดูข้อ 3
- **การแก้โค้ด** (dev → main ถึง `b1aca1b` รวม `1630971` · CI #327 บน main สำเร็จ): `line-push` ปฏิเสธโหมดทดสอบ (409) ก่อนอ่านข้อมูลหรือเรียก LINE · `quote-create` และ `order-create` อ่านราคาจากสำเนาทดสอบในโหมดทดสอบ (โหมดจริงไม่เปลี่ยน) · `order-audit` ไม่แก้ (ปฏิเสธโหมดทดสอบอยู่แล้ว) · เทสต์ใหม่ `messaging/line-push` (4 ข้อ) และ `guard/mode-guard` (ทุกฟังก์ชันมีด่านโหมดทดสอบ) · `npm run test:fn` 181 ผ่าน 0 ล้ม
- **Release #17** (main `b1aca1b` · run `44928349785` · functions: `line-push quote-create order-create` · ไม่มี migration): งาน test ผ่าน (17:08:35Z) · งาน release หยุดรอ Approve ที่ environment `production` (ยังไม่ deploy) · หลังอนุมัติ: ตรวจ version และ verify_jwt ของทั้งสามฟังก์ชัน และยิง `line-push` ด้วยหัว `x-punpang-mode: test` ควรได้ 409 โดยไม่มี LINE ถูกเรียก
- **ตรวจโครงสร้างรอบนี้ (ก่อน/หลังเติม migration)**: ฐานอ้างอิงที่เทียบครั้งแรกยังไม่มี `20261121180000` และ `20261121190000` ความต่างก่อนเติม (function สิทธิ์ routine และ policy) หายไปหลังเติมสองไฟล์ · หลังเติมทั้ง 11 หมวดที่เทียบตรงกับ production (ข้อ 2)

## 11. ที่ต้องอนุมัติหรือตัดสินใจ
- **Release #17 รอ Approve ที่ environment `production`** (งาน test ผ่านแล้ว): https://github.com/punpang/cake-order-admin/actions/runs/44928349785 → Review deployments → Approve (ต้องให้ผู้ใช้กด) · ต้องยืนยันว่าจะให้ Approve หรือยกเลิก (กดได้เฉพาะผู้ใช้)
- **รายงานรอบนี้อยู่บน dev เท่านั้น** (ตามแผน ไม่ merge main) · ต้องการให้ merge เข้า main หรือไม่
- **environment `production` (สรุป)**: Release #14 ไม่หยุดรอ · #15 หยุดรอ · #16 ผ่านหลังผู้ใช้เอา required reviewer ออก · #17 ยังหยุดรอ · ดูการตั้งค่า required reviewer ที่ GitHub (ตรวจจากที่นี่ไม่ได้)
- **B10 ส่วนที่เหลือ** (หน้าที่ยังไม่มี e2e พฤติกรรม) · ไฟล์ทดสอบ `settingsPages` และ `settingsRisk` ถูก merge เข้า main แล้ว (`5d17a64` · `f2ad997`)
- **ทดสอบบนเครื่องจริง** (ผู้ใช้): checklist ข้อ 3–4 และ queue ข้อ 3 (`docs/device-test-checklist.md`)
- **ผู้ใช้ตรวจเอง**: Leaked password protection (B6) และ deployment ของ Cloudflare Pages ว่าตรงกับ main
- **B7 (migration `20261121180000` · Release #13 · แก้ต่อด้วย `20261121190000` · Release #16)**: `punpang__rate_ok` นับต่อ IP ต่อฟังก์ชันในแต่ละนาที · เกินแล้วคืนค่าเงียบ (ไม่บอกว่าถูกจำกัด) · ไม่พบ IP ในคำขอ ใช้ถัง `noip` ที่ 3,000 ต่อนาที · เก็บแฮช sha256 ของ IP ไม่เก็บ IP ดิบ · ล้างแถวที่เก่ากว่า 1 ชั่วโมงราว 2% ของการเรียก
- **การเปลี่ยนนโยบายอ่าน**: `kv_staff_read` เพิ่ม `rateLimit` เป็นข้อยกเว้น (พนักงานที่มี viewAllOrders อ่านตัวนับไม่ได้ ผู้จัดการยังอ่านได้ตามเดิม)
- **ตรวจหลัง Release**: ถ้ามีแถว `rl:pageview:` ของถัง `noip` ในนาทีที่มีการใช้งานจริง แปลว่าคำขอไม่ได้ส่ง `cf-connecting-ip` และต้องทบทวนก่อนพึ่งพาการจำกัดนี้
- **ข้อสังเกตที่ไม่เปลี่ยนในรอบนี้**: `punpang_record_pageview` ตรวจรูปแบบของ `p_day` แล้วนับเข้า "วันนี้" เสมอ ค่า `p_day` จึงไม่มีผลต่อจำนวนที่นับ · เพดานทั้งระบบ 50,000 แถวของ `punpang_cake_clicks` ยังคงเดิม
