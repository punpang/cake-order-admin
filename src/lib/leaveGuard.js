// เตือนก่อนออกจากหน้าที่มีการแก้ไขยังไม่บันทึก (เปลี่ยนเส้นทางในแอป + ปิด/รีเฟรชแท็บ)
import { onBeforeUnmount, onMounted } from 'vue'
import { onBeforeRouteLeave } from 'vue-router'
import { askConfirm } from './confirm'

// isDirty: () => boolean
export function useLeaveGuard(isDirty) {
  onBeforeRouteLeave(async () => {
    if (!isDirty()) return true
    return askConfirm({ title: 'ออกจากหน้านี้?', message: 'มีการแก้ไขที่ยังไม่บันทึก จะหายไปถ้าออกตอนนี้', okText: 'ออกโดยไม่บันทึก', danger: true })
  })
  const unload = (e) => { if (isDirty()) { e.preventDefault(); e.returnValue = '' } }
  onMounted(() => window.addEventListener('beforeunload', unload))
  onBeforeUnmount(() => window.removeEventListener('beforeunload', unload))
}
