// สมุดรายวัน (ฟังก์ชันล้วน): รายการ { id, date, memo, lines: [{ account, dr, cr }], source: { type, … } }
import { toS } from './money'

export const entrySums = (e) => ({
  dr: e.lines.reduce((s, l) => s + toS(l.dr || 0), 0),
  cr: e.lines.reduce((s, l) => s + toS(l.cr || 0), 0),
})
export const isBalanced = (e) => {
  const { dr, cr } = entrySums(e)
  return dr === cr && dr > 0
}
const toYmd = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const YMD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/

// ตรวจรายการก่อนบันทึก → ข้อความผิดพลาด ('' = ผ่าน) · accounts = รายการบัญชีที่ใช้งานได้
export function validateEntry(e, accounts) {
  if (!YMD.test(String(e.date || '')) || toYmd(new Date(`${e.date}T00:00`)) !== e.date) return 'วันที่ไม่ถูกต้อง'
  if (!Array.isArray(e.lines) || e.lines.length < 2) return 'ต้องมีอย่างน้อย 2 บรรทัด'
  const ids = new Map(accounts.map((a) => [a.id, a]))
  for (const l of e.lines) {
    const a = ids.get(l.account)
    if (!a) return `ไม่พบบัญชี ${l.account || '(ว่าง)'}`
    if (a.active === false) return `บัญชี ${a.id} ${a.name} ถูกปิดใช้งาน`
    const dr = Number(l.dr) || 0, cr = Number(l.cr) || 0
    if (dr < 0 || cr < 0 || !Number.isFinite(dr) || !Number.isFinite(cr)) return 'จำนวนเงินไม่ถูกต้อง'
    if (dr > 0 && cr > 0) return 'บรรทัดเดียวมีทั้งเดบิตและเครดิตไม่ได้'
    if (!(dr > 0) && !(cr > 0)) return 'ทุกบรรทัดต้องมีจำนวนเงิน'
  }
  const { dr, cr } = entrySums(e)
  if (dr !== cr) return `เดบิต ${dr / 100} ไม่เท่ากับเครดิต ${cr / 100}`
  return ''
}

// เลขที่เอกสารต่อปี (ปี พ.ศ.) JV-2569-0001
export const entryNo = (prefix, date, seq) => `${prefix}-${Number(date.slice(0, 4)) + 543}-${String(seq).padStart(4, '0')}`
