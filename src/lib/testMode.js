// โหมดทดสอบ (ต่อเครื่องนี้ · ฐานข้อมูลเดียวกันแยกที่ schema punpang_test)
// เปิดแล้วแอปอ่านเขียนสำเนาข้อมูลทดสอบ · ข้อมูลจริงไม่ถูกแตะ · เก็บสถานะในเครื่องเท่านั้น (localStorage) · เปลี่ยนโหมดแล้วโหลดหน้าใหม่
// ไม่มีการเชื่อม Supabase = ไม่มีโหมดนี้ (ใช้ได้เฉพาะตอนต่อฐานข้อมูล)
export const TEST_MODE_KEY = 'punpang_test_mode'
export const TEST_SCHEMA = 'punpang_test'
export const TEST_HEADER = 'x-punpang-mode'
export const TEST_CODE_PREFIX = 'TEST-' // เลขเอกสารในโหมดทดสอบมีคำนำหน้า เพื่อไม่ปนกับเลขจริง

export function readTestMode(storage = globalThis.localStorage) {
  try { return storage?.getItem(TEST_MODE_KEY) === '1' } catch { return false }
}

export function writeTestMode(on, storage = globalThis.localStorage) {
  try {
    if (on) storage?.setItem(TEST_MODE_KEY, '1')
    else storage?.removeItem(TEST_MODE_KEY)
    return true
  } catch { return false }
}

// โหมดทดสอบที่ทำงานจริง (ต้องมีการเชื่อม Supabase ด้วย) · ค่านี้ใช้ทั้งตอนสร้างไคลเอนต์และตอนตัดสินใจในหน้าจอ
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {}
// ต่อฐานข้อมูลอยู่หรือไม่ (เหมือนเงื่อนไข supabaseEnabled) · ไม่ต่อ = ไม่มีโหมดทดสอบ
const CONNECTED = !!(String(env.VITE_SUPABASE_URL || '').trim() && String(env.VITE_SUPABASE_ANON_KEY || '').trim() && env.VITE_USE_SUPABASE === '1')
export const testModeOn = (connected = CONNECTED) => !!connected && readTestMode()

// รหัสเอกสารที่แสดง/บันทึก: โหมดทดสอบเติมคำนำหน้า TEST- (รหัสว่างหรือโหมดจริงไม่เปลี่ยน)
export const docCode = (code, on) => (on && code ? TEST_CODE_PREFIX + code : code)
