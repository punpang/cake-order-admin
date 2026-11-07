// รูปเค้กสั่งทำล่าสุดที่ส่งมอบแล้ว + ค้นหาแบบใกล้เคียงที่สุด (ฟังก์ชันล้วน รับ db)
import { optionIndex } from './cakeImage'

const W = { type: 8, flavor: 4, size: 2 }
const consentOk = (o) => (o?.photoConsent?.status || 'ok') === 'ok'

// รูปที่เผยแพร่ได้จริง เรียงใหม่→เก่า: คลังรูปที่เปิดใช้ + มีออร์เดอร์ต้นทางส่งมอบแล้ว + ช่องเป็นเค้กสั่งทำ + ไม่ใช่ POS + ลูกค้าไม่ได้ขอไม่เผยแพร่
// ผลลัพธ์ไม่มี orderId/itemId/ข้อมูลลูกค้า
export function latestCustomPhotos(db) {
  const idx = optionIndex(db.optionGroups)
  const rows = []
  for (const g of db.cakeGallery || []) {
    if (g.active === false || !g.image || !g.source?.orderId) continue
    const o = (db.orders || []).find((x) => x.id === g.source.orderId)
    if (!o || o.status !== 'delivered' || o.channel === 'pos' || !consentOk(o)) continue
    const it = (o.items || []).find((i) => i.id === g.source.itemId)
    if (!it || it.kind !== 'custom') continue
    const tagNames = (g.tags || []).map((id) => idx.get(id)).filter(Boolean).map((t) => ({ name: t.name, groupKey: t.groupKey }))
    rows.push({
      id: g.id,
      image: g.image,
      caption: g.caption || '',
      tags: [...(g.tags || [])],
      tagNames,
      typeName: tagNames.find((t) => t.groupKey === 'type')?.name || '',
      deliveredAt: o.deliveredAt || g.createdAt || '',
      _c: g.createdAt || '',
    })
  }
  rows.sort((a, b) => String(b.deliveredAt).localeCompare(String(a.deliveredAt)) || String(b._c).localeCompare(String(a._c)) || String(b.id).localeCompare(String(a.id)))
  return rows.map(({ _c, ...r }) => r)
}

// ทำให้ข้อความเทียบกันได้: ตัวพิมพ์เล็ก · พ้องความหมาย · "2 ปอนด์" = "2ปอนด์" · ตัดช่องว่าง
const SYN = [[/ฟอนดองท์|ฟองดองท์|ฟอนดอง|ฟองดอง|fondant/g, 'ฟองดองท์'], [/ช็อค|ช๊อค|ช็อกกิ้ง/g, 'ช็อก'], [/ช็อกโกแลต|ช็อคโกแลต|ช็อกโกเลต|chocolate/g, 'ช็อกโกแลต'], [/เรดเวลเวท|เรดเวลเว็ท|red velvet/g, 'เรดเวลเวท']]
export function norm(s) {
  let t = String(s ?? '').toLowerCase().normalize('NFC').replace(/[่-๋]/g, '')
  for (const [re, to] of SYN) t = t.replace(re, to.replace(/[่-๋]/g, ''))
  return t.replace(/(\d+)\s*(ปอนด์|ปอน|lb|ชั้น|ชิ้น|นิ้ว)/g, '$1$2').replace(/\s+/g, ' ').trim()
}
const strip = (t) => t.replace(/\s+/g, '')
export function tokensOf(q) {
  return norm(q).split(' ').filter(Boolean).slice(0, 12)
}

// ค้นหา: คะแนน = Σ น้ำหนักคำที่เจอ (ประเภท 8 · รสชาติ 4 · ขนาด 2 · อื่น/คำอธิบาย 1) + โบนัสเจอครบทุกคำ · เรียงคะแนนมาก→น้อย เท่ากันเรียงใหม่→เก่า
// ไม่มีคำไหนตรงเลย → คืนล่าสุดพร้อม fallback:true · คำค้นว่าง → ล่าสุด
export function searchCakePhotos(list, q) {
  const all = list || []
  const toks = tokensOf(q)
  if (!toks.length) return { results: all, fallback: false, query: '' }
  const scored = all.map((p, i) => {
    const fields = [...p.tagNames.map((t) => ({ t: strip(norm(t.name)), w: W[t.groupKey] ?? 1 })), { t: strip(norm(p.caption)), w: 1 }]
    let score = 0, hit = 0
    for (const tk of toks) {
      const k = strip(tk)
      const best = Math.max(0, ...fields.map((f) => (f.t && f.t.includes(k) ? f.w : 0)))
      if (best > 0) { score += best; hit++ }
    }
    if (hit === toks.length) score += 5
    return { p, score, i }
  })
  const got = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score || a.i - b.i)
  if (!got.length) return { results: all, fallback: true, query: toks.join(' ') }
  return { results: got.map((x) => x.p), fallback: false, query: toks.join(' ') }
}
