// ใบเสร็จและใบทดสอบแบบภาพ (raster ESC/POS) · วาดด้วยฟอนต์ของแอปแล้วส่งเป็นภาพ
// ข้อดี: ภาษาไทยแสดงได้ถูกต้องโดยไม่ต้องรู้ code page ของเครื่องพิมพ์
import { db, findCustomer, customerPoints } from '../data/store'
import { receiptFacts, maskPhone } from './receiptFacts'
import { money, dateTime, dateOnly, orderNo } from './format'
import { branchLabel } from './acct/taxid'
import { printBytes, getDevice } from './nativeDevices'
import { pxFor, printerFor, widthFor, normalizePrinting, SECTION_LABEL } from './printConfig'
import QRCode from 'qrcode'

const FAMILY = 'Prompt, Mitr, Tahoma, sans-serif'
const BAND_ROWS = 240 // ส่งภาพทีละช่วงแถว กันบัฟเฟอร์ของเครื่องพิมพ์ล้น

let measurer = null
const mctx = () => (measurer ||= document.createElement('canvas').getContext('2d'))
const measure = (text, font) => {
  const c = mctx()
  c.font = font
  return c.measureText(text).width
}
const fontOf = (kind, base) => {
  if (kind === 'title') return `700 ${base + 8}px ${FAMILY}`
  if (kind === 'bold') return `700 ${base}px ${FAMILY}`
  if (kind === 'small') return `${base - 4}px ${FAMILY}`
  return `${base}px ${FAMILY}`
}
const lineHeight = (kind, base) => Math.round((kind === 'title' ? base + 8 : kind === 'small' ? base - 4 : base) * 1.35)

// ตัดบรรทัดตามความกว้าง: ถ้ามีช่องว่างให้ตัดที่ช่องว่างล่าสุด (ตัวเลข/อังกฤษ) ไม่งั้นตัดทีละตัวอักษร (ภาษาไทย)
function wrap(text, font, maxW) {
  const out = []
  let cur = ''
  for (const ch of String(text ?? '')) {
    const next = cur + ch
    if (cur && measure(next, font) > maxW) {
      const sp = cur.lastIndexOf(' ')
      if (sp > 0) {
        out.push(cur.slice(0, sp))
        cur = cur.slice(sp + 1) + ch
      } else {
        out.push(cur)
        cur = ch
      }
    } else {
      cur = next
    }
  }
  out.push(cur)
  return out
}

function writer(widthPx) {
  const base = widthPx >= 576 ? 26 : 22
  const pad = 14
  const ops = []
  let y = 8
  return {
    widthPx,
    pad,
    ops,
    text(s, { align = 'left', kind = 'normal' } = {}) {
      const font = fontOf(kind, base)
      for (const line of wrap(s, font, widthPx - pad * 2)) {
        ops.push({ y, t: line, align, font })
        y += lineHeight(kind, base)
      }
    },
    pair(left, right, { kind = 'normal' } = {}) {
      const font = fontOf(kind, base)
      const rightW = measure(right, font)
      const lines = wrap(left, font, widthPx - pad * 2 - rightW - 10)
      lines.forEach((line, i) => {
        ops.push({ y, t: line, align: 'left', font })
        if (i === 0) ops.push({ y, t: right, align: 'right', font })
        y += lineHeight(kind, base)
      })
    },
    rule() {
      ops.push({ y, rule: true })
      y += 16
    },
    // รูป (เช่น QR ลุ้นโชค) กึ่งกลางตามความกว้างกระดาษ · size = ด้านละกี่จุด
    image(canvas, size) {
      ops.push({ y, img: canvas, size, x: Math.round((widthPx - size) / 2) })
      y += size + 6
    },
    height() {
      return y + 16
    },
  }
}

function draw(w) {
  const c = document.createElement('canvas')
  c.width = w.widthPx
  c.height = w.height()
  const g = c.getContext('2d')
  g.fillStyle = '#fff'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#000'
  g.textBaseline = 'top'
  for (const op of w.ops) {
    if (op.rule) {
      for (let x = w.pad; x < c.width - w.pad; x += 10) g.fillRect(x, op.y + 6, 6, 2)
      continue
    }
    if (op.img) {
      g.drawImage(op.img, op.x, op.y, op.size, op.size)
      continue
    }
    g.font = op.font
    const tw = g.measureText(op.t).width
    const x = op.align === 'center' ? (c.width - tw) / 2 : op.align === 'right' ? c.width - w.pad - tw : w.pad
    g.fillText(op.t, x, op.y)
  }
  return c
}

