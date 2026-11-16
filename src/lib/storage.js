// อัปโหลดและเสิร์ฟไฟล์ผ่าน Worker punpang-files (R2) เท่านั้น — ไฟล์ใหม่ไม่เขียนลง Supabase Storage แล้ว
// รูปสาธารณะ (สินค้า/หน้าร้าน/ที่เผยแพร่) → /upload?bucket=public (ลิงก์ถาวร https) · รูปส่วนตัว (สลิป/รูปงาน/รูปอ้างอิง/รูปแชท) → /upload?bucket=private (อ้างอิง r2://private/…)
// ไฟล์เดิมใน Supabase Storage (อ้างอิง sb://…) อ่านได้ตามเดิมจนหมดอายุ · ไม่มีการเขียนใหม่ลง Supabase
// รูปที่เพิ่งเลือกจะเป็น data: / blob: (อยู่ในเบราว์เซอร์เท่านั้น) → ก่อนเขียนลงฐานข้อมูลต้องอัปโหลดแล้วแทนที่ด้วยลิงก์/อ้างอิง
import { fileApiAllowedInTest, testModeOn, TEST_FILE_WRITE_MSG, TEST_UPLOAD_MSG } from './testMode.js'
export const PUBLIC_BUCKET = 'punpang-public'
const LOCAL = /^(data:image\/(png|jpe?g|webp|gif);base64,|blob:)/
export const isLocalImage = (v) => typeof v === 'string' && LOCAL.test(v)
const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 + 1024
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
// Worker punpang-files (R2): ต้องตั้ง VITE_FILES_URL จึงอัปโหลดได้
const FILES_URL = (import.meta.env.VITE_FILES_URL || '').replace(/\/$/, '')
export const filesEnabled = () => !!FILES_URL
export const filesBase = () => FILES_URL
const NO_FILES = 'ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ไฟล์ (VITE_FILES_URL)'
async function filesAuth(client) {
  const sess = (await client.auth.getSession()).data.session
  return sess?.access_token ? { Authorization: `Bearer ${sess.access_token}` } : {}
}
// เรียก API ของ Worker ที่ต้องมีการยืนยันตัวตนพนักงาน (จัดการพื้นที่รูป)
export async function filesApi(client, path, body = {}) {
  if (!FILES_URL) throw new Error(NO_FILES)
  if (testModeOn() && !fileApiAllowedInTest(path)) throw new Error(TEST_FILE_WRITE_MSG) // โหมดทดสอบแก้ไฟล์จริงไม่ได้
  const r = await fetch(`${FILES_URL}${path}`, { method: 'POST', headers: { ...(await filesAuth(client)), 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'เรียกเซิร์ฟเวอร์ไฟล์ไม่สำเร็จ')
  return j
}
async function filesUpload(client, blob, type, bucket, prefix) {
  if (!FILES_URL) throw new Error(NO_FILES)
  if (testModeOn()) throw new Error(TEST_UPLOAD_MSG) // โหมดทดสอบไม่อัปโหลดไฟล์ไปที่ R2 จริง
  const r = await fetch(`${FILES_URL}/upload?bucket=${bucket}&prefix=${encodeURIComponent(prefix)}`, { method: 'POST', headers: { ...(await filesAuth(client)), 'Content-Type': type }, body: blob })
  const j = await r.json().catch(() => ({}))
  if (!r.ok || (!j.url && !j.ref)) throw new Error(j.error || 'อัปโหลดรูปไม่สำเร็จ')
  return j
}

export async function uploadPublicImage(client, src, prefix) {
  const blob = await (await fetch(src)).blob()
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('รูปใหญ่เกิน 2 MB')
  const type = EXT[blob.type] ? blob.type : 'image/jpeg'
  return (await filesUpload(client, blob, type, 'public', prefix)).url
}

// อัปโหลดรูปแชท (จาก Blob) ไป R2 → คืนอ้างอิง r2://private/<key> · ขนาดจำกัดโดย Worker
export async function uploadPrivateBlob(client, blob, type, prefix) {
  return (await filesUpload(client, blob, EXT[type] ? type : 'image/jpeg', 'private', prefix)).ref
}

// เดินทั้งต้นไม้ข้อมูล แทนที่รูปในเครื่องด้วยลิงก์ที่อัปโหลดแล้ว (แก้ในที่เดิม · รูปเดียวกันอัปโหลดครั้งเดียว) · ล้มเหลว = โยน error (ผู้เรียกไม่เขียนลงฐานข้อมูล)
// คืนจำนวนรูปที่อัปโหลด
export async function externalizePublic(client, root, prefix, cache = new Map()) {
  let n = 0
  const walk = async (node) => {
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) {
        if (isLocalImage(node[i])) node[i] = await resolveOne(node[i])
        else if (node[i] && typeof node[i] === 'object') await walk(node[i])
      }
    } else if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        if (isLocalImage(node[k])) node[k] = await resolveOne(node[k])
        else if (node[k] && typeof node[k] === 'object') await walk(node[k])
      }
    }
  }
  const resolveOne = async (src) => {
    if (!cache.has(src)) { cache.set(src, await uploadPublicImage(client, src, prefix)); n++ }
    return cache.get(src)
  }
  await walk(root)
  return n
}

// อ้างอิงรูปส่วนตัว: r2://private/<key> = Worker (R2) · sb://<bucket>/<path> = ไฟล์เดิมใน Supabase (อ่านอย่างเดียว)
const REF = /^sb:\/\/([a-z0-9-]+)\/(.+)$/
const R2_REF = /^r2:\/\/private\/(.+)$/
export const parseRef = (v) => {
  if (typeof v !== 'string') return null
  const r = R2_REF.exec(v)
  if (r) return { bucket: 'r2', path: r[1] }
  const m = REF.exec(v)
  return m ? { bucket: m[1], path: m[2] } : null
}

