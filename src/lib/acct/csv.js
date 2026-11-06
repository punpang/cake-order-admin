// CSV (UTF-8 + BOM ให้ Excel ไทยอ่านได้) · ป้องกัน CSV injection (= + - @ นำหน้าเซลล์ข้อความ)
const esc = (v) => {
  let s = v == null ? '' : String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export const toCsv = (headers, rows) => '﻿' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n')
export function downloadCsv(name, headers, rows) {
  const blob = new Blob([toCsv(headers, rows)], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 1000)
}
