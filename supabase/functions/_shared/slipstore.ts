// ที่เก็บผลอ่านสลิป ใช้ร่วมกันทั้งแชทและหน้าสั่งของลูกค้า
// 1) ผลที่ตัวอ่านตอบแล้ว (อ่านได้หรือไม่ก็ตาม) จำไว้ตามเลขอ้างอิง (ธนาคารต้นทาง + ref) เลขเดิมจึงไม่ส่งโมเดลซ้ำ · ตัวอ่านผิดพลาดชั่วคราวไม่จำ รอบหน้าลองใหม่
// 2) สลิปที่อ่านไม่ครบ (ไม่มียอด / วัน-เวลา / เลขบัญชีผู้รับ อย่างใดอย่างหนึ่ง) เก็บรูปไว้ใน R2 ใต้ train/ ผ่าน Worker เพื่อนำไปเทรนภายหลัง · รูปเดิมเก็บครั้งเดียว · Worker ลบเองเมื่อครบ 30 วัน
// ไม่เก็บชื่อผู้รับ (ระบบไม่ได้ใช้ชื่อ) · เลขบัญชีเก็บตามที่สลิปปิดไว้
import { readSlipFieldsChain, type OcrEngine, type SlipFields } from './slipocr.ts'
import { svcDelete, svcUpload, type FilesEnv } from './filesvc.ts'
import { shopPartOf } from './slipref.ts'

// อ่านได้ = มียอดหรือวัน-เวลา (เกณฑ์เดียวกับการแนบป้ายในแชท)
export const usableFields = (f: SlipFields | null | undefined): f is SlipFields => !!f && (f.amount != null || f.paidAt != null)
// ครบ = มีทั้งยอด วัน-เวลา และเลขบัญชีผู้รับ · ไม่ครบ = อ่านไม่ผ่าน เข้าชุดเทรน
export const isCompleteSlip = (f: SlipFields | null | undefined): boolean => !!f && f.amount != null && f.paidAt != null && !!f.receiverAccount
const missingOf = (f: SlipFields | null | undefined): string[] => [
  f?.amount == null ? 'amount' : '',
  f?.paidAt == null ? 'paidAt' : '',
  !f?.receiverAccount ? 'receiverAccount' : '',
].filter(Boolean)

const hexOf = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256Hex = async (v: Uint8Array | string) => hexOf(await crypto.subtle.digest('SHA-256', typeof v === 'string' ? new TextEncoder().encode(v) : new Uint8Array(v)))
const cacheId = async (slipKey: string) => 'sk' + (await sha256Hex(slipKey)).slice(0, 40)

// ผลที่เคยได้ของเลขอ้างอิงนี้ (อ่านได้หรือไม่ก็ตาม) · ยังไม่เคย = null
export async function cachedSlipFields(sb: any, slipKey: string): Promise<SlipFields | null> {
  const id = await cacheId(slipKey)
  const f = (await sb.from('punpang_records').select('data').eq('collection', 'slipRead').eq('id', id).maybeSingle()).data?.data?.fields
  if (!f || typeof f !== 'object') return null
  return { amount: f.amount ?? null, paidAt: f.paidAt ?? null, receiverAccount: f.receiverAccount ?? null, ...shopPartOf(f) }
}

// จำผลที่ตัวอ่านตอบแล้วไว้ตามเลขอ้างอิง (ซ้ำ = ข้าม)
export async function cacheSlipFields(sb: any, slipKey: string, fields: SlipFields): Promise<boolean> {
  const id = await cacheId(slipKey)
  const r = await sb.from('punpang_records').insert({
    collection: 'slipRead', id,
    data: { fields: { amount: fields.amount ?? null, paidAt: fields.paidAt ?? null, receiverAccount: fields.receiverAccount ?? null, ...shopPartOf(fields) }, at: new Date().toISOString() },
  })
  return !r?.error
}