// รูปส่วนตัวของออร์เดอร์ (สลิป/รูปงาน/รูปอ้างอิง) → R2 ผ่าน Worker · คืนอ้างอิง r2://private/<key> · ล้มเหลว = โยน error
export async function uploadPrivateImage(client, src, prefix) {
  const blob = await (await fetch(src)).blob()
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('รูปใหญ่เกิน 2 MB')
  const type = EXT[blob.type] ? blob.type : 'image/jpeg'
  return (await filesUpload(client, blob, type, 'private', prefix)).ref
}

// รูปส่วนตัวของออร์เดอร์: รูปในเครื่อง → อัปโหลดแล้วแทนที่ด้วยอ้างอิง (แก้ในที่เดิม · รูปเดียวกันอัปโหลดครั้งเดียว) · ล้มเหลว = โยน error
export async function externalizeOrderImages(client, order, cache = new Map()) {
  let n = 0
  const one = async (src, prefix) => {
    const k = prefix + '|' + src
    if (!cache.has(k)) { cache.set(k, await uploadPrivateImage(client, src, prefix)); n++ }
    return cache.get(k)
  }
  for (const p of order.payments || []) if (isLocalImage(p.slip)) p.slip = await one(p.slip, order.id)
  for (const it of order.items || []) {
    for (const w of it.workPhotos || []) if (isLocalImage(w.image)) w.image = await one(w.image, `${order.id}/work`)
    const im = it.images || []
    for (let i = 0; i < im.length; i++) if (isLocalImage(im[i])) im[i] = await one(im[i], `${order.id}/ref`)
  }
  return n
}
export const externalizeSlips = externalizeOrderImages
// อ้างอิงรูปส่วนตัวทั้งหมดที่ออร์เดอร์ใช้อยู่
export function privateRefsOf(order) {
  const out = new Set()
  const add = (v) => { if (parseRef(v)) out.add(v) }
  for (const p of order.payments || []) add(p.slip)
  for (const it of order.items || []) { for (const w of it.workPhotos || []) add(w.image); for (const v of it.images || []) add(v) }
  return out
}
export const slipRefsOf = privateRefsOf

// ลบไฟล์ที่ไม่มีข้อมูลอ้างถึงแล้ว (ทำได้ก็ดี ไม่ได้ก็ไม่กระทบข้อมูล) · r2 → Worker · sb (ไฟล์เดิม) → Supabase
export async function removePrivate(client, refs) {
  if (testModeOn()) return // โหมดทดสอบไม่ลบไฟล์จริง (ทั้ง R2 และที่เก็บเดิม)
  const by = {}
  for (const r of refs) { const x = parseRef(r); if (x) (by[x.bucket] ||= []).push(x.path) }
  if (by.r2?.length && filesEnabled()) { try { await fetch(`${FILES_URL}/delete`, { method: 'POST', headers: { ...(await filesAuth(client)), 'Content-Type': 'application/json' }, body: JSON.stringify({ keys: by.r2 }) }) } catch { /* ข้าม */ } }
  for (const b of Object.keys(by)) { if (b === 'r2') continue; try { await client.storage.from(b).remove(by[b]) } catch { /* ข้าม */ } }
}

// ลิงก์ชั่วคราว (เก็บไว้ใช้ซ้ำจนใกล้หมดอายุ)
const signed = new Map()
export async function signedUrlFor(client, ref, ttl = 3600) {
  const hit = signed.get(ref)
  if (hit && hit.exp - Date.now() > 300000) return hit.url
  const x = parseRef(ref)
  if (!x) return null
  let url = null
  if (x.bucket === 'r2') {
    if (!filesEnabled()) return null
    const r = await fetch(`${FILES_URL}/sign`, { method: 'POST', headers: { ...(await filesAuth(client)), 'Content-Type': 'application/json' }, body: JSON.stringify({ key: x.path }) })
    url = r.ok ? (await r.json()).url || null : null
  } else {
    const r = await client.storage.from(x.bucket).createSignedUrl(x.path, ttl)
    url = r.error ? null : r.data?.signedUrl || null
  }
  if (!url) return null
  signed.set(ref, { url, exp: Date.now() + ttl * 1000 })
  return url
}

// เผยแพร่: คัดลอกรูป (ส่วนตัว/ในเครื่อง) ไปที่สาธารณะ (R2) → ลิงก์ถาวร · ลิงก์/ค่าอื่นคืนตามเดิม · ไม่เขียนลง Supabase
export const PUBLISHED_PREFIX = 'published'
export async function toPublicUrl(client, src) {
  if (isLocalImage(src)) return uploadPublicImage(client, src, PUBLISHED_PREFIX)
  if (!parseRef(src)) return src
  const url = await signedUrlFor(client, src, 300)
  if (!url) throw new Error('อ่านรูปส่วนตัวไม่สำเร็จ')
  const blob = await (await fetch(url)).blob()
  return uploadPublicImage(client, URL.createObjectURL(blob), PUBLISHED_PREFIX)
}
// ลบสำเนาสาธารณะที่เผยแพร่ไว้ใน Supabase (ไฟล์เดิม) · สำเนาใน R2 ยังไม่ลบจากที่นี่
export async function removePublicCopy(client, url) {
  if (testModeOn()) return false // โหมดทดสอบไม่ลบสำเนาสาธารณะจริง
  const m = typeof url === 'string' ? /\/object\/public\/punpang-public\/(published\/[^?#]+)$/.exec(url) : null
  if (!m) return false
  try { const r = await client.storage.from(PUBLIC_BUCKET).remove([m[1]]); return !r?.error } catch { return false }
}
