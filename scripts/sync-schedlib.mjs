// คัดลอกโมดูลล้วนจาก src/lib ไปไว้ใน supabase/functions/_shared/schedlib (ให้ Edge Function scheduled ใช้ตรรกะเดียวกับแอป)
// รัน: node scripts/sync-schedlib.mjs · src/lib/schedlibSync.test.mjs ตรวจว่าไฟล์คัดลอกตรงกับต้นฉบับเสมอ
// เปลี่ยนเฉพาะการระบุนามสกุลไฟล์ใน import ที่ Deno ต้องการ (./format → ./format.js) ไม่แก้ตรรกะ
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// ไฟล์ใน src/lib (เส้นทางสัมพัทธ์จาก src/lib) · acct/* ใช้คำนวณเตือนค่าใช้จ่ายประจำและผ่อนชำระ
export const SCHEDLIB_FILES = [
  'constants.js', 'format.js', 'pricing.js', 'payDue.js', 'loyalty.js', 'birthday.js', 'notifyPlan.js', 'bell.js', 'orderLink.js',
  'acct/plan.js', 'acct/period.js', 'acct/money.js', 'slipChecks.js', 'promptpay.js',
  // ราคาใบเสนอ (ฝั่งเซิร์ฟเวอร์ quote-create ใช้ตรรกะชุดเดียวกับแอป) และส่วนประกอบที่ใช้
  'posPromo.js', 'delivery.js', 'parcelShipping.js', 'shipDiscount.js', 'shopHours.js', 'docNo.js', 'quotePrice.js', 'birthdayBenefit.js', 'orderCreate.js', 'posAudit.js', 'orderAudit.js', 'catalogHistory.js',
  // บริการเกี่ยวกับเงิน (ซ่อนเงิน/ดึงเงิน/ซ่อนของ) และกติกาธนบัตรเงินพัก: ใช้คิดในใบเสนอ/ออร์เดอร์ที่เซิร์ฟเวอร์
  'holdMoney.js', 'cashService.js',
  // การ์ดสรุปออร์เดอร์ในแชท (ใช้สร้างการ์ดให้ออร์เดอร์เดิมตอนลูกค้าเปิดแชท)
  'chatCards.js',
  // แจ้งงานใกล้เวลาต้องเสร็จเฉพาะออร์เดอร์ที่ยืนยันการสั่งซื้อแล้ว
  'dueSoon.js',
  // ประชาสัมพันธ์/โปรโมชั่น: เกณฑ์ความยินยอม (customer-auth) และการตรวจแคมเปญ/การ์ด (campaign, scheduled)
  'promoConsent.js', 'campaigns.js', 'memberNotify.js',
  // ใบกำกับภาษีเต็มรูปฝั่งลูกค้า (Edge Function tax-invoice ใช้กติกาชุดเดียวกับแอป) · กรอบเวลา เลขผู้เสียภาษี ข้อความตัวเลขเป็นบาท
  'taxInvoice.js', 'acct/taxWindow.js', 'acct/taxid.js', 'acct/thaiBaht.js',
  // ราคาออร์เดอร์สั่งล่วงหน้า (Edge Function preorder ใช้ชุดเดียวกับแอป)
  'preorderPrice.js', 'preorderReports.js', 'preorderNotify.js', 'preorderCustomerOrders.js',
]

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
export const srcPath = (f) => join(ROOT, 'src', 'lib', f)
export const dstPath = (f) => join(ROOT, 'supabase', 'functions', '_shared', 'schedlib', f)

// เพิ่ม .js ให้ import ตามไฟล์ที่ไม่มีนามสกุล (Deno ไม่เดาให้)
export const toDenoSource = (text) => text.replace(/(from '\.\/[A-Za-z0-9_-]+)'/g, "$1.js'")

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  for (const f of SCHEDLIB_FILES) {
    mkdirSync(dirname(dstPath(f)), { recursive: true })
    writeFileSync(dstPath(f), toDenoSource(readFileSync(srcPath(f), 'utf8')))
  }
  console.log(`synced ${SCHEDLIB_FILES.length} files`)
}
