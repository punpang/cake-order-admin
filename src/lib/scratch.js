// การขูดบัตร (ฝั่งแอป): คำนวณสัดส่วนที่ขูดแล้วจากค่าอัลฟาของผิวขูด และเกณฑ์เปิดเผยผล
// ค่าอัลฟา < 128 = ตรงนั้นถูกขูดออกแล้ว · สุ่มตัวอย่างทุก step พิกเซลเพื่อประหยัดเวลาคำนวณ

export const REVEAL_AT = 0.55 // ขูดออกเกินนี้ถือว่าเปิดเผยผลแล้ว

export function scratchedRatio(alpha, width, height, step = 6) {
  let total = 0
  let clear = 0
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      total += 1
      if (alpha[(y * width + x) * 4 + 3] < 128) clear += 1
    }
  }
  return total ? clear / total : 0
}

export const shouldReveal = (ratio, threshold = REVEAL_AT) => ratio >= threshold
