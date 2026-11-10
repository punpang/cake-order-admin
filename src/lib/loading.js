import { reactive } from 'vue'

// ตัวนับการโหลด: ทุกคำขอ fetch (ฐานข้อมูล, ไฟล์รูป, Worker) นับรวมที่นี่
// ระหว่างมีการโหลดค้างอยู่ จะขึ้นหน้าจอโหลดและบล็อกการคลิก จนกว่าจะโหลดเสร็จ
const SHOW_DELAY = 150 // โหลดเร็วกว่านี้ไม่ต้องแสดง (กันกะพริบ)
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

// ครอบงานโหลดใด ๆ (Promise) ให้นับเป็นการโหลด
// ถ้าค้างนานเกิน LOAD_TIMEOUT จะปลดหน้าจอโหลดให้ใช้งานต่อได้ (คำขอเดิมยังทำงานต่อเบื้องหลัง)
const LOAD_TIMEOUT = 15000
export function trackLoad(p, timeout = LOAD_TIMEOUT) {
  beginLoad()
  let released = false
  const release = () => { if (!released) { released = true; endLoad() } }
  const timer = setTimeout(release, timeout)
  return Promise.resolve(p).finally(() => { clearTimeout(timer); release() })
}

// ดักทุก fetch ของหน้าเว็บ (เรียกครั้งเดียวตอนเริ่มแอป ก่อนสร้าง client ของ Supabase)
export function installLoadingFetch() {
  if (typeof window === 'undefined' || window.__loadingFetch) return
  window.__loadingFetch = true
  const orig = window.fetch.bind(window)
  window.fetch = (...args) => trackLoad(orig(...args))
}
installLoadingFetch()
