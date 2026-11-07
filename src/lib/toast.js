// ข้อความแจ้งผลสั้น ๆ (ลอยมุมจอ หายเอง) — อยู่ข้ามการเปลี่ยนหน้า · ประกาศให้โปรแกรมอ่านหน้าจอผ่าน aria-live ใน ToastHost
import { reactive } from 'vue'

export const toasts = reactive([])
let seq = 0

export function showToast(text, ms = 4500) {
  const id = ++seq
  toasts.push({ id, text })
  setTimeout(() => dismissToast(id), ms)
  return id
}
export function dismissToast(id) {
  const i = toasts.findIndex((t) => t.id === id)
  if (i >= 0) toasts.splice(i, 1)
}
