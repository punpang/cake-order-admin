// popup ยืนยันการกระทำสำคัญ: if (!(await askConfirm({ title, message, okText, danger }))) return
import { reactive } from 'vue'

export const confirmState = reactive({ open: false, title: '', message: '', okText: 'ยืนยัน', danger: false, checkbox: null, checked: true, checkbox2: null, checked2: true, reason: null, reasonValue: '', resolve: null })

export function askConfirm(opts = {}) {
  if (confirmState.resolve) confirmState.resolve(false)
  return new Promise((resolve) => {
    Object.assign(confirmState, { title: 'ยืนยันการทำรายการ', message: '', okText: 'ยืนยัน', danger: false, checkbox: null, checkbox2: null, reason: null, reasonValue: '', ...opts, checked: opts.checkbox ? opts.checkbox.value !== false : true, checked2: opts.checkbox2 ? opts.checkbox2.value !== false : true, open: true, resolve })
  })
}
// แบบมีช่องติ๊ก (เช่น "แจ้งลูกค้า" ค่าเริ่มต้นติ๊ก): คืน { ok, checked } · ยกเลิก = { ok: false, checked }
// reason = { label, required } → มีช่องกรอกเหตุผล (คืนค่าใน reason)
export function askConfirmEx(opts = {}) {
  return askConfirm(opts).then((ok) => ({ ok, checked: confirmState.checked, checked2: confirmState.checked2, reason: confirmState.reasonValue.trim() }))
}

export function closeConfirm(ok) {
  const r = confirmState.resolve
  confirmState.open = false
  confirmState.resolve = null
  if (r) r(ok)
}

// บันทึกแล้วเปลี่ยนจาก "ใช้งาน" เป็น "ปิดใช้งาน" → ถามก่อน
export function confirmDeactivate(list, form, name) {
  const cur = form.id && list.find((x) => x.id === form.id)
  if (!cur || cur.active === false || form.active !== false) return Promise.resolve(true)
  return askConfirm({ title: 'ปิดใช้งาน', message: `${name || cur.name} จะไม่แสดงให้เลือกอีก`, okText: 'ปิดใช้งาน', danger: true })
}
