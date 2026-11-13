// ที่เก็บผลอ่านสลิป: (1) ค่าที่อ่านได้ของเลขอ้างอิงนี้ ใช้ซ้ำแทนการเรียกโมเดลอีก เพื่อประหยัด
// (2) สลิปที่อ่านไม่ผ่าน (ไม่ได้ยอดและวัน-เวลา) เก็บรูปไว้โฟลเดอร์ train/ แยกจากสลิปของออร์เดอร์ พร้อมผลที่โมเดลตอบ เพื่อนำไปเทรนภายหลัง
// ไม่เก็บชื่อผู้รับ · เลขบัญชีที่เก็บคงรูปแบบที่สลิปปิดไว้
import type { SlipFields } from './slipocr.ts'

// ผลที่ใช้ได้ = อ่านยอดหรือวัน-เวลาได้ (เกณฑ์เดียวกับการแนบป้ายในแชท)
export const usableFields = (f: SlipFields | null | undefined): f is SlipFields => !!f && (f.amount != null || f.paidAt != null)

const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (v: Uint8Array | string) => hexOf(await crypto.subtle.digest('SHA-256', typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)))
const cacheId = async (slipKey: string) => 'sk' + (await sha256Hex(slipKey)).slice(0, 40)

// ค่าที่เคยอ่านได้ของเลขอ้างอิงนี้ · ไม่มีหรือใช้ไม่ได้ = null
export async function cachedSlipFields(sb: any, slipKey: string): Promise<SlipFields | null> {
  const id = await cacheId(slipKey)
  const f = (await sb.from('punpang_records').select('data').eq('collection', 'slipRead').eq('id', id).maybeSingle()).data?.data?.fields
  if (!usableFields(f)) return null
  return { amount: f.amount ?? null, paidAt: f.paidAt ?? null, receiverAccount: f.receiverAccount ?? null }
}

// เก็บค่าที่อ่านได้ไว้ใช้ซ้ำ · ผลที่ใช้ไม่ได้ไม่เก็บ เพื่อให้ลองอ่านใหม่เมื่อเจอสลิปเดิม
export async function cacheSlipFields(sb: any, slipKey: string, fields: SlipFields): Promise<boolean> {
  if (!usableFields(fields)) return false
  const id = await cacheId(slipKey)
  const r = await sb.from('punpang_records').insert({
    collection: 'slipRead', id,
    data: { fields: { amount: fields.amount ?? null, paidAt: fields.paidAt ?? null, receiverAccount: fields.receiverAccount ?? null }, at: new Date().toISOString() },
  })
  return !r?.error
}

// สลิปที่อ่านไม่ผ่าน: เก็บรูปไว้โฟลเดอร์ train/ (ชื่อไฟล์จากแฮชของรูป) และบันทึกผลที่โมเดลตอบ · รูปเดิมเก็บครั้งเดียว
export async function saveFailedSlip(sb: any, o: { bytes: Uint8Array; bankCode: string; source: 'chat' | 'order'; attempts: Array<SlipFields | null> }): Promise<boolean> {
  const hash = await sha256Hex(o.bytes)
  const id = 'st' + hash.slice(0, 40)
  const exists = (await sb.from('punpang_records').select('id').eq('collection', 'slipTrain').eq('id', id).maybeSingle()).data
  if (exists) return false
  const ext = o.bytes[0] === 0x89 ? 'png' : 'jpg'
  const path = `train/${hash}.${ext}`
  const up = await sb.storage.from('punpang-slips').upload(path, o.bytes, { contentType: ext === 'png' ? 'image/png' : 'image/jpeg', upsert: false })
  if (up?.error) return false
  const r = await sb.from('punpang_records').insert({
    collection: 'slipTrain', id,
    data: {
      at: new Date().toISOString(), source: o.source, bankCode: o.bankCode, path, reason: 'no_amount_or_date',
      attempts: o.attempts.map((f) => ({ amount: f?.amount ?? null, paidAt: f?.paidAt ?? null, receiverAccount: f?.receiverAccount ?? null })),
    },
  })
  return !r?.error
}
