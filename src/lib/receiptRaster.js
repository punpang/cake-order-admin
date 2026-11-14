// ใบเสร็จและใบทดสอบแบบภาพ (raster ESC/POS) · วาดด้วยฟอนต์ของแอปแล้วส่งเป็นภาพ
// ข้อดี: ภาษาไทยแสดงได้ถูกต้องโดยไม่ต้องรู้ code page ของเครื่องพิมพ์
import { db } from '../data/store'
import { orderTotals } from './pricing'
import { money, dateTime, orderNo } from './format'
import { printBytes, getDeviceConfig } from './nativeDevices'

const PX = { 58: 384, 80: 576 } // ความกว้างจุดของกระดาษ 58 มม. / 80 มม.
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
export async function buildReceiptBytes(order, widthMm) {
  await loadFont()
  const shop = db.shop || {}
  const w = writer(PX[widthMm] || PX[58])
  const t = orderTotals(order)
  w.text(shop.name || 'ร้าน', { align: 'center', kind: 'title' })
  w.text('ใบเสร็จรับเงิน', { align: 'center' })
  w.text(`${orderNo(order.code)} · ${dateTime(order.createdAt)}`, { align: 'center', kind: 'small' })
  if (t.vatMode && shop.vat?.legalName) w.text(shop.vat.legalName, { align: 'center', kind: 'small' })
  if (t.vatMode && shop.vat?.taxId) w.text(`เลขประจำตัวผู้เสียภาษี ${shop.vat.taxId}`, { align: 'center', kind: 'small' })
  w.rule()
  for (const it of order.items || []) {
    w.pair(`${it.qty} × ${it.name}`, money((it.fullPrice ?? it.unitPrice) * it.qty))
    for (const m of it.mods || []) w.text(`   ${m.name}${m.price ? ` +${m.price}` : ''}`, { kind: 'small' })
  }
  w.rule()
  w.pair('รวม', money(t.full))
  for (const l of t.discountLines || []) w.pair(l.label, `−${money(l.amount)}`)
  if (t.vatMode === 'exclusive') w.pair(`VAT ${t.vatRate}% (บวกเพิ่ม)`, money(t.vat))
  w.pair('ยอดสุทธิ', money(t.total), { kind: 'bold' })
  if (t.vatMode === 'inclusive') w.text(`รวม VAT ${t.vatRate}% แล้ว ${money(t.vat)}`, { kind: 'small' })
  for (const p of (order.payments || []).filter((x) => x.status === 'confirmed')) {
    w.pair(p.method, money(p.received ?? p.amount))
    if (p.change) w.pair('เงินทอน', money(p.change))
  }
  w.rule()
  w.text('ขอบคุณที่ใช้บริการค่ะ', { align: 'center' })
  return escpos(toRaster(draw(w)))
}

// ใบทดสอบ: ดูว่าเครื่องพิมพ์ได้และภาษาไทยอ่านออก
export async function buildTestBytes(widthMm) {
  await loadFont()
  const w = writer(PX[widthMm] || PX[58])
  w.text('ทดสอบเครื่องพิมพ์', { align: 'center', kind: 'title' })
  w.text(db.shop?.name || '', { align: 'center' })
  w.rule()
  w.text('ภาษาไทย: กขฃคฅฆงจฉชซฌญฎฏฐฑฒณดตถทธนบปผฝพฟภมยรลวศษสหฬอฮ')
  w.text('สระและวรรณยุกต์: ะ า ิ ี ึ ื ุ ู เ แ โ ใ ไ ั ็ ่ ้ ๊ ๋ ์ ํ ฯ ๆ')
  w.text('ตัวเลข 0123456789 · ABCabc · ฿ 1,234.00')
  w.rule()
  w.text(`กระดาษ ${widthMm} มม. · ${dateTime(new Date().toISOString())}`, { kind: 'small' })
  return escpos(toRaster(draw(w)))
}

// พิมพ์ใบเสร็จไปยังเครื่องที่เลือกไว้ (ใช้หลังขายครบทุกครั้ง)
export async function printOrderReceipt(order) {
  const cfg = getDeviceConfig()
  if (!cfg.printer?.address) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์')
  await printBytes(cfg.printer.address, await buildReceiptBytes(order, cfg.widthMm))
}

export async function printTestPage() {
  const cfg = getDeviceConfig()
  if (!cfg.printer?.address) throw new Error('ยังไม่ได้เลือกเครื่องพิมพ์')
  await printBytes(cfg.printer.address, await buildTestBytes(cfg.widthMm))
}
