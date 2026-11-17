import { reactive } from 'vue'

// ตัวนับการโหลด: ทุกคำขอ fetch (ฐานข้อมูล, ไฟล์รูป, Worker) นับรวมที่นี่
// ระหว่างมีการโหลดค้างอยู่ จะขึ้นหน้าจอโหลดและบล็อกการคลิก จนกว่าจะโหลดเสร็จ
const SHOW_DELAY = 600 // โหลดเร็วกว่านี้ไม่ต้องแสดง (กันกะพริบ)
const MIN_SHOW = 350 // เมื่อขึ้นแล้วให้แสดงอย่างน้อยเท่านี้ (กันหายเร็วเกิน)

export const loadingState = reactive({ show: false })

let count = 0
let showTimer = null
let hideTimer = null
let shownAt = 0

function sync() {
  if (count > 0) {
    clearTimeout(hideTimer)
    hideTimer = null
    if (loadingState.show || showTimer) return
    showTimer = setTimeout(() => {
      showTimer = null
      shownAt = Date.now()
      loadingState.show = true
    }, SHOW_DELAY)
    return
  }
  if (showTimer) { clearTimeout(showTimer); showTimer = null }
  if (!loadingState.show || hideTimer) return
  const wait = Math.max(0, MIN_SHOW - (Date.now() - shownAt))
  hideTimer = setTimeout(() => {
    hideTimer = null
    if (count === 0) loadingState.show = false
  }, wait)
}

export function beginLoad() { count++; sync() }
export function endLoad() { count = Math.max(0, count - 1); sync() }

// ครอบงานโหลดใด ๆ (Promise) ให้นับเป็นการโหลด · รอจนเซิร์ฟเวอร์ตอบกลับ (ไม่มีการหมดเวลา)
export async function trackLoad(p) {
  beginLoad()
  try { return await p } finally { endLoad() }
}

// งานอัปเดตเบื้องหลัง (เช่น ดึงรายการทุก 5 วินาที): ไม่ขึ้นหน้าจอหมุนโหลด ไม่บล็อกการคลิก
let quietDepth = 0
export async function quietly(fn) {
  quietDepth++
  try { return await fn() } finally { quietDepth-- }
}
export const isQuiet = () => quietDepth > 0

// ดักทุก fetch ของหน้าเว็บ (เรียกครั้งเดียวตอนเริ่มแอป ก่อนสร้าง client ของ Supabase)
export function installLoadingFetch() {
  if (typeof window === 'undefined' || window.__loadingFetch) return
  window.__loadingFetch = true
  const orig = window.fetch.bind(window)
  window.fetch = (...args) => {
    // ส่งข้อความ Facebook ไม่บล็อกหน้าจอ: ข้อความขึ้นในแชททันที และสถานะ "กำลังส่ง/ส่งสำเร็จ" บอกผลเอง
    const target = typeof args[0] === 'string' ? args[0] : args[0]?.url || ''
    if (/\/functions\/v1\/fb-send(\?|$)/.test(target)) return orig(...args)
    if (quietDepth > 0) return orig(...args)
    return trackLoad(orig(...args))
  }
}
installLoadingFetch()
