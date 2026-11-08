// แป้นพิมพ์มือถือ (iOS): แป้นพิมพ์ไม่ลดขนาด layout viewport → กรอบแบบ fixed ที่ยึดขอบล่างจึงถูกแป้นพิมพ์บัง
// ที่นี่ตามขนาด "ส่วนที่มองเห็นจริง" (visualViewport) ให้กรอบหน้าล็อก (แชท) ใช้: --vvh (ความสูง) · --vvt (ระยะเลื่อนด้านบน) · kb.open (แป้นพิมพ์เปิด)
import { reactive } from 'vue'

export const kb = reactive({ open: false })
const KB_MIN = 120 // ส่วนต่างความสูงที่ถือว่าแป้นพิมพ์เปิด (px)

export function watchViewport() {
  const vv = typeof window !== 'undefined' ? window.visualViewport : null
  if (!vv) return () => {}
  const root = document.documentElement
  const apply = () => {
    root.style.setProperty('--vvh', `${Math.round(vv.height)}px`)
    root.style.setProperty('--vvt', `${Math.round(vv.offsetTop)}px`)
    kb.open = window.innerHeight - vv.height > KB_MIN
  }
  apply()
  vv.addEventListener('resize', apply)
  vv.addEventListener('scroll', apply)
  return () => {
    vv.removeEventListener('resize', apply)
    vv.removeEventListener('scroll', apply)
    root.style.removeProperty('--vvh')
    root.style.removeProperty('--vvt')
    kb.open = false
  }
}
