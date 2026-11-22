// ลิงก์ที่มาจากข้อมูล (ตั้งค่าร้าน/ออร์เดอร์) ก่อนนำไปใส่ href: รับเฉพาะ http(s) เท่านั้น
// กันค่าอย่าง javascript:… หรือ data:… ที่หลุดเข้าฐานข้อมูล (ตอนบันทึกมีการตรวจอยู่แล้ว ที่นี่คือด่านที่สองตอนแสดงผล)
// คืน '' เมื่อใช้ไม่ได้ → ใช้คู่กับ v-if เพื่อซ่อนลิงก์
export function safeHref(v) {
  const s = String(v ?? '').trim()
  if (!s || /[\u0000-\u001f\s<>"'`\\]/.test(s)) return ''
  try {
    const u = new URL(s)
    return (u.protocol === 'https:' || u.protocol === 'http:') && !u.username && !u.password ? u.href : ''
  } catch {
    return ''
  }
}

// ลิงก์ต่อจากการเข้าสู่ระบบ/สมัคร/ลืม PIN (?next=) · รับเฉพาะพาธภายในเว็บ (ขึ้นต้นด้วย / ไม่ใช่ // หรือ /\) · คืน '' เมื่อใช้ไม่ได้
export function safeNext(v) {
  const s = String(v ?? '')
  return s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\') ? s : ''
}
