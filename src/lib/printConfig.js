// การตั้งค่าการพิมพ์ 5 ส่วนตามเอกสาร (ไม่มี import เพื่อให้ทดสอบด้วย node ได้)
// เครื่อง (localStorage punpang.print.v2): เครื่องพิมพ์ Bluetooth · ความกว้างกระดาษ · พิมพ์อัตโนมัติ · ความกว้างบนเว็บ — ต่างกันในแต่ละเครื่อง
// ร้าน (config key 'printing' ซิงก์ทั้งร้าน): จำนวนชุดใบเสร็จ
// ใบกำกับที่ลูกค้าพิมพ์เองและรายงาน A4 พิมพ์ผ่านกล่องพิมพ์ของเบราว์เซอร์ จึงไม่มีตัวเลือกที่นี่

export const DEVICE_KEY = 'punpang.print.v2'
export const LEGACY_DEVICE_KEY = 'punpang.device.v1' // ค่าเวอร์ชันเดิม (เครื่องพิมพ์กับความกว้างเดียว) ย้ายครั้งแรกแล้วไม่ลบ

export const SECTION_KEYS = ['posReceipt', 'orderReceipt', 'taxInvoice']
export const RECEIPT_KEYS = ['posReceipt', 'orderReceipt']
export const SECTION_LABEL = {
  posReceipt: 'ใบเสร็จขาย POS',
  orderReceipt: 'ใบเสร็จออเดอร์ / พิมพ์ซ้ำ',
  taxInvoice: 'ใบกำกับ / ใบลดหนี้',
}
export const WIDTHS = [58, 80] // กระดาษความร้อนที่รองรับ (88 มม. ตัดออกแล้ว)
export const PAPER_PX = { 58: 384, 80: 576 } // ความกว้างจุดของภาพ ESC/POS

// ความกว้างจุดของกระดาษ · โยน error เมื่อไม่รองรับ (เดิมตกไปเป็น 58 มม. เงียบ ๆ)
export function pxFor(widthMm) {
  const px = PAPER_PX[widthMm]
  if (!px) throw new Error(`ความกว้างกระดาษ ${widthMm} มม. ไม่รองรับ (ใช้ 58 หรือ 80 มม.)`)
  return px
}

const toWidth = (v) => (WIDTHS.includes(Number(v)) ? Number(v) : null)
const toWebWidth = (v) => (v === 'auto' ? 'auto' : toWidth(v))
const toPrinter = (p) => (p && typeof p === 'object' && p.address ? { name: String(p.name || ''), address: String(p.address) } : null)

export function defaultDevice() {
  return {
    printers: { posReceipt: null, orderReceipt: null, taxInvoice: null }, // null ของใบกำกับ = ใช้เครื่องของใบเสร็จขาย
    widthMm: { posReceipt: 58, orderReceipt: 58, taxInvoice: null }, // null ของใบกำกับ = ใช้ความกว้างของใบเสร็จขาย
    webWidth: { posReceipt: 'auto', orderReceipt: 'auto' }, // บนเว็บ: auto = ตามไดรเวอร์
    autoPrint: { posReceipt: true, orderReceipt: true }, // พิมพ์อัตโนมัติหลังรับเงิน (แอป)
  }
}

// ค่าที่อ่านจากเครื่องต้องถูกต้องเสมอ: ค่าที่ไม่รู้จักถูกทิ้งและใช้ค่าเริ่มต้น
export function normalizeDevice(raw) {
  const d = defaultDevice()
  const r = raw && typeof raw === 'object' ? raw : {}
  for (const s of SECTION_KEYS) {
    d.printers[s] = toPrinter(r.printers?.[s])
    d.widthMm[s] = toWidth(r.widthMm?.[s])
  }
  for (const s of RECEIPT_KEYS) {
    d.widthMm[s] = toWidth(r.widthMm?.[s]) ?? 58
    d.webWidth[s] = toWebWidth(r.webWidth?.[s]) ?? 'auto'
    d.autoPrint[s] = typeof r.autoPrint?.[s] === 'boolean' ? r.autoPrint[s] : true
  }
  return d
}

// ค่าเวอร์ชันเดิม: เครื่องพิมพ์เดียวและความกว้างเดียวให้ทุกส่วนใบเสร็จ · ใบกำกับยังเป็น null (ตามใบเสร็จ) = พฤติกรรมเดิม
export function migrateDevice(legacy) {
  const d = defaultDevice()
  if (!legacy || typeof legacy !== 'object') return d
  const printer = toPrinter(legacy.printer)
  const w = toWidth(legacy.widthMm) ?? 58
  for (const s of RECEIPT_KEYS) {
    d.printers[s] = printer
    d.widthMm[s] = w
  }
  return d
}

// เครื่องพิมพ์ที่ใช้จริงของส่วนหนึ่ง (null = ยังไม่ได้เลือก)
export function printerFor(device, section) {
  return device.printers[section] || (section === 'taxInvoice' ? device.printers.posReceipt || null : null)
}

// ความกว้างกระดาษความร้อนที่ใช้จริง (58 หรือ 80 มม.)
export function widthFor(device, section) {
  if (device.widthMm[section] != null) return device.widthMm[section]
  return section === 'taxInvoice' ? widthFor(device, 'posReceipt') : 58
}

// ความกว้างบนเว็บ: 'auto' | 58 | 80
export function webWidthFor(device, section) {
  return device.webWidth?.[section] ?? 'auto'
}

export function autoPrintFor(device, section) {
  return device.autoPrint?.[section] !== false
}

// ค่าร้าน (ซิงก์ทั้งร้าน): จำนวนชุดใบเสร็จ 1–3 ชุดต่อครั้ง
export const DEFAULT_PRINTING = { copies: { posReceipt: 1, orderReceipt: 1 } }

export function clampCopies(v) {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 ? Math.min(n, 3) : 1
}

export function normalizePrinting(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}
  return { copies: Object.fromEntries(RECEIPT_KEYS.map((s) => [s, clampCopies(r.copies?.[s])])) }
}
