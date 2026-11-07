// ผูก <label> ที่ไม่มี for กับช่องกรอกที่อยู่ถัดไปอัตโนมัติ (ผู้ใช้โปรแกรมอ่านหน้าจอ/คลิกป้ายแล้วโฟกัสช่องได้)
// ครอบคลุมรูปแบบ <div><label class="label">..</label><input></div> ที่ใช้ทั่วระบบ · ไม่แตะ label ที่มี for/ครอบช่องอยู่แล้ว
const CTRL = 'input:not([type=hidden]):not([type=checkbox]):not([type=radio]),select,textarea'
let seq = 0

function pick(label) {
  let el = label.nextElementSibling
  while (el && el.tagName === 'LABEL') el = el.nextElementSibling
  if (el) {
    if (el.matches(CTRL)) return el
    const inner = el.querySelectorAll(CTRL)
    if (inner.length === 1) return inner[0]
  }
  const p = label.parentElement
  if (p) { const all = p.querySelectorAll(CTRL); if (all.length === 1) return all[0] }
  return null
}

export function linkLabels(root = document) {
  root.querySelectorAll('label:not([for])').forEach((l) => {
    if (l.querySelector(CTRL) || l.dataset.autoLabel) return
    const c = pick(l)
    if (!c || c.closest('label') || c.getAttribute('aria-label') || c.getAttribute('aria-labelledby')) return
    if (!c.id) c.id = `al-${++seq}`
    l.setAttribute('for', c.id)
    l.dataset.autoLabel = '1'
  })
}

export function startAutoLabel() {
  let raf = 0
  const run = () => { raf = 0; linkLabels() }
  new MutationObserver(() => { if (!raf) raf = requestAnimationFrame(run) }).observe(document.body, { childList: true, subtree: true })
  run()
}
