// เลือกภาพวาดเค้กตามชื่อสินค้า (ฟังก์ชันล้วน · ชื่อเดิม = แบบเดิมเสมอ)
export const ART_KINDS = ['strawberry', 'pandan', 'choco', 'bonbon', 'cream', 'piped', 'sprinkle', 'fondant']
export const ART_TONES = { strawberry: '#ffd6df', pandan: '#ffd9b8', choco: '#ffd6df', bonbon: '#ffc9be', cream: '#ffe7d1', piped: '#cfe9f5', sprinkle: '#ffe08a', fondant: '#ffd6df' }
const WORDS = [['ใบเตย', 'pandan'], ['มะพร้าว', 'pandan'], ['ช็อก', 'choco'], ['โกโก้', 'choco'], ['บอนบอน', 'bonbon'], ['ฟอนดอง', 'fondant'], ['หน้าบีบ', 'piped'], ['ครีม', 'cream'], ['สตรอ', 'strawberry'], ['สตอ', 'strawberry']]
export function artKindFor(name = '') {
  const s = String(name || '')
  for (const [w, k] of WORDS) if (s.includes(w)) return k
  let h = 0
  for (const ch of s) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return ART_KINDS[h % ART_KINDS.length]
}
