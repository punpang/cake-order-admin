// จัดการข้อมูลที่อาจเป็นขยะ: หมวด ค่าเริ่มต้น การตรวจค่า และการเทียบความเสี่ยงก่อนบันทึก · ฟังก์ชันล้วน ทดสอบได้โดยไม่ต้องต่อฐานข้อมูล
// ค่าเริ่มต้นต้องตรงกับฟังก์ชัน public.punpang_run_retention() ในฐานข้อมูล (ฐานข้อมูลเป็นผู้ลบจริง ทุกวัน 10:30 เวลาไทย)
export const RETENTION_MAX_DAYS = 3650
export const RETENTION_PRESETS = [7, 30, 90, 180, 365]

// timeField = ฟิลด์เวลาในข้อมูลที่ใช้นับอายุ (null = นับจำนวนล่วงหน้าไม่ได้) · min = จำนวนวันขั้นต่ำที่ยอมให้ตั้ง
export const RETENTION_CATS = [
  {
    key: 'slipRead', icon: 'wallet', title: 'ผลอ่านสลิป', min: 1, timeField: 'at', def: { enabled: true, days: 180 },
    removes: 'ผลอ่านยอดและวัน-เวลาที่ระบบจำไว้ชั่วคราว เพื่อไม่ต้องอ่านสลิปใบเดิมซ้ำ',
    keeps: 'รายการชำระเงินและรูปสลิปในออร์เดอร์ไม่ถูกแตะ',
  },
  {
    key: 'chatMedia', icon: 'image', title: 'ลิงก์รูป/ไฟล์ Facebook ในแชท', min: 1, timeField: null, def: { enabled: true, days: 30 },
    removes: 'ลิงก์ของรูปและไฟล์ที่ลูกค้าส่งทาง Facebook (ลิงก์เก่าของ Facebook หมดอายุเองอยู่แล้ว)',
    keeps: 'ข้อความแชท ชื่อไฟล์ และสลิปที่รับชำระแล้วยังอยู่ครบ',
  },
  {
    key: 'aiLog', icon: 'chat', title: 'บันทึกการทำงานของบอท AI', min: 7, timeField: 'at', def: { enabled: false, days: 90 },
    removes: 'ประวัติการเรียกบอท AI แต่ละครั้ง (ใช้แสดงสถิติย้อนหลัง)',
    keeps: 'ข้อความในแชทและการตั้งค่าบอทไม่ถูกแตะ · สถิติ 7 วันล่าสุดยังดูได้เสมอ',
  },
  {
    key: 'bell', icon: 'bell', title: 'การแจ้งเตือนเก่า (กระดิ่ง)', min: 7, timeField: 'at', def: { enabled: false, days: 90 },
    removes: 'รายการแจ้งเตือนในกระดิ่งที่เก่าเกินกำหนด ทั้งที่อ่านแล้วและยังไม่อ่าน',
    keeps: 'ออร์เดอร์ แชท และงานที่แจ้งเตือนถึงยังอยู่ครบ',
  },
  {
    key: 'orderLinks', icon: 'link', title: 'ลิงก์ออร์เดอร์ที่ยกเลิกแล้ว', min: 1, timeField: 'revokedAt', def: { enabled: false, days: 180 },
    removes: 'ลิงก์ออร์เดอร์ที่ถูกยกเลิก (ใช้เปิดไม่ได้แล้ว) นับจากวันที่ยกเลิก',
    keeps: 'ลิงก์ที่ยังใช้งานได้และตัวออร์เดอร์ไม่ถูกแตะ',
  },
]
const CAT = Object.fromEntries(RETENTION_CATS.map((c) => [c.key, c]))

export const defaultRetention = () => Object.fromEntries(RETENTION_CATS.map((c) => [c.key, { ...c.def }]))

// ค่าที่อ่านจากฐานข้อมูล/ฟอร์ม → รูปแบบครบทุกหมวด (ค่าที่ขาดหรือผิดใช้ค่าเริ่มต้น)
export function normalizeRetention(v) {
  return Object.fromEntries(RETENTION_CATS.map((c) => {
    const x = v?.[c.key]
    const days = Math.round(Number(x?.days))
    return [c.key, {
      enabled: typeof x?.enabled === 'boolean' ? x.enabled : c.def.enabled,
      days: Number.isFinite(days) && days >= c.min && days <= RETENTION_MAX_DAYS ? days : c.def.days,
    }]
  }))
}

