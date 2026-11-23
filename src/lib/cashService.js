// บริการเกี่ยวกับเงิน (ซ่อนเงิน/ดึงเงิน/ซ่อนของ) · ฟังก์ชันล้วน ใช้ร่วมทั้งแอปและเซิร์ฟเวอร์ (schedlib)
// ค่าบริการเป็นรายการในออร์เดอร์ (kind 'service') ราคาคิดจากการตั้งค่าร้าน config.shop.cashService เท่านั้น
// เงินพัก (ซ่อนเงิน/ดึงเงิน) คิดจากธนบัตรที่เครื่องส่งมา · ยอดเงินพักคำนวณจากธนบัตรที่นี่ ไม่รับค่า amount จากเครื่อง
import { holdAmountOf, holdErrors, NOTE_VALUES } from './holdMoney.js'

export const CASH_KINDS = ['hide', 'pull', 'stash'] // ซ่อนเงิน · ดึงเงิน · ซ่อนของ
export const CASH_LABEL = { hide: 'ซ่อนเงิน', pull: 'ดึงเงิน', stash: 'ซ่อนของ' }

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)
const fail = (error) => ({ ok: false, error })
const money = (v) => Math.max(0, Math.round((Number(v) || 0) * 100) / 100)

// การตั้งค่าที่ใช้ได้จริง (ค่าที่ไม่ถูกต้อง/ไม่มี = ไม่เปิดให้บริการ · ค่าบริการ 0 · ไม่จำกัดธนบัตร)
// config.shop.cashService = { maxNotes, services: { hide: { fee, show, customer }, pull: {...}, stash: {...} } }
// show = เปิดให้บริการ (พนักงานและเซิร์ฟเวอร์รับได้) · customer = แสดงให้ลูกค้าเห็นบริการนี้ (ต้อง show ก่อน) · ค่าเริ่มต้น customer = ปิด
export function cashSettingsOf(shop) {
  const c = isObj(shop?.cashService) ? shop.cashService : {}
  const services = {}
  for (const k of CASH_KINDS) {
    const s = isObj(c.services?.[k]) ? c.services[k] : {}
    const show = s.show === true
    services[k] = { fee: money(s.fee), show, customer: show && s.customer === true }
  }
  return { maxNotes: Math.max(0, Math.floor(Number(c.maxNotes) || 0)), services }
}

// ตรวจและคิดบริการเกี่ยวกับเงิน · input = { kind, notes? } (ไม่มี = ไม่ใช้บริการ)
// คืน { ok, item, holdMoney } · item = รายการค่าบริการ (ราคาจากการตั้งค่า) · holdMoney = เงินพัก (เฉพาะซ่อนเงิน/ดึงเงิน)
// customerFacing = ใบเสนอที่ร้านส่งให้ลูกค้า: รับเฉพาะบริการที่เปิด "ให้ลูกค้าเห็น" ไว้ (ไม่มียอดที่ลูกค้ามองไม่เห็น)
export function cashServiceOf(input, shop, { customerFacing = false } = {}) {
  if (input === undefined || input === null) return { ok: true, item: null, holdMoney: null }
  if (!isObj(input)) return fail('บริการเกี่ยวกับเงินไม่ถูกต้อง')
  const kind = input.kind
  if (!CASH_KINDS.includes(kind)) return fail('ประเภทบริการเกี่ยวกับเงินไม่ถูกต้อง')
  const settings = cashSettingsOf(shop)
  const svc = settings.services[kind]
  if (!svc.show) return fail(`ยังไม่เปิดให้บริการ${CASH_LABEL[kind]}`)
  if (customerFacing && !svc.customer) return fail(`ยังไม่เปิดให้ลูกค้าเห็น${CASH_LABEL[kind]}`)

  let holdMoney = null
  if (kind === 'stash') {
    if (input.notes !== undefined && input.notes !== null) return fail('ซ่อนของไม่มีธนบัตร')
  } else {
    const raw = input.notes
    if (!isObj(raw)) return fail('ต้องระบุธนบัตรของเงินพัก')
    if (Object.keys(raw).some((k) => !NOTE_VALUES.includes(Number(k)))) return fail('มีธนบัตรที่ไม่รองรับ')
    const notes = {}
    for (const v of NOTE_VALUES) if (raw[v] !== undefined && raw[v] !== null) notes[v] = raw[v] === '' ? NaN : Number(raw[v])
    // ยอดเงินพักคำนวณจากธนบัตรที่นี่เสมอ (ไม่รับยอดจากเครื่อง) · ตรวจจำนวนเต็มไม่ติดลบ และเพดานจำนวนใบ
    const amount = holdAmountOf(notes)
    const bad = holdErrors({ kind, notes, amount }, { maxNotes: settings.maxNotes })
    if (bad) return fail(bad)
    holdMoney = { kind, notes: Object.fromEntries(Object.entries(notes).filter(([, n]) => n > 0)), amount }
  }

  // ราคาค่าบริการจากการตั้งค่าร้านเท่านั้น (ค่า fee/unitPrice ที่เครื่องส่งมาไม่ถูกใช้) · ไม่เข้าแต้ม/คูปอง
  const item = {
    id: `svc-${kind}`,
    kind: 'service',
    serviceKind: kind,
    name: CASH_LABEL[kind],
    qty: 1,
    unitPrice: svc.fee,
    regularPrice: svc.fee,
    fullPrice: svc.fee,
    mods: [],
    discounts: [],
    specials: [],
    bundles: [],
    noPoints: true,
  }
  return { ok: true, item, holdMoney }
}

// รายการในออร์เดอร์ = รายการสินค้า + รายการค่าบริการ (ถ้ามี) · คืน { ok, items, holdMoney } | { ok:false, error }
export function withCashService(items, input, shop) {
  const c = cashServiceOf(input, shop)
  if (!c.ok) return c
  return { ok: true, items: c.item ? [...items, c.item] : items, holdMoney: c.holdMoney }
}

// ข้อมูลบริการของออร์เดอร์ที่มีอยู่ → รูปแบบ input ที่ส่งให้เซิร์ฟเวอร์คิดใหม่ (ไม่มีบริการ = undefined)
// ไม่ส่งรายการ kind 'service' ไปตรงๆ เพราะเซิร์ฟเวอร์ปฏิเสธ (ราคาต้องมาจากการตั้งค่า)
export function cashDraftOf(order) {
  const svc = (order?.items || []).find((i) => i?.kind === 'service' && CASH_KINDS.includes(i.serviceKind))
  if (!svc) return undefined
  return order.holdMoney?.kind ? { kind: svc.serviceKind, notes: { ...order.holdMoney.notes } } : { kind: svc.serviceKind }
}
