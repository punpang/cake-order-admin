// บอกว่าเบราว์เซอร์นี้ "อาจมี" เซสชันพนักงาน (Supabase Auth) ค้างอยู่หรือไม่ โดยไม่ต้องโหลดไลบรารี Supabase
// supabase-js เก็บเซสชันใน localStorage คีย์ "sb-<project-ref>-auth-token" (ค่าเริ่มต้นของไลบรารี · ยาวมากจะแบ่งเป็น .0 .1)
// ใช้ตอนเปิดเว็บ: ผู้เยี่ยมชมทั่วไป (ไม่มีคีย์นี้) ไม่ต้องรอไลบรารี/ตรวจเซสชันก่อนเห็นหน้าเว็บ
// ไม่แน่ใจ (อ่าน localStorage ไม่ได้) → ตอบ true เพื่อใช้ขั้นตอนตรวจเซสชันเต็มแบบเดิม (ช้ากว่าแต่ถูกต้องเสมอ)
export function mayHaveStaffSession(storage) {
  try {
    const s = storage === undefined ? globalThis.localStorage : storage
    if (!s || typeof s.length !== 'number') return true
    for (let i = 0; i < s.length; i++) {
      const k = String(s.key(i) || '')
      if (k.startsWith('sb-') && k.includes('-auth-token')) return true
    }
    return false
  } catch {
    return true
  }
}
