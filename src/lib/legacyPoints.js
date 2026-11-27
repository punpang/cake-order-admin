// จับคู่คะแนนเก่าด้วยเบอร์โทร (ฟังก์ชันล้วน) · เก็บและค้นหาด้วยแฮชของเบอร์ ไม่เก็บเบอร์ดิบ
// ตัดช่องว่าง ขีด และรหัสประเทศ +66 ออกก่อนแฮช เพื่อให้ "081-234-5678" และ "+66812345678" ได้ค่าเดียวกัน

// คืนเบอร์ 10 หลักแบบ 0xxxxxxxxx หรือ null ถ้าไม่ใช่เบอร์ที่ใช้ได้
export function normalizeTel(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2)
  return /^0\d{8,9}$/.test(d) ? d : null
}

// แฮช sha256 (hex) ของเบอร์ที่ normalize แล้ว · คืน null ถ้าเบอร์ใช้ไม่ได้
export async function telHash(raw) {
  const t = normalizeTel(raw)
  if (!t) return null
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(t))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// คะแนนเก่าที่นำมาใช้กับระบบใหม่: ปัดลงเป็นจำนวนเต็ม (ค่าติดลบหรือไม่ใช่ตัวเลข = 0)
export function legacyWholePoints(points) {
  const n = Number(points)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