// ภาพขาวดำ: จุดที่มืด = 1 (พิมพ์) · เก็บเป็นบิตต่อแถว
function toRaster(canvas) {
  const w = canvas.width
  const h = canvas.height
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data
  const bpr = Math.ceil(w / 8)
  const bits = new Uint8Array(bpr * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const lum = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114
      if (lum < 150) bits[y * bpr + (x >> 3)] |= 0x80 >> (x & 7)
    }
  }
  return { bpr, h, bits }
}

const concat = (arrs) => {
  const n = arrs.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const a of arrs) {
    out.set(a, o)
    o += a.length
  }
  return out
}

// คำสั่ง ESC/POS: เริ่มเครื่อง → ภาพแบบ GS v 0 เป็นช่วง ๆ → ป้อนกระดาษ → ตัดกระดาษ
function escpos({ bpr, h, bits }) {
  const parts = [new Uint8Array([0x1b, 0x40])]
  for (let y0 = 0; y0 < h; y0 += BAND_ROWS) {
    const rows = Math.min(BAND_ROWS, h - y0)
    parts.push(new Uint8Array([0x1d, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, rows & 0xff, (rows >> 8) & 0xff]))
    parts.push(bits.subarray(y0 * bpr, (y0 + rows) * bpr))
  }
  parts.push(new Uint8Array([0x1b, 0x64, 0x04]))
  parts.push(new Uint8Array([0x1d, 0x56, 0x42, 0x00]))
  return concat(parts)
}

async function loadFont() {
  try {
    await document.fonts.load('22px Prompt')
    await document.fonts.load('700 22px Prompt')
  } catch {
    // ใช้ฟอนต์สำรองถ้าโหลดไม่ได้
  }
}

// ใบเสร็จจากออเดอร์ (ข้อมูลเดียวกับใบเสร็จบนจอ)
// QR ลุ้นโชคท้ายบิล (ขาวดำ วาดลงผ้าใบแล้วแปลงเป็นบิตเหมือนข้อความ)
async function luckyQrCanvas(url, px) {
  const c = document.createElement('canvas')
  await QRCode.toCanvas(c, url, { width: px, margin: 1 })
  return c
}

