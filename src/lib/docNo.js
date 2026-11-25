// เลขที่เอกสาร: PREFIX-ddmmyy-ลำดับ (รันใหม่ทุกวัน, ปี ค.ศ. 2 หลัก, วันที่ตามเวลาเครื่อง/ร้าน)
//   OR-ddmmyy-xxxxxx (ออร์เดอร์) · POS-ddmmyy-xxxxx · QT-ddmmyy-xxxxx · PAY-ddmmyy-xxxxx · PRE-ddmmyy-xxxxxx (สั่งล่วงหน้า)
// ใช้เฉพาะเลขอ้างอิงภายใน/ลูกค้า — ใบกำกับภาษีและรายการบัญชี ใช้ชุดเลขของฝั่งบัญชี (รันต่อปี ไม่ขาดเลข) ห้ามใช้ตัวนี้
export const DOC_DIGITS = { OR: 6, POS: 5, QT: 5, PAY: 5, PRE: 6 } // PRE = สั่งล่วงหน้า (preorder)
export const DOC_PREFIXES = Object.keys(DOC_DIGITS)
// เลขที่ที่พนักงานเบิกล่วงหน้าได้ · PRE ออกโดยเซิร์ฟเวอร์เท่านั้น (แคมเปญสั่งล่วงหน้า) จึงไม่อยู่ในรายการนี้
export const STAFF_PREFIXES = DOC_PREFIXES.filter((p) => p !== 'PRE')
const pad2 = (n) => String(n).padStart(2, '0')

export const ddmmyy = (d = new Date()) => `${pad2(d.getDate())}${pad2(d.getMonth() + 1)}${pad2(d.getFullYear() % 100)}`
export const formatNo = (prefix, day, seq) => `${prefix}-${day}-${String(seq).padStart(DOC_DIGITS[prefix], '0')}`
// อ่านรหัสที่มี TEST- นำหน้า (ของเดิมจากโหมดทดสอบที่เลิกใช้แล้ว) · ตัวนับในเครื่องจะได้รู้เลขที่ใช้แล้ว
export function parseNo(code) {
  const m = /^(?:TEST-)?([A-Z]+)-(\d{6})-(\d+)$/.exec(String(code || ''))
  return m && DOC_DIGITS[m[1]] ? { prefix: m[1], day: m[2], seq: Number(m[3]) } : null
}
export const isDocNo = (code) => !!parseNo(code)

// ตัวออกเลข: next() เป็นแบบ sync เสมอ (ฟังก์ชันสร้างออร์เดอร์/ชำระเงินเป็น sync)
// - โหมดออฟไลน์/เดโม: นับในเครื่อง เริ่ม 1 ใหม่ทุกวัน
// - โหมด Supabase: ขอเลขเป็นชุดล่วงหน้าจากฐานข้อมูล (alloc) เก็บไว้ในคลังต่อวัน แล้วเบิกใช้ → หลายเครื่องไม่ซ้ำกัน
//   คลังใกล้หมดจะเติมเอง · ถ้าเติมไม่ทัน/ออฟไลน์ ใช้ตัวนับในเครื่องแทน (ออร์เดอร์มีตัวกันเลขซ้ำตอนบันทึก)
// decorate: ตกแต่งรหัสก่อนส่งออก · ค่าเริ่มต้นไม่เปลี่ยนรหัส
export function createNumbering({ alloc = null, batch = 20, low = 5, today = () => new Date(), decorate = (code) => code } = {}) {
  const pools = new Map() // key → [{ next, end }, ...] (ชุดเลขที่ได้จากฐานข้อมูล อาจไม่ต่อเนื่องกัน)
  const local = new Map() // key → เลขล่าสุดที่ใช้ (ในเครื่อง)
  const pending = new Set()
  const key = (p, day) => `${p}|${day}`
  const remaining = (k) => (pools.get(k) || []).reduce((n, r) => n + Math.max(0, r.end - r.next + 1), 0)

  async function refill(prefix, day) {
    const k = key(prefix, day)
    if (!alloc || pending.has(k)) return
    pending.add(k)
    try {
      const start = await alloc(prefix, day, batch)
      if (Number.isInteger(start) && start > 0) {
        pools.set(k, [...(pools.get(k) || []), { next: start, end: start + batch - 1 }])
        local.set(k, Math.max(local.get(k) || 0, start - 1))
      }
    } catch { /* เติมไม่ได้ → ใช้เลขในเครื่องไปก่อน */ }
    pending.delete(k)
  }

  function next(prefix, date = today()) {
    const day = ddmmyy(date)
    const k = key(prefix, day)
    const ranges = pools.get(k) || []
    while (ranges.length && ranges[0].next > ranges[0].end) ranges.shift()
    let seq
    if (ranges.length) {
      seq = ranges[0].next++
      local.set(k, Math.max(local.get(k) || 0, seq))
      if (remaining(k) <= low) refill(prefix, day)
    } else {
      seq = (local.get(k) || 0) + 1
      local.set(k, seq)
      refill(prefix, day)
    }
    return decorate(formatNo(prefix, day, seq))
  }

  // เบิกล่วงหน้าตอนเริ่มระบบ/ข้ามวัน (เรียกได้ซ้ำ)
  const prefetch = (date = today()) => Promise.all(STAFF_PREFIXES.map((p) => refill(p, ddmmyy(date))))
  // ตั้งตัวนับในเครื่องให้ไม่ต่ำกว่าเลขที่เห็นแล้ว (เช่น หลังโหลดออร์เดอร์) · reset = ล้างเลขเดิม (เช่น เลขจากข้อมูลตัวอย่าง)
  function seen(codes, { reset = false } = {}) {
    if (reset) { local.clear(); pools.clear() }
    for (const c of codes) {
      const p = parseNo(c)
      if (!p) continue
      const k = key(p.prefix, p.day)
      local.set(k, Math.max(local.get(k) || 0, p.seq))
    }
  }
  const setAlloc = (fn) => { alloc = fn }
  return { next, prefetch, seen, refill, setAlloc }
}
