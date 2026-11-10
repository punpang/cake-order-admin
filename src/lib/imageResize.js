// ย่อรูปก่อนอัปโหลด: ด้านยาวและขนาดไฟล์ตามค่าที่ตั้งไว้ (ค่าเริ่มต้น 2000 px / 5 MB) · JPEG พื้นขาว — PNG/GIF โปร่งใสจะได้พื้นขาว
import { imageLimits } from './imageLimits'
const RAW_LIMIT = 30 * 1024 * 1024

const ERR = {
  not_image: 'ไฟล์นี้ไม่ใช่รูปภาพ',
  decode_failed: 'อ่านรูปไม่ได้ (ไฟล์เสียหรือชนิดที่เบราว์เซอร์ไม่รองรับ เช่น HEIC — ลองบันทึกเป็น JPG)',
  too_big: 'ไฟล์ใหญ่เกินไป (เกิน 30 MB)',
}
export const imageErrorMessage = (e) => ERR[e?.code] || 'อ่านรูปไม่ได้'
const fail = (code) => Object.assign(new Error(ERR[code]), { code })

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { src: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close?.() }
    } catch { /* ลองทาง Image ต่อ */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image()
      i.onload = () => res(i)
      i.onerror = () => rej(new Error('decode'))
      i.src = url
    })
    return { src: img, w: img.naturalWidth || img.width, h: img.naturalHeight || img.height, done: () => {} }
  } catch {
    throw fail('decode_failed')
  } finally {
    URL.revokeObjectURL(url)
  }
}

const toBlob = (canvas, q) => new Promise((res) => canvas.toBlob((b) => res(b), 'image/jpeg', q))

// คืน { blob, dataUrl, width, height }
export async function resizeImage(file, opts = {}) {
  if (!file || !(file.type || '').startsWith('image/')) throw fail('not_image')
  if (file.size > RAW_LIMIT) throw fail('too_big')
  const lim = await imageLimits()
  const maxSide = opts.maxSide ?? lim.maxPx
  const maxBytes = opts.maxBytes ?? lim.maxMB * 1024 * 1024
  const d = await decode(file)
  try {
    if (!d.w || !d.h) throw fail('decode_failed')
    let k = Math.min(1, maxSide / Math.max(d.w, d.h))
    for (let round = 0; round < 8; round++) {
      const w = Math.max(1, Math.round(d.w * k))
      const h = Math.max(1, Math.round(d.h * k))
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const g = c.getContext('2d')
      g.fillStyle = '#fff'
      g.fillRect(0, 0, w, h)
      g.imageSmoothingQuality = 'high'
      g.drawImage(d.src, 0, 0, w, h)
      for (let q = 0.85; q >= 0.34; q -= 0.1) {
        const blob = await toBlob(c, q)
        if (!blob) throw fail('decode_failed')
        if (blob.size <= maxBytes) return { blob, dataUrl: await blobToDataUrl(blob), width: w, height: h }
      }
      k *= 0.85
    }
    throw fail('too_big')
  } finally {
    d.done()
  }
}

function blobToDataUrl(blob) {
  return new Promise((res, rej) => {
    const r = new FileReader()
    r.onload = () => res(String(r.result))
    r.onerror = () => rej(fail('decode_failed'))
    r.readAsDataURL(blob)
  })
}