// สลิปที่อ่านไม่ครบ: เก็บรูปไว้ใน R2 ใต้ train/ (ผ่าน Worker) แล้วบันทึกรายการ slipTrain พร้อมผลที่อ่านได้และฟิลด์ที่ขาด
// บันทึกรายการไม่สำเร็จ → ลบรูปที่เพิ่งอัปโหลด ไม่ให้ค้างโดยไม่มีรายการ
export async function saveFailedSlip(sb: any, o: { bytes: Uint8Array; bankCode: string; source: 'chat' | 'order'; fields: SlipFields; files: FilesEnv }): Promise<boolean> {
  if (isCompleteSlip(o.fields)) return false
  const hash = await sha256Hex(o.bytes)
  const id = 'st' + hash.slice(0, 40)
  const exists = (await sb.from('punpang_records').select('id').eq('collection', 'slipTrain').eq('id', id).maybeSingle()).data
  if (exists) return false
  let s: { key: string; ref: string }
  try { s = await svcUpload(o.files, o.bytes, 'train') } catch { return false }
  const r = await sb.from('punpang_records').insert({
    collection: 'slipTrain', id,
    data: {
      at: new Date().toISOString(), source: o.source, bankCode: o.bankCode, path: s.key, missing: missingOf(o.fields),
      fields: { amount: o.fields.amount ?? null, paidAt: o.fields.paidAt ?? null, receiverAccount: o.fields.receiverAccount ?? null, ...shopPartOf(o.fields) },
    },
  })
  if (r?.error) { await svcDelete(o.files, [s.key]); return false }
  return true
}

// เพดานการเรียกโมเดลอ่านสลิปรวมทั้งร้านต่อชั่วโมง (นับผลอ่านที่จำไว้ในชั่วโมงล่าสุด · 1 ผล = 1 การเรียก)
// กันการส่งสลิป QR ปลอมที่รูปแบบถูกต้อง (สร้างได้ฟรี และเลขอ้างอิงใหม่ทุกครั้งจึงไม่เคยถูกจำผล) เพื่อเผาค่า AI
// เกินเพดาน = ไม่เรียกโมเดล (ผลที่จำไว้แล้วยังใช้ได้) · สลิปยังถูกเก็บให้พนักงานตรวจเอง · นับไม่ได้ (ฐานข้อมูลขัดข้อง) = ไม่ถือว่าเกิน
export const OCR_HOURLY_CAP = 300
export async function ocrOverHourlyCap(sb: any, nowMs: number = Date.now(), cap: number = OCR_HOURLY_CAP): Promise<boolean> {
  try {
    const since = new Date(nowMs - 3_600_000).toISOString()
    const r = await sb.from('punpang_records').select('id', { count: 'exact', head: true }).eq('collection', 'slipRead').gte('data->>at', since)
    return !r?.error && Number(r?.count ?? 0) >= cap
  } catch { return false }
}

// อ่านยอด วัน-เวลา และเลขบัญชีผู้รับของสลิปหนึ่งใบ (ใช้ทั้งแชทและหน้าสั่งของลูกค้า)
// มีผลที่เคยได้ตามเลขอ้างอิงแล้ว → ใช้ผลนั้น ไม่เรียกตัวอ่าน · ไม่มี → เรียกตัวอ่านตามลำดับ แล้วจำผลที่ตอบแล้ว และเก็บสลิปที่อ่านไม่ครบเข้าชุดเทรน
// ตัวอ่านผิดพลาดชั่วคราวโดยยังไม่ได้ผลที่ใช้ได้ → คืนผลให้คำขอนี้ แต่ไม่จำ (รอบหน้าลองอ่านใหม่)
// allowModel = false: ผู้เรียกบอกว่าเกินเพดานของตัวเองแล้ว (เช่น ต่อแชท) → ใช้ได้เฉพาะผลที่จำไว้ ไม่เรียกโมเดล
export async function readSlipOnce(sb: any, o: { key: string; bytes: Uint8Array; bankCode: string; source: 'chat' | 'order'; engines: OcrEngine[]; files: FilesEnv; allowModel?: boolean; nowMs?: number }): Promise<SlipFields | null> {
  if (!o.engines.length) return null
  const hit = await cachedSlipFields(sb, o.key)
  if (hit) return hit
  if (o.allowModel === false || await ocrOverHourlyCap(sb, o.nowMs)) return null // ไม่จำผล: พ้นเพดานแล้วสลิปเดิมอ่านได้ใหม่
  const status = { errored: false }
  const fields = await readSlipFieldsChain(o.bytes, o.engines, status)
  if (!fields) return null
  if (status.errored && !usableFields(fields)) return fields
  await cacheSlipFields(sb, o.key, fields)
  await saveFailedSlip(sb, { bytes: o.bytes, bankCode: o.bankCode, source: o.source, fields, files: o.files })
  return fields
}
