import { reactive, computed, nextTick } from 'vue'
import { showToast } from './toast.js'

// สถานะการบันทึกข้อมูลขึ้นเซิร์ฟเวอร์ (ฝั่งพนักงาน) — pending = รอบันทึก · saving = กำลังบันทึก · failed = บันทึกไม่สำเร็จ (ระบบลองใหม่เอง)
// ทุกตัวซิงก์ลงทะเบียนด้วยชื่อ (key) ของตัวเอง · แถบสถานะใน admin shell และตัวกันปิดแท็บอ่านจากที่นี่
export const syncEntries = reactive({})
export const syncOnline = reactive({ online: typeof navigator === 'undefined' ? true : navigator.onLine !== false })
const retryFns = new Map()
let lastOk = 0
export const syncLastOk = reactive({ at: 0 })
// สถานะ Realtime (แยกจากคิวเขียน ไม่กระทบ beforeunload) · off | connecting | live | down
export const syncRealtime = reactive({ state: 'off', everLive: false, lastLiveAt: 0 })

// แถบค้าง: รหัสออร์เดอร์ที่เครื่องนี้ส่งเข้าคิวผู้จัดการ · เก็บในเครื่องจนกดรับทราบหรือออกจากระบบ (เก็บเฉพาะรหัสและเวลา ไม่มีข้อมูลลูกค้า)
const NOTICE_KEY = 'punpang_queued_notices'
function readNotices() {
  try {
    const v = JSON.parse(localStorage.getItem(NOTICE_KEY) || '[]')
    return Array.isArray(v) ? v.filter((x) => x && typeof x.code === 'string') : []
  } catch { return [] }
}
function saveNotices(list) {
  try { localStorage.setItem(NOTICE_KEY, JSON.stringify(list)) } catch { /* เขียนไม่ได้ (เช่นโหมดส่วนตัว) = อยู่ได้เฉพาะหน้านี้ */ }
}
export const queuedNotices = reactive({ list: readNotices() })
export function addQueuedNotice(codes) {
  const have = new Set(queuedNotices.list.map((x) => x.code))
  const at = new Date().toISOString()
  const fresh = [...new Set(codes.filter(Boolean).map((c) => String(c).slice(0, 40)))].filter((c) => !have.has(c))
  if (!fresh.length) return
  queuedNotices.list = [...queuedNotices.list, ...fresh.map((code) => ({ code, at }))]
  saveNotices(queuedNotices.list)
}
export function ackQueuedNotices() { queuedNotices.list = []; saveNotices([]) }
export function clearQueuedNotices() { ackQueuedNotices() }

export function syncSet(key, state, msg = '', retry = null) {
  syncEntries[key] = { state, msg }
  if (retry) retryFns.set(key, retry)
}
export function syncOk(key) {
  delete syncEntries[key]
  lastOk = Date.now(); syncLastOk.at = lastOk
}
export function syncDrop(key) { delete syncEntries[key]; retryFns.delete(key) }
export function syncRetryAll() { for (const [k, f] of retryFns) if (syncEntries[k]?.state === 'failed') f() }
export function syncReset() { for (const k of Object.keys(syncEntries)) delete syncEntries[k]; retryFns.clear() }

// สรุปรวม: failed > saving > pending > idle
export const syncSummary = computed(() => {
  const list = Object.entries(syncEntries)
  const failed = list.filter(([, v]) => v.state === 'failed')
  if (failed.length) return { state: 'failed', msgs: failed.map(([k, v]) => `${k}: ${v.msg}`) }
  if (list.some(([, v]) => v.state === 'saving')) return { state: 'saving', msgs: [] }
  if (list.length) return { state: 'pending', msgs: [] }
  return { state: 'idle', msgs: [] }
})
// รอจนข้อมูลของตัวซิงก์เหล่านี้ถูกบันทึกขึ้นเซิร์ฟเวอร์จริง → { ok:true } · ล้มเหลว/หมดเวลา → { ok:false, error }
// ไม่มีตัวซิงก์ที่ค้างอยู่ (เช่นโหมดไม่ต่อ Supabase) = สำเร็จทันที
export const SAVE_KEYS = ['ออร์เดอร์', 'ลูกค้า', 'สินค้า', 'กะ POS']
export async function waitSaved(keys = SAVE_KEYS, timeoutMs = 20000) {
  await nextTick() // ให้ตัวเฝ้าดูของซิงก์เห็นการแก้ไขก่อน
  for (const k of keys) if (syncEntries[k]?.state === 'pending') retryFns.get(k)?.() // ไม่ต้องรอ debounce
  const t0 = Date.now()
  for (;;) {
    const live = keys.map((k) => [k, syncEntries[k]]).filter(([, v]) => v)
    if (!live.length) return { ok: true }
    const bad = live.find(([, v]) => v.state === 'failed')
    if (bad) return { ok: false, error: bad[1].msg || 'บันทึกไม่สำเร็จ' }
    if (Date.now() - t0 > timeoutMs) return { ok: false, error: 'เซิร์ฟเวอร์ตอบช้า' }
    await new Promise((r) => setTimeout(r, 80))
  }
}
// รอบันทึกแล้วแจ้งผลตามจริง: สำเร็จ → ข้อความ okText · ไม่สำเร็จ → แจ้งสีแดง (ข้อมูลยังอยู่ในเครื่อง ระบบลองส่งซ้ำเอง)
export async function toastSaved(okText, keys = SAVE_KEYS) {
  const r = await waitSaved(keys)
  if (r.ok) showToast(okText)
  else showToast(`ยังบันทึกขึ้นเซิร์ฟเวอร์ไม่สำเร็จ (${r.error}) · ระบบจะลองส่งซ้ำเอง ดูสถานะที่แถบด้านบน`, 12000, 'error')
  return r
}
export const hasUnsaved = () => Object.keys(syncEntries).length > 0

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { syncOnline.online = true; syncRetryAll() })
  window.addEventListener('offline', () => { syncOnline.online = false })
  // ปิด/รีเฟรชแท็บทั้งที่ยังมีข้อมูลไม่ได้บันทึกขึ้นเซิร์ฟเวอร์ → ให้เบราว์เซอร์เตือน
  window.addEventListener('beforeunload', (e) => { if (hasUnsaved()) { e.preventDefault(); e.returnValue = '' } })
  // แท็บถูกซ่อนหรือปิดหน้า: ส่งรายการที่รอทันที (ไม่รอหน่วงเวลา) ให้มีโอกาสถึงเซิร์ฟเวอร์ก่อนหน้าจะหยุดทำงาน · รายการค้างลองใหม่ตามรอบและเมื่อกลับออนไลน์
  const flushPending = () => { for (const [k, v] of Object.entries(syncEntries)) if (v.state === 'pending') retryFns.get(k)?.() }
  window.addEventListener('pagehide', flushPending)
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushPending() })
}
