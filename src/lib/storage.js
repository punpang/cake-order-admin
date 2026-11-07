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
