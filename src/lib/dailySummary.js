// ตัวแปรของข้อความ "สรุปยอดประจำวัน" ที่ส่งเข้าทีมหลังปิดกะ POS
import { money } from './format.js'
import { POS_METHODS } from './constants.js'

// ช่องทางการชำระ → บรรทัดสรุป (ตามลำดับ เงินสด โอน บัตร แล้วช่องทางอื่น)
export function methodLines(byMethod = {}) {
  const order = Object.keys(POS_METHODS)
  const keys = [...order.filter((k) => k in byMethod), ...Object.keys(byMethod).filter((k) => !order.includes(k))]
  return keys.filter((k) => Math.abs(Number(byMethod[k]) || 0) > 0).map((k) => `• ${POS_METHODS[k] || k} ${money(byMethod[k])}`)
}

// shift = กะที่ปิด · summary = ผลจาก shiftSummary(shift) · counted = เงินสดที่นับได้
export function dailySummaryVars({ shopName = '', shift, summary, counted = 0, closedBy = '', closedAt = '' }) {
  const s = summary || { bills: 0, cancelled: 0, byMethod: {}, total: 0, expectedCash: 0 }
  const expected = Number(s.expectedCash) || 0
  const got = Number(counted) || 0
  const diff = got - expected
  return {
    ร้าน: shopName || '',
    วันที่: closedAt ? String(closedAt).slice(0, 10) : shift?.openedAt ? String(shift.openedAt).slice(0, 10) : '',
    บิล: String(s.bills ?? 0),
    ยกเลิก: String(s.cancelled ?? 0),
    ช่องทาง: methodLines(s.byMethod).join('\n'),
    ยอดสุทธิ: money(s.total),
    เงินสดคาด: money(expected),
    เงินสดนับได้: money(got),
    ส่วนต่าง: `${diff > 0 ? '+' : ''}${money(diff)}`,
    ปิดกะโดย: closedBy || '',
  }
}
