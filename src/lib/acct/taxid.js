// เลขประจำตัวผู้เสียภาษี/บัตรประชาชน 13 หลัก (ตรวจ checksum) · รหัสสาขา 5 หลัก
export const taxDigits = (s) => String(s ?? '').replace(/\D/g, '').slice(0, 13)
export function validTaxId(id) {
  const d = String(id ?? '')
  if (!/^\d{13}$/.test(d)) return false
  let sum = 0
  for (let i = 0; i < 12; i++) sum += Number(d[i]) * (13 - i)
  return (11 - (sum % 11)) % 10 === Number(d[12])
}
export const validBranch = (b) => /^\d{5}$/.test(String(b ?? ''))
export const branchLabel = (b) => (String(b) === '00000' ? 'สำนักงานใหญ่' : `สาขา ${b}`)