export async function buildReceiptBytes(order, widthMm, opts = {}) {
  await loadFont()
  const customer = findCustomer(order.customerId)
  // ข้อมูลชุดเดียวกับใบเสร็จบนจอ (receiptFacts) เพื่อให้กระดาษกับหน้าจอตรงกัน
  const f = receiptFacts(order, { shop: db.shop, legal: db.legal, storefront: db.storefront, customer, points: customer ? customerPoints(customer) : null })
  const w = writer(pxFor(widthMm))
  w.text(f.shopName, { align: 'center', kind: 'title' })
  if (f.shopAddress) w.text(f.shopAddress, { align: 'center', kind: 'small' })
  if (f.shopPhone) w.text(`โทร ${f.shopPhone}`, { align: 'center', kind: 'small' })
  if (f.shopHours.length) {
    w.text('เวลาเปิด', { align: 'center', kind: 'small' })
    for (const h of f.shopHours) w.text(`${h.days} ${h.time}`, { align: 'center', kind: 'small' })
  }
  w.text('ใบเสร็จรับเงิน', { align: 'center' })
  w.text(`${orderNo(order.code)} · ${dateTime(order.createdAt)}`, { align: 'center', kind: 'small' })
  if (f.vatLegalName) w.text(f.vatLegalName, { align: 'center', kind: 'small' })
  if (f.vatTaxId) w.text(`เลขประจำตัวผู้เสียภาษี ${f.vatTaxId}`, { align: 'center', kind: 'small' })
  if (f.cancelled) w.text('** ยกเลิกแล้ว **', { align: 'center', kind: 'bold' })
  w.rule()
  for (const it of order.items || []) {
    w.pair(`${it.qty} × ${it.name}`, money((it.fullPrice ?? it.unitPrice) * it.qty))
    for (const m of it.mods || []) w.text(`   ${m.name}${m.price ? ` +${m.price}` : ''}`, { kind: 'small' })
  }
  w.rule()
  w.pair('รวม', money(f.full))
  for (const l of f.discountLines) w.pair(l.label, `−${money(l.amount)}`)
  if (f.vatMode === 'exclusive') w.pair(`VAT ${f.vatRate}% (บวกเพิ่ม)`, money(f.vat))
  w.pair('ยอดสุทธิ', money(f.total), { kind: 'bold' })
  if (f.vatMode === 'inclusive') {
    w.pair('ราคาก่อน VAT', money(f.beforeVat), { kind: 'small' })
    w.pair(`VAT ${f.vatRate}% (รวมในราคาแล้ว)`, money(f.vat), { kind: 'small' })
  }
  for (const p of f.payments) {
    w.pair(p.method, money(p.amount))
    if (p.change) {
      w.pair('   รับเงินมา', money(p.received), { kind: 'small' })
      w.pair('   เงินทอน', money(p.change), { kind: 'small' })
    }
    if (p.qrRef) w.text(`Ref2 ${p.qrRef}`, { kind: 'small' })
  }
  if (f.payments.length > 1) w.pair('รวมรับชำระ', money(f.paidTotal), { kind: 'bold' })
  if (f.balance > 0) w.pair('ยังค้างชำระ', money(f.balance), { kind: 'bold' })
  if (f.nextDue) w.text(`ชำระก่อน ${f.nextDue.at} · ${f.nextDue.amount}`, { kind: 'small' })
  if (f.fulfillment) {
    w.rule()
    w.text(`${f.fulfillment.label}${f.fulfillment.at ? ` · ${f.fulfillment.at}` : ''}`, { kind: 'bold' })
    if (f.fulfillment.address) w.text(f.fulfillment.address, { kind: 'small' })
  }
  if (f.customer) {
    w.rule()
    w.text(`${f.customer.label}: ${f.customer.name}`)
    if (f.customer.phone) w.text(`โทร ${maskPhone(f.customer.phone)}`, { kind: 'small' })
    if (f.customer.earned) w.text(`ได้รับ ${f.customer.earned} คะแนน${f.customer.bonus ? ` (โบนัสโปร +${f.customer.bonus})` : ''}`, { kind: 'small' })
    if (f.customer.pointsLeft != null) w.text(`คะแนนคงเหลือ ${f.customer.pointsLeft}`, { kind: 'small' })
  }
  w.rule()
  w.text('ขอบคุณที่ใช้บริการค่ะ', { align: 'center' })
  if (opts.luckyUrl) {
    const qr = await luckyQrCanvas(opts.luckyUrl, 200)
    w.text('ลุ้นโชคท้ายบิล', { align: 'center', kind: 'bold' })
    w.image(qr, 200)
    w.text('สแกน QR เพื่อลุ้นโชค', { align: 'center', kind: 'small' })
  }
  return escpos(toRaster(draw(w)))
}

// ใบทดสอบ: ดูว่าเครื่องพิมพ์ได้และภาษาไทยอ่านออก · label = ชื่อส่วนที่ทดสอบ
export async function buildTestBytes(widthMm, label = '') {
  await loadFont()
  const w = writer(pxFor(widthMm))
  w.text('ทดสอบเครื่องพิมพ์', { align: 'center', kind: 'title' })
  if (label) w.text(label, { align: 'center', kind: 'bold' })
  w.text(db.shop?.name || '', { align: 'center' })
  w.rule()
  w.text('ภาษาไทย: กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ')
  w.text('สระและวรรณยุกต์: ะ า ิ ี ึ ื ุ ู เ แ โ ใ ไ ั ็ ่ ้ ๊ ๋ ์ ํ ฯ ๆ')
  w.text('ตัวเลข 0123456789 · ABCabc · ฿ 1,234.00')
  w.rule()
  w.text(`กระดาษ ${widthMm} มม. · ${dateTime(new Date().toISOString())}`, { kind: 'small' })
  return escpos(toRaster(draw(w)))
}

// พิมพ์ใบเสร็จของส่วนที่ระบุ (posReceipt | orderReceipt) ตามเครื่องพิมพ์ ความกว้าง และจำนวนชุดของส่วนนั้น
// ชุดที่ 2 ขึ้นไปไม่พิมพ์ QR ลุ้นโชค (กันสแกนซ้ำ) · ทุกชุดส่งเป็นงานเดียว
export async function printOrderReceipt(order, opts = {}) {
  const section = opts.section || 'posReceipt'
  const device = getDevice()
  const address = printerFor(device, section)?.address
  if (!address) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์')
  const width = widthFor(device, section)
  const copies = normalizePrinting(db.printing).copies[section] || 1
  const parts = [await buildReceiptBytes(order, width, opts)]
  if (copies > 1) {
    const again = await buildReceiptBytes(order, width, { ...opts, luckyUrl: '' })
    for (let i = 1; i < copies; i++) parts.push(again)
  }
  await printBytes(address, concat(parts))
}

