// รูปที่ลูกค้าแนบในแชท: ย่อและบีบอัดในเครื่องให้ไม่เกิน 2 MB ก่อนส่ง (เป็น JPEG เสมอ) · ไม่เก็บรูปไว้ในเครื่อง
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024
export const PHOTO_MAX_COUNT = 5

// ลองความละเอียดและคุณภาพลดลงเรื่อย ๆ จนได้ขนาดไม่เกินกำหนด · คืน data URL
export async function shrinkPhoto(file) {
  const img = await loadImage(file)
  const longest = Math.max(img.naturalWidth, img.naturalHeight) || 1
  for (const [edge, quality] of [[1600, 0.85], [1280, 0.8], [1024, 0.7], [800, 0.6]]) {
    const scale = Math.min(1, edge / longest)
    const w = Math.max(1, Math.round(img.naturalWidth * scale))
    const h = Math.max(1, Math.round(img.naturalHeight * scale))
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff' // พื้นหลังขาว (ภาพโปร่งใสจะเป็นสีดำเมื่อแปลงเป็น JPEG)
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(img, 0, 0, w, h)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (blob && blob.size <= PHOTO_MAX_BYTES) return blobToDataUrl(blob)
  }
  throw new Error('รูปนี้ใหญ่เกินไป กรุณาเลือกรูปอื่น')
}

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); resolve(img) }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('เปิดไฟล์รูปนี้ไม่ได้ กรุณาเลือกรูปอื่น')) }
    img.src = url
  })
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'))
    reader.readAsDataURL(blob)
  })
}
