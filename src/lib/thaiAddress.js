// ที่อยู่ไทยแบบกรอกแยกช่อง → ข้อความเดียว (ฟังก์ชันล้วน) · ข้อมูลจริงยังเก็บเป็นสตริงเดียวเสมอ
export const BKK = 'กรุงเทพมหานคร'
export const PROVINCES = [
  'กระบี่', BKK, 'กาญจนบุรี', 'กาฬสินธุ์', 'กำแพงเพชร', 'ขอนแก่น', 'จันทบุรี', 'ฉะเชิงเทรา', 'ชลบุรี', 'ชัยนาท', 'ชัยภูมิ', 'ชุมพร', 'เชียงราย', 'เชียงใหม่', 'ตรัง', 'ตราด', 'ตาก',
  'นครนายก', 'นครปฐม', 'นครพนม', 'นครราชสีมา', 'นครศรีธรรมราช', 'นครสวรรค์', 'นนทบุรี', 'นราธิวาส', 'น่าน', 'บึงกาฬ', 'บุรีรัมย์', 'ปทุมธานี', 'ประจวบคีรีขันธ์', 'ปราจีนบุรี', 'ปัตตานี',
  'พระนครศรีอยุธยา', 'พะเยา', 'พังงา', 'พัทลุง', 'พิจิตร', 'พิษณุโลก', 'เพชรบุรี', 'เพชรบูรณ์', 'แพร่', 'ภูเก็ต', 'มหาสารคาม', 'มุกดาหาร', 'แม่ฮ่องสอน', 'ยโสธร', 'ยะลา', 'ร้อยเอ็ด',
  'ระนอง', 'ระยอง', 'ราชบุรี', 'ลพบุรี', 'ลำปาง', 'ลำพูน', 'เลย', 'ศรีสะเกษ', 'สกลนคร', 'สงขลา', 'สตูล', 'สมุทรปราการ', 'สมุทรสงคราม', 'สมุทรสาคร', 'สระแก้ว', 'สระบุรี', 'สิงห์บุรี',
  'สุโขทัย', 'สุพรรณบุรี', 'สุราษฎร์ธานี', 'สุรินทร์', 'หนองคาย', 'หนองบัวลำภู', 'อ่างทอง', 'อำนาจเจริญ', 'อุดรธานี', 'อุตรดิตถ์', 'อุทัยธานี', 'อุบลราชธานี',
]
export const ADDRESS_MAX = 300
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim()
// เติมคำนำหน้า (แขวง/เขต/ตำบล/อำเภอ/จ.) ถ้าผู้ใช้ยังไม่ได้พิมพ์เอง
const pre = (v, add, has) => (v && !has.some((h) => v.startsWith(h)) ? add + v : v)
export function composeAddress(p = {}) {
  const prov = clean(p.prov)
  const bkk = prov === BKK
  const zip = String(p.zip ?? '').replace(/\D/g, '').slice(0, 5)
  const parts = [
    clean(p.no),
    clean(p.road),
    pre(clean(p.sub), bkk ? 'แขวง' : 'ต.', ['แขวง', 'ตำบล', 'ต.']),
    pre(clean(p.dist), bkk ? 'เขต' : 'อ.', ['เขต', 'อำเภอ', 'อ.']),
    prov ? (bkk ? prov : pre(prov, 'จ.', ['จังหวัด', 'จ.'])) : '',
    zip,
  ].filter(Boolean)
  return parts.join(' ').slice(0, ADDRESS_MAX)
}
// คำเตือนเบื้องต้น (ไม่บล็อกการบันทึก)
export function postalWarning(p = {}) {
  const zip = String(p.zip ?? '').trim()
  if (zip && !/^\d{5}$/.test(zip)) return 'รหัสไปรษณีย์ต้องเป็นตัวเลข 5 หลัก'
  return ''
}
// ชิปคัดลอกที่อยู่: สถานที่จัดส่งที่จำไว้ (ใช้บ่อย/ล่าสุดก่อน) + ที่อยู่ในออร์เดอร์ (ถ้ามี) · ตัดซ้ำ
export function addressChoices(places = [], orderAddress = '') {
  const out = []
  const seen = new Set()
  const add = (label, text) => { const t = clean(text); if (t && !seen.has(t)) { seen.add(t); out.push({ label, text: t.slice(0, ADDRESS_MAX) }) } }
  add('ที่อยู่ในออร์เดอร์นี้', orderAddress)
  const ps = [...places].sort((a, b) => (b.uses || 0) - (a.uses || 0) || String(b.lastUsedAt || '').localeCompare(String(a.lastUsedAt || '')))
  for (const p of ps) add(`จัดส่ง: ${clean(p.name) || clean(p.address).slice(0, 18)}`, p.address)
  return out.slice(0, 6)
}