// ใบกำกับภาษีเต็มรูปแบบกระดาษความร้อน (58 / 80 มม.) · label = ต้นฉบับ / สำเนา
export async function buildTaxInvoiceBytes(inv, widthMm, label = 'ต้นฉบับ') {
  await loadFont()
  const w = writer(pxFor(widthMm))
  const credit = inv.type === 'credit'
  const sign = credit ? -1 : 1
  const m = (n) => money(sign * n)
  w.text(inv.seller.name, { align: 'center', kind: 'title' })
  if (inv.seller.address) w.text(inv.seller.address, { align: 'center', kind: 'small' })
  w.text(`เลขประจำตัวผู้เสียภาษี ${inv.seller.taxId} · ${branchLabel(inv.seller.branch)}`, { align: 'center', kind: 'small' })
  w.rule()
  w.text(credit ? 'ใบลดหนี้ / ใบกำกับภาษี' : 'ใบกำกับภาษี', { align: 'center', kind: 'bold' })
  w.text(`(${label}) เลขที่ ${inv.no}`, { align: 'center' })
  w.text(`วันที่ ${dateOnly(inv.date)}`, { align: 'center' })
  if (credit) w.text(`อ้างถึงใบกำกับภาษีเลขที่ ${inv.refNo}`, { align: 'center', kind: 'small' })
  w.rule()
  w.text(`ผู้ซื้อ: ${inv.buyer.name}`, { kind: 'bold' })
  if (inv.buyer.address) w.text(inv.buyer.address, { kind: 'small' })
  w.text(`เลขประจำตัวผู้เสียภาษี ${inv.buyer.taxId} · ${branchLabel(inv.buyer.branch)}`, { kind: 'small' })
  w.text(`อ้างอิงออร์เดอร์ ${inv.orderCode}`, { kind: 'small' })
  w.rule()
  for (const l of inv.lines || []) {
    w.pair(`${l.qty} × ${l.name}`, m(l.amount))
    w.text(`   @ ${m(l.unitPrice)}`, { kind: 'small' })
  }
  for (const d of inv.discounts || []) w.pair(`ส่วนลด: ${d.label}`, m(-d.amount))
  w.rule()
  w.pair('มูลค่าก่อนภาษีมูลค่าเพิ่ม', m(inv.beforeVat))
  w.pair(`ภาษีมูลค่าเพิ่ม ${inv.rate}%`, m(inv.vat))
  w.pair(credit ? 'ยอดลดหนี้รวมภาษี' : 'รวมทั้งสิ้น', m(inv.total), { kind: 'bold' })
  w.text(inv.mode === 'exclusive' ? '(ราคาไม่รวมภาษี บวกภาษีท้ายยอด)' : '(ราคารวมภาษีมูลค่าเพิ่มแล้ว)', { kind: 'small' })
  w.text(`ตัวอักษร: ${credit ? 'ลบ' : ''}${inv.totalText || ''}`)
  w.rule()
  w.text('ผู้รับสินค้า/บริการ ________________', { kind: 'small' })
  w.text('ผู้มีอำนาจลงนาม ________________', { kind: 'small' })
  return escpos(toRaster(draw(w)))
}

// พิมพ์ใบกำกับภาษีไปยังเครื่องพิมพ์ความร้อนของส่วนใบกำกับ (ความกว้างตามหน้าตั้งค่า)
export async function printTaxInvoice(inv, label = 'ต้นฉบับ') {
  const device = getDevice()
  const address = printerFor(device, 'taxInvoice')?.address
  if (!address) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์ใบกำกับ')
  await printBytes(address, await buildTaxInvoiceBytes(inv, widthFor(device, 'taxInvoice'), label))
}

// ใบทดสอบของส่วนที่ระบุ: ใช้เครื่องพิมพ์และความกว้างของส่วนนั้น
export async function printTestPage(section = 'posReceipt') {
  const device = getDevice()
  const address = printerFor(device, section)?.address
  if (!address) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์')
  await printBytes(address, await buildTestBytes(widthFor(device, section), SECTION_LABEL[section] || ''))
}
