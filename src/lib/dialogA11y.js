// การเข้าถึงของกล่องโต้ตอบ: โฟกัสเข้ากล่องตอนเปิด · Tab วนในกล่อง · Esc ปิด · คืนโฟกัสปุ่มเดิมตอนปิด
import { onBeforeUnmount, onMounted } from 'vue'

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)
const focusables = (root) => [...root.querySelectorAll(FOCUSABLE)].filter(visible)

// root: ref ของกล่อง · onEscape: เรียกเมื่อกด Esc เฉพาะกล่องบนสุด
export function useDialogA11y(root, onEscape) {
  let opener = null
  function keydown(e) {
    const el = root.value
    if (!el) return
    const top = [...document.querySelectorAll('[data-dialog]')].pop()
    if (top !== el) return // มีกล่องซ้อนอยู่บน → ให้กล่องนั้นจัดการ
    if (e.key === 'Escape') { e.preventDefault(); onEscape?.(); return }
    if (e.key !== 'Tab') return
    const list = focusables(el)
    if (!list.length) { e.preventDefault(); el.focus(); return }
    const first = list[0]
    const last = list[list.length - 1]
    if (!el.contains(document.activeElement)) { e.preventDefault(); first.focus() }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  onMounted(() => {
    opener = document.activeElement
    document.addEventListener('keydown', keydown)
    const el = root.value
    if (!el) return
    // โฟกัสช่องกรอกแรก (ถ้ามี) ไม่เช่นนั้นปุ่มแรกในเนื้อหา · ไม่โฟกัสปุ่ม "ปิด" ก่อน
    const body = el.querySelector('[data-dialog-body]') || el
    const target = focusables(body).find((x) => /^(INPUT|SELECT|TEXTAREA)$/.test(x.tagName)) || focusables(body)[0] || focusables(el)[0] || el
    target.focus({ preventScroll: true })
  })
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', keydown)
    if (opener && opener.isConnected && typeof opener.focus === 'function') opener.focus({ preventScroll: true })
  })
}
