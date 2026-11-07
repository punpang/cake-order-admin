// อัปโหลดรูปไป Supabase Storage
// ระยะ 1: รูปสาธารณะ (สินค้า/ตัวเลือกเค้ก/หน้าร้าน) → bucket 'punpang-public' เก็บลิงก์ถาวร (https) ในข้อมูล จึงแสดงผลได้ทันที
// รูปที่เพิ่งเลือกจะเป็น data: / blob: (อยู่ในเบราว์เซอร์เท่านั้น) → ก่อนเขียนลงฐานข้อมูลต้องอัปโหลดแล้วแทนที่ด้วยลิงก์
export const PUBLIC_BUCKET = 'punpang-public'
const LOCAL = /^(data:image\/(png|jpe?g|webp|gif);base64,|blob:)/
export const isLocalImage = (v) => typeof v === 'string' && LOCAL.test(v)
const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
const rand = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`)

export async function uploadPublicImage(client, src, prefix) {
  const blob = await (await fetch(src)).blob()
  const type = EXT[blob.type] ? blob.type : 'image/jpeg'
  const path = `${prefix}/${rand()}.${EXT[type]}`
  const up = await client.storage.from(PUBLIC_BUCKET).upload(path, blob, { contentType: type, upsert: false })
  if (up.error) throw new Error(up.error.message || 'อัปโหลดรูปไม่สำเร็จ')
  return client.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
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

// ระยะ 2: รูปส่วนตัว (สลิป ฯลฯ) → bucket ส่วนตัว เก็บเป็นอ้างอิง sb://<bucket>/<path> ในข้อมูล
// แสดงผลด้วยลิงก์ชั่วคราว (signed URL) — ดูคอมโพเนนต์ SecureImg
export const SLIP_BUCKET = 'punpang-slips'
const REF = /^sb:\/\/([a-z0-9-]+)\/(.+)$/
export const parseRef = (v) => { const m = typeof v === 'string' ? REF.exec(v) : null; return m ? { bucket: m[1], path: m[2] } : null }

export async function uploadPrivateImage(client, bucket, src, prefix) {
  const blob = await (await fetch(src)).blob()
  const type = EXT[blob.type] ? blob.type : 'image/jpeg'
  const path = `${prefix}/${rand()}.${EXT[type]}`
  const up = await client.storage.from(bucket).upload(path, blob, { contentType: type, upsert: false })
  if (up.error) throw new Error(up.error.message || 'อัปโหลดรูปไม่สำเร็จ')
  return `sb://${bucket}/${path}`
}

// รูปส่วนตัวของออร์เดอร์: สลิป → punpang-slips · รูปงานเสร็จ (workPhotos) และรูปตัวอย่างของรายการ (images) → punpang-work
// รูปในเครื่อง → อัปโหลดแล้วแทนที่ด้วยอ้างอิง (แก้ในที่เดิม · รูปเดียวกันอัปโหลดครั้งเดียว) · ล้มเหลว = โยน error
export const WORK_BUCKET = 'punpang-work'
export async function externalizeOrderImages(client, order, cache = new Map()) {
  let n = 0
  const one = async (src, bucket, prefix) => {
    const k = bucket + '|' + prefix + '|' + src
    if (!cache.has(k)) { cache.set(k, await uploadPrivateImage(client, bucket, src, prefix)); n++ }
    return cache.get(k)
  }
  for (const p of order.payments || []) if (isLocalImage(p.slip)) p.slip = await one(p.slip, SLIP_BUCKET, order.id)
  for (const it of order.items || []) {
    for (const w of it.workPhotos || []) if (isLocalImage(w.image)) w.image = await one(w.image, WORK_BUCKET, `${order.id}/work`)
    const im = it.images || []
    for (let i = 0; i < im.length; i++) if (isLocalImage(im[i])) im[i] = await one(im[i], WORK_BUCKET, `${order.id}/ref`)
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

// ลบไฟล์ที่ไม่มีข้อมูลอ้างถึงแล้ว (ทำได้ก็ดี ไม่ได้ก็ไม่กระทบข้อมูล)
export async function removePrivate(client, refs) {
  const by = {}
  for (const r of refs) { const x = parseRef(r); if (x) (by[x.bucket] ||= []).push(x.path) }
  for (const b of Object.keys(by)) { try { await client.storage.from(b).remove(by[b]) } catch { /* ข้าม */ } }
}

// ลิงก์ชั่วคราว (เก็บไว้ใช้ซ้ำจนใกล้หมดอายุ)
const signed = new Map()
export async function signedUrlFor(client, ref, ttl = 3600) {
  const hit = signed.get(ref)
  if (hit && hit.exp - Date.now() > 300000) return hit.url
  const x = parseRef(ref)
  if (!x) return null
  const r = await client.storage.from(x.bucket).createSignedUrl(x.path, ttl)
  if (r.error || !r.data?.signedUrl) return null
  signed.set(ref, { url: r.data.signedUrl, exp: Date.now() + ttl * 1000 })
  return r.data.signedUrl
}

// เผยแพร่: คัดลอกรูป (ส่วนตัว/ในเครื่อง) ไป bucket สาธารณะ → ลิงก์ถาวร · ลิงก์/ค่าอื่นคืนตามเดิม
export const PUBLISHED_PREFIX = 'published'
export async function toPublicUrl(client, src) {
  if (isLocalImage(src)) return uploadPublicImage(client, src, PUBLISHED_PREFIX)
  const x = parseRef(src)
  if (!x) return src
  const ext = (x.path.split('.').pop() || 'jpg').toLowerCase()
  const path = `${PUBLISHED_PREFIX}/${rand()}.${ext}`
  const r = await client.storage.from(x.bucket).copy(x.path, path, { destinationBucket: PUBLIC_BUCKET })
  if (r.error) throw new Error(r.error.message || 'คัดลอกรูปไม่สำเร็จ')
  return client.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data.publicUrl
}
// ลบสำเนาสาธารณะที่เผยแพร่ไว้ (เฉพาะไฟล์ใต้ published/ ที่ระบบคัดลอกเอง · ไม่แตะรูปสินค้า)
export async function removePublicCopy(client, url) {
  const m = typeof url === 'string' ? /\/object\/public\/punpang-public\/(published\/[^?#]+)$/.exec(url) : null
  if (!m) return false
  try { const r = await client.storage.from(PUBLIC_BUCKET).remove([m[1]]); return !r?.error } catch { return false }
}
