// ทดสอบการย่อภาพก่อนอ่าน QR: ค่าเฉลี่ยบล็อก 2×2 ถูกต้องและขนาดลดครึ่งหนึ่ง
import { assertEquals } from 'jsr:@std/assert@1'
import { halveRgba } from './qrimage.ts'

Deno.test('halveRgba: เฉลี่ยบล็อก 2×2 และขนาดลดครึ่งหนึ่ง', () => {
  // ภาพ 4×2 พิกเซล แต่ละพิกเซลมีค่าแดงเป็น 0,4,8,12 / 16,20,24,28 (ค่า RGBA อื่นเป็น 0)
  const w = 4, h = 2
  const src = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) src[i * 4] = i * 4
  const out = halveRgba(src, w, h)
  assertEquals([out.w, out.h], [2, 1])
  // บล็อกซ้าย: (0+4+16+20)/4 = 10 · บล็อกขวา: (8+12+24+28)/4 = 18 (ปัดขึ้นเมื่อ .5 ตามสูตร +2>>2)
  assertEquals([out.data[0], out.data[4]], [10, 18])
})
