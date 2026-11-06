// วิเคราะห์ความต้องการจากข้อความลูกค้า (กฎคีย์เวิร์ดไทย · ประมวลผลในเบราว์เซอร์ ไม่ส่งออกนอก) + จัดอันดับสินค้าแนะนำ
// ฟังก์ชันล้วน · จุดเสียบ AI ภายหลัง: แทน extractIntent() ด้วยผลจากโมเดล แล้วใช้ scoreProducts() เดิมได้
import { customMenu } from './storefront'
import { detectEntities } from './chatParse'

const FLAVOR_SYN = {
  ช็อกโกแลต: ['ช็อกโกแลต', 'ช็อคโกแลต', 'ช็อกโก', 'ช็อค', 'ช็อก', 'โกโก้', 'chocolate'],
  วานิลลา: ['วานิลลา', 'วนิลา', 'วานิลา', 'vanilla'],
  ใบเตย: ['ใบเตย'],
  เรดเวลเวท: ['เรดเวลเวท', 'เรดเวลเว็ท', 'red velvet', 'เรด'],
  ชาไทย: ['ชาไทย'],
  ส้ม: ['ส้ม'],
  มะพร้าว: ['มะพร้าว'],
  ชีส: ['ชีส', 'cheese'],
  สตรอว์เบอร์รี: ['สตรอ', 'strawberry'],
}
const OCCASIONS = {
  birthday: { words: ['วันเกิด', 'birthday', 'เกิด'], label: 'วันเกิด' },
  wedding: { words: ['แต่งงาน', 'งานแต่ง', 'วิวาห์', 'หมั้น', 'wedding'], label: 'งานแต่ง' },
  anniversary: { words: ['ครบรอบ', 'anniversary'], label: 'ครบรอบ' },
  graduation: { words: ['รับปริญญา', 'จบการศึกษา', 'ปริญญา'], label: 'รับปริญญา' },
  gift: { words: ['ของขวัญ', 'ของฝาก'], label: 'ของขวัญ' },
}
const READY_WORDS = ['สำเร็จ', 'พร้อมขาย', 'พร้อมรับ', 'วันนี้', 'เดี๋ยวนี้', 'ชิ้น', 'คัพเค้ก', 'cupcake', 'แวะไปรับ', 'มีของไหม', 'มีเลยไหม']
const CUSTOM_WORDS = ['สั่งทำ', 'ออกแบบ', 'ตามแบบ', 'ลายการ์ตูน', 'การ์ตูน', 'ปอนด์', 'หลายชั้น', 'ตกแต่ง', 'เขียนข้อความ']
const lc = (s) => String(s ?? '').toLowerCase()
const has = (text, words) => words.some((w) => text.includes(w))

export function extractIntent(raw, today = new Date()) {
  const text = lc(raw)
  const flavors = Object.keys(FLAVOR_SYN).filter((k) => has(text, FLAVOR_SYN[k].map(lc)))
  const occasion = Object.keys(OCCASIONS).find((k) => has(text, OCCASIONS[k].words.map(lc))) || null
  let budget = null
  const bm = text.match(/(?:งบ|ไม่เกิน|ประมาณ|ราคา)\s*(?:ไม่เกิน|ประมาณ)?\s*(\d[\d,]*)/) || text.match(/(\d[\d,]*)\s*(?:บาท|฿|บ\.)/)
  if (bm) budget = Number(bm[1].replace(/,/g, '')) || null
  if (budget != null && budget < 20) budget = null // กัน "ราคา 2 ปอนด์" ถูกอ่านเป็นงบ 2 บาท
  let pounds = null
  const pm = text.match(/(\d+(?:\.\d+)?)\s*ปอนด์/)
  if (pm) pounds = Number(pm[1])
  let people = null
  const cm = text.match(/(\d+)\s*(?:คน|ท่าน|ที่นั่ง)/)
  if (cm) people = Number(cm[1])
  if (!pounds && people) pounds = Math.max(1, Math.ceil(people / 8)) // ประมาณ 1 ปอนด์ต่อ 8 คน
  const sweet = has(text, ['หวานน้อย', 'ไม่หวาน', 'หวานนิด']) ? 'low' : has(text, ['หวานมาก', 'หวานๆ']) ? 'high' : null
  const ents = detectEntities(raw, today)
  const date = ents.find((e) => e.type === 'date')?.value || null
  const mode = has(text, CUSTOM_WORDS.map(lc)) || pounds ? 'custom' : has(text, READY_WORDS.map(lc)) ? 'ready' : null
  const empty = !flavors.length && !occasion && budget == null && !pounds && !sweet && !mode
  return { flavors, occasion, occasionLabel: occasion ? OCCASIONS[occasion].label : '', budget, pounds, people, sweet, date, mode, empty }
}

