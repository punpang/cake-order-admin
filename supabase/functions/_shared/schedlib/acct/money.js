// เงินในระบบบัญชี: คำนวณเป็นจำนวนเต็ม "สตางค์" แล้วค่อยแปลงกลับเป็นบาท (กันทศนิยมลอยตัว)
export const toS = (n) => Math.round((Number(n) + Number.EPSILON) * 100)
export const toB = (s) => Math.round(s) / 100
export const r2 = (n) => toB(toS(n))

// แบ่งยอด total (สตางค์) ตามน้ำหนัก (สตางค์/จำนวนเต็ม) เศษไปที่คนสุดท้ายที่มีน้ำหนัก → ผลรวมเท่ากับ total เสมอ
export function allocate(total, weights) {
  const sum = weights.reduce((a, b) => a + b, 0)
  const out = weights.map(() => 0)
  if (!(sum > 0) || !total) return out
  let used = 0
  let last = -1
  weights.forEach((w, i) => { if (w > 0) last = i })
  weights.forEach((w, i) => {
    if (w <= 0) return
    out[i] = i === last ? total - used : Math.round((total * w) / sum)
    used += out[i]
  })
  return out
}