// ข้อความผิดพลาดรายหมวด (หมวดที่ปิดอยู่ก็ต้องมีจำนวนวันที่ถูกต้อง เพราะค่าจะถูกเก็บไว้ใช้ตอนเปิด)
export function retentionDaysError(key, days) {
  const c = CAT[key]
  if (days === '' || days === null || days === undefined) return 'กรอกจำนวนวัน'
  const n = Number(days)
  if (!Number.isInteger(n)) return 'ใช้เลขจำนวนเต็ม'
  if (n < c.min) return `ต่ำสุด ${c.min} วัน`
  if (n > RETENTION_MAX_DAYS) return `สูงสุด ${RETENTION_MAX_DAYS.toLocaleString('en-US')} วัน`
  return ''
}
export function validateRetention(v) {
  const errors = {}
  for (const c of RETENTION_CATS) {
    const e = retentionDaysError(c.key, v?.[c.key]?.days)
    if (e) errors[c.key] = e
  }
  return errors
}

// การเปลี่ยนที่ทำให้ข้อมูลถูกลบมากขึ้น (เปิดหมวดใหม่ หรือลดจำนวนวันของหมวดที่เปิดอยู่) → ต้องยืนยันก่อนบันทึก
export function retentionRisks(prev, next) {
  const out = []
  for (const c of RETENTION_CATS) {
    const a = prev[c.key]
    const b = next[c.key]
    if (!b.enabled) continue
    if (!a.enabled) out.push({ key: c.key, title: c.title, kind: 'enable', days: b.days })
    else if (b.days < a.days) out.push({ key: c.key, title: c.title, kind: 'shorter', days: b.days, from: a.days })
  }
  return out
}

export const retentionEqual = (a, b) => RETENTION_CATS.every((c) => a[c.key].enabled === b[c.key].enabled && Number(a[c.key].days) === Number(b[c.key].days))

// เวลาตัด: ข้อมูลที่เก่ากว่านี้จะถูกลบในรอบถัดไป
export const retentionCutoff = (days, nowMs = Date.now()) => new Date(nowMs - Number(days) * 86_400_000)

// สรุปสั้นสำหรับหน้าเมนูตั้งค่า
export function retentionSummary(v) {
  const r = normalizeRetention(v)
  const on = RETENTION_CATS.filter((c) => r[c.key].enabled)
  return on.length ? `ลบอัตโนมัติ ${on.length} จาก ${RETENTION_CATS.length} หมวด · ทุกวัน 10:30` : 'ปิดการลบอัตโนมัติทุกหมวด'
}

// นับจำนวนรายการของหมวด: ทั้งหมด และที่เข้าเกณฑ์ลบ ณ ตอนนี้ (ต้องมีสิทธิ์จัดการ ฐานข้อมูลกรองตามสิทธิ์) · หมวดที่นับไม่ได้คืน null
export async function fetchRetentionCount(client, key, days, nowMs = Date.now()) {
  const c = CAT[key]
  if (!c?.timeField) return null
  const base = () => client.from('punpang_records').select('id', { count: 'exact', head: true }).eq('collection', key)
  const field = `data->>${c.timeField}`
  const [all, due] = await Promise.all([
    c.timeField === 'revokedAt' ? base().not(field, 'is', null) : base(),
    base().lt(field, retentionCutoff(days, nowMs).toISOString()),
  ])
  if (all.error || due.error) throw new Error('count_failed')
  return { total: all.count ?? 0, due: due.count ?? 0 }
}

// ผลการลบรอบล่าสุด (retentionLog) · ยังไม่เคยทำงาน = null
export async function fetchLastRetentionRun(client) {
  const r = await client.from('punpang_records').select('data,created_at').eq('collection', 'retentionLog').order('created_at', { ascending: false }).limit(1)
  if (r.error) throw new Error('load_failed')
  const d = r.data?.[0]?.data
  return d ? { at: d.at, deleted: d.deleted || {} } : null
}
