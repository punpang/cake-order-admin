// แป้นตัวเลขของแอป: ใช้แทนแป้นพิมพ์ของระบบในช่องตัวเลขบนอุปกรณ์สัมผัส
// เพื่อไม่ให้แถบ ↑ ↓ ✓ ของ iOS (แถบเหนือแป้นพิมพ์) ขึ้นในช่องเหล่านี้
// ช่องที่มี data-numpad ("int" = จำนวนเต็ม · "dec" = ทศนิยม) จะถูกตั้งเป็น readonly ชั่วคราวตอนแตะ
// จึงไม่เปิดแป้นพิมพ์ของระบบ แล้วรับค่าจากแผงปุ่มนี้แทน · เครื่องที่ไม่มีหน้าจอสัมผัสยังพิมพ์ตามปกติ
import { reactive } from 'vue'
import { setVirtualKeyboardHeight } from './viewportFit.js'

export const numpad = reactive({ open: false, mode: 'int', target: null })

const FIELD = 'input[data-numpad]'
const isTouch = () => typeof window !== 'undefined' && ((navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window)
const isNumpadField = (el) => el instanceof HTMLInputElement && el.matches(FIELD) && !el.disabled

// ล็อกเฉพาะช่องที่แก้ไขได้อยู่แล้ว (ช่องที่ readonly โดยตั้งใจจะไม่เปิดแป้น)
const lock = (el) => { if (!el.readOnly) { el.readOnly = true; el._npLocked = true } }
const unlock = (el) => { if (el._npLocked) { el.readOnly = false; el._npLocked = false } }

// คำนวณค่าใหม่เมื่อกดปุ่ม · key: '0'-'9' | '.' | 'back' (ปุ่ม done ไม่เปลี่ยนค่า)
export function applyNumpadKey(value, key, mode = 'int', maxLength = 0) {
  const cur = String(value ?? '')
  let next = cur
  if (key === 'back') next = cur.slice(0, -1)
  else if (key === '.') { if (mode === 'dec' && !cur.includes('.')) next = (cur === '' ? '0' : cur) + '.' }
  else if (/^\d$/.test(key)) next = cur + key
  if (maxLength > 0 && next.length > maxLength) return cur
  return next
}

let timer = null
export function openNumpad(el) {
  if (numpad.open && numpad.target === el) return
  if (numpad.open) closeNumpad()
  numpad.target = el
  numpad.mode = el.getAttribute('data-numpad') === 'dec' ? 'dec' : 'int'
  numpad.open = true
  // ถ้าช่องถูกลบออกจากหน้า (เช่น ปิดป็อปอัป) ให้ปิดแป้นด้วย
  clearInterval(timer)
  timer = setInterval(() => { if (!numpad.target?.isConnected) closeNumpad() }, 400)
}
export function closeNumpad() {
  const el = numpad.target
  clearInterval(timer)
  timer = null
  numpad.open = false
  numpad.target = null
  setVirtualKeyboardHeight(0)
  if (el) {
    unlock(el)
    if (document.activeElement === el) el.blur()
  }
}
export function pressNumpadKey(key) {
  const el = numpad.target
  if (!numpad.open || !el) return
  if (key === 'done') { closeNumpad(); return }
  const next = applyNumpadKey(el.value, key, numpad.mode, el.maxLength)
  if (next === el.value) return
  el.value = next
  // ส่งเหตุการณ์ input ให้ v-model และตัวจัดรูปแบบของช่องทำงานเหมือนพิมพ์จริง
  el.dispatchEvent(new Event('input', { bubbles: true }))
}

// ผูกตัวจัดการทั้งหน้า (เรียกครั้งเดียวจาก App) · คืนฟังก์ชันยกเลิก
export function attachNumPad() {
  if (typeof document === 'undefined' || !isTouch()) return () => {}
  const onPointerDown = (e) => {
    if (isNumpadField(e.target)) lock(e.target) // ล็อกก่อนโฟกัส เพื่อไม่ให้แป้นพิมพ์ของระบบขึ้น
  }
  const onFocusIn = (e) => {
    if (!isNumpadField(e.target)) return
    lock(e.target)
    if (e.target._npLocked) openNumpad(e.target)
  }
  const onFocusOut = (e) => {
    if (!numpad.open || e.target !== numpad.target) return
    // แตะปุ่มบนแผงแล้วโฟกัสย้ายไปที่ปุ่มในแผง → คงโฟกัสไว้ที่ช่องเดิม ไม่ปิดแผง
    if (e.relatedTarget?.closest?.('[data-numpad-pad]')) {
      setTimeout(() => numpad.target?.focus({ preventScroll: true }), 0)
      return
    }
    closeNumpad()
  }
  const NAMED = { Backspace: 'back', Enter: 'done', Escape: 'done' }
  const onKeyDown = (e) => {
    if (!numpad.open) return
    const key = NAMED[e.key] ?? (e.key === '.' || e.key === ',' ? '.' : /^\d$/.test(e.key) ? e.key : null)
    if (!key) return
    e.preventDefault()
    e.stopPropagation() // เช่น Escape ปิดแผงนี้เท่านั้น ไม่ปิดป็อปอัปที่อยู่ข้างหลัง
    pressNumpadKey(key)
  }
  document.addEventListener('pointerdown', onPointerDown, true)
  document.addEventListener('focusin', onFocusIn, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('keydown', onKeyDown, true)
  return () => {
    document.removeEventListener('pointerdown', onPointerDown, true)
    document.removeEventListener('focusin', onFocusIn, true)
    document.removeEventListener('focusout', onFocusOut, true)
    document.removeEventListener('keydown', onKeyDown, true)
    closeNumpad()
  }
}
