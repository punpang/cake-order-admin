// แป้นพิมพ์มือถือ (iOS): แป้นพิมพ์ไม่ลดขนาด layout viewport → กรอบแบบ fixed ที่ยึดขอบล่างจึงถูกแป้นพิมพ์บัง
// ที่นี่ตามขนาด "ส่วนที่มองเห็นจริง" (visualViewport) ให้กรอบทุกหน้าใช้: --vvh (ความสูงที่มองเห็น) · --vvt (ระยะเลื่อนด้านบน) · --kbh (ความสูงแป้นพิมพ์) · kb.open (แป้นพิมพ์เปิด)
import { reactive } from 'vue'

export const kb = reactive({ open: false })
const KB_MIN = 120 // ส่วนต่างความสูงที่ถือว่าแป้นพิมพ์เปิด (px)
// ขณะช่องกรอกโฟกัส ตรวจค่าซ้ำทุก 250 ms: iOS บางครั้งไม่ส่ง resize/scroll หลังแป้นพิมพ์ขึ้นเสร็จ → ค่าค้างเป็นค่าช่วงกำลังเลื่อน
const POLL_MS = 250
const FIELD = /^(INPUT|TEXTAREA|SELECT)$/
// แป้นพิมพ์เปิดหรือไม่: เทียบความสูงที่มองเห็นกับ "ความสูงเต็ม" = ค่ามากสุดระหว่าง innerHeight กับความสูงที่เคยเห็นในแนวจอนี้
// (iOS บางรุ่น/โหมดแอปบนหน้าจอโฮม ลด innerHeight ตามแป้นพิมพ์ด้วย → เทียบกับ innerHeight อย่างเดียวจะไม่รู้ว่าแป้นพิมพ์เปิด)
export const keyboardOpen = (fullH, visibleH) => fullH - visibleH > KB_MIN
const isField = (el) => !!el && FIELD.test(el.tagName) && !el.disabled && !el.readOnly

export function watchViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return () => {}
  const root = document.documentElement
  let lastH = ''
  let lastT = ''
  let lastK = ''
  let maxH = 0 // ความสูงที่มองเห็นมากสุดในแนวจอปัจจุบัน
  let lastW = 0
  // ตั้งค่าเฉพาะตอนที่เปลี่ยนจริง (การตรวจซ้ำไม่ทำให้หน้าจัดวางใหม่โดยไม่จำเป็น)
  const apply = () => {
    const h = `${Math.round(vv.height)}px`
    const t = `${Math.round(vv.offsetTop)}px`
    if (h !== lastH) {
      root.style.setProperty('--vvh', h)
      lastH = h
    }
    if (t !== lastT) {
      root.style.setProperty('--vvt', t)
      lastT = t
    }
    const w = Math.round(vv.width * vv.scale)
    if (w !== lastW) { lastW = w; maxH = 0 } // หมุนจอ/เปลี่ยนขนาดหน้าต่าง → เริ่มนับใหม่
    if (vv.scale === 1 && vv.height > maxH) maxH = vv.height // ไม่นับตอนซูมด้วยสองนิ้ว
    const open = keyboardOpen(Math.max(window.innerHeight, maxH), vv.height)
    if (open !== kb.open) kb.open = open
    // ความสูงที่แป้นพิมพ์บังอยู่ (px): กล่องแบบ fixed ที่ติดขอบล่างใช้ดันขึ้นให้อยู่เหนือแป้นพิมพ์ (0 เมื่อปิดแป้นพิมพ์)
    const k = open ? `${Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop))}px` : '0px'
    if (k !== lastK) {
      root.style.setProperty('--kbh', k)
      lastK = k
    }
  }
  let timer = null
  let settle = null
  const start = () => {
    if (!timer) timer = setInterval(apply, POLL_MS)
  }
  const stop = () => {
    clearInterval(timer)
    timer = null
  }
  const onFocusIn = (e) => {
    if (!isField(e.target)) return
    start()
    apply()
  }
  const onFocusOut = () => {
    apply()
    // แป้นพิมพ์ปิดหลังเบลอ: ตรวจอีกครั้งหลังแอนิเมชันปิด แล้วหยุดตรวจเมื่อไม่มีช่องกรอกโฟกัส
    clearTimeout(settle)
    settle = setTimeout(() => {
      apply()
      if (!isField(document.activeElement)) stop()
    }, 700)
  }
  apply()
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  window.addEventListener('resize', apply)
  document.addEventListener('focusin', onFocusIn)
  document.addEventListener('focusout', onFocusOut)
  return () => {
    stop()
    clearTimeout(settle)
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    window.removeEventListener('resize', apply)
    document.removeEventListener('focusin', onFocusIn)
    document.removeEventListener('focusout', onFocusOut)
    root.style.removeProperty('--vvh')
    root.style.removeProperty('--vvt')
    root.style.removeProperty('--kbh')
    kb.open = false
  }
}