// ข้อความลูกค้าล่าสุด n ข้อความของแชท รวมเป็นข้อความเดียว
export const customerText = (chat, n = 6) => (chat?.messages || []).filter((m) => m.from === 'customer' && m.kind === 'text').slice(-n).map((m) => m.text).join(' \n ')

export function intentSummary(i) {
  const out = []
  if (i.flavors.length) out.push(`รส ${i.flavors.join('/')}`)
  if (i.occasionLabel) out.push(i.occasionLabel)
  if (i.pounds) out.push(`${i.pounds} ปอนด์${i.people ? ` (${i.people} คน)` : ''}`)
  if (i.budget) out.push(`งบ ${i.budget.toLocaleString('en-US')} ฿`)
  if (i.sweet) out.push(i.sweet === 'low' ? 'หวานน้อย' : 'หวานมาก')
  if (i.mode) out.push(i.mode === 'ready' ? 'สินค้าสำเร็จ' : 'สั่งทำ')
  return out
}

// จัดอันดับสินค้า: สินค้า POS ที่เปิดแสดง + ประเภทเค้กสั่งทำ · คืน [{ kind, id, name, price, score, reasons[], image, stock }] คะแนนสูงก่อน
export function scoreProducts(intent, db, limit = 5) {
  if (!intent || intent.empty) return []
  const out = []
  const flavorHit = (name) => intent.flavors.find((f) => has(lc(name), FLAVOR_SYN[f].map(lc)))
  for (const p of db.retailItems || []) {
    if (p.active === false || (p.showInPos === false && !p.showOnStore)) continue
    const reasons = []
    let score = 0
    const hay = `${p.name} ${p.description || ''} ${p.category || ''}`
    const f = flavorHit(hay)
    if (f) { score += 3; reasons.push(`ตรงรส ${f}`) }
    if (intent.flavors.length && !f) score -= 1
    if (intent.mode === 'ready') { score += 1; reasons.push('สินค้าพร้อมขาย') }
    if (intent.mode === 'custom') score -= 1
    if (intent.budget != null) {
      if (p.price > intent.budget) continue // เกินงบ ไม่แนะนำ
      score += 1.5
      reasons.push('ราคาในงบ')
    }
    if (intent.occasion === 'birthday' && has(lc(hay), ['วันเกิด', 'เทียน'])) { score += 1; reasons.push('เหมาะกับวันเกิด') }
    if (p.pinned) score += 0.5
    if (p.stock === 0) { score -= 3; reasons.push('สินค้าหมดชั่วคราว') }
    if (score >= 2 && reasons.length) out.push({ kind: 'ready', id: p.id, name: p.name, price: Number(p.price) || 0, score, reasons, image: p.images?.[0] || '', stock: p.stock ?? null })
  }
  for (const m of customMenu(db)) {
    const reasons = []
    let score = 0
    const t = m.type
    const f = intent.flavors.find((x) => m.flavors.some((o) => has(lc(o.name), FLAVOR_SYN[x].map(lc))))
    if (f) { score += 3; reasons.push(`มีเนื้อเค้ก ${f}`) }
    if (intent.mode === 'custom') { score += 1.5; reasons.push('สั่งทำได้') }
    if (intent.mode === 'ready') score -= 1
    let price = m.from
    if (intent.pounds) {
      const row = m.sizes.filter((s) => s.size.pounds >= intent.pounds).sort((a, b) => a.size.pounds - b.size.pounds)[0]
      if (row) { score += 1.5; reasons.push(`มีขนาด ${row.size.name}`); price = row.price }
      else score -= 2
    }
    if (intent.budget != null) {
      if (price > intent.budget) continue // เกินงบ ไม่แนะนำ
      score += 1.5
      reasons.push('ราคาในงบ')
    }
    if (intent.occasion === 'wedding' && has(lc(t.name), ['ฟองดองท์'])) { score += 2; reasons.push('เหมาะกับงานแต่ง (ตกแต่งได้ละเอียด)') }
    if (intent.sweet === 'low' && has(lc(t.name), ['มะพร้าว'])) { score += 1; reasons.push('รสไม่หวานจัด') }
    if (score >= 2 && reasons.length) out.push({ kind: 'custom', id: t.id, name: t.name, price, score, reasons, image: t.image || '', stock: null, from: !intent.pounds })
  }
  return out.sort((a, b) => b.score - a.score || a.price - b.price).slice(0, limit)
}
