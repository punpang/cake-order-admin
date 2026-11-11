// ข้อมูลเวอร์ชันและเวลา build ของโปรแกรม · ค่าถูกใส่ตอน build ผ่าน vite.config.js (define)
// ตอนรันด้วยโค้ดโดยตรง (ไม่ผ่าน Vite) จะใช้ค่าสำรอง
/* global __APP_VERSION__, __APP_COMMIT__, __APP_BUILT_AT__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev'
export const APP_COMMIT = typeof __APP_COMMIT__ !== 'undefined' ? __APP_COMMIT__ : 'dev'
export const APP_BUILT_AT = typeof __APP_BUILT_AT__ !== 'undefined' ? __APP_BUILT_AT__ : ''

// เวลา build เป็นเวลาไทย เช่น "11 พ.ย. 2569 08:30"
export function builtAtLabel() {
  if (!APP_BUILT_AT) return '—'
  return new Date(APP_BUILT_AT).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' })
}
