// แนะนำแบบเค้กสั่งทำ จากการคลิกร่วมของลูกค้าคนอื่น + ความคล้ายของแท็ก (ฟังก์ชันล้วน รับ db)
import { latestCustomPhotos } from './cakeSearch'
import { optionIndex } from './cakeImage'

const W = { type: 8, flavor: 4, size: 2 }
export const CLICK_CAP = 5000

// รหัสผู้เยี่ยมชมนิรนาม (ต่อเซสชันเบราว์เซอร์) ไม่ผูกกับข้อมูลลูกค้า
let mem = ''
export function visitorId() {
  try {
    let v = sessionStorage.getItem('cake_vid')
    if (!v) { v = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); sessionStorage.setItem('cake_vid', v) }
    return v
  } catch {
    return mem || (mem = 'v' + Math.random().toString(36).slice(2, 10))
  }
}

// ผลลัพธ์ = รูปที่เผยแพร่ได้ ยกเว้น photoId เรียงตามคะแนน
// คะแนน = (มี photoId: 10 × จำนวนผู้เยี่ยมชมที่คลิกทั้งสองรูป · ไม่มี: 2 × จำนวนผู้เยี่ยมชมที่คลิกรูปนั้น) + ความคล้ายแท็ก · เสมอ → ใหม่ก่อน
export function recommendPhotos(db, { photoId = '', selectedIds = [] } = {}) {
  const all = latestCustomPhotos(db)
  const idx = optionIndex(db.optionGroups)
  const w = (id) => W[idx.get(id)?.groupKey] ?? 1
  const cur = all.find((p) => p.id === photoId)
  const base = new Set([...(selectedIds || []), ...(cur ? cur.tags : [])])
  const by = new Map()
  for (const c of db.cakeClicks || []) { if (!by.has(c.v)) by.set(c.v, new Set()); by.get(c.v).add(c.photoId) }
  const pop = new Map(), co = new Map()
  for (const set of by.values()) {
    for (const id of set) pop.set(id, (pop.get(id) || 0) + 1)
    if (photoId && set.has(photoId)) for (const id of set) if (id !== photoId) co.set(id, (co.get(id) || 0) + 1)
  }
  return all
    .filter((p) => p.id !== photoId)
    .map((p, i) => {
      let sim = 0
      for (const t of p.tags) if (base.has(t)) sim += w(t)
      const click = photoId ? 10 * (co.get(p.id) || 0) : 2 * (pop.get(p.id) || 0)
      return { p, i, score: click + sim }
    })
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .map((x) => x.p)
}

// แท็กของรูป จัดกลุ่มตามชื่อกลุ่มตัวเลือก (ลำดับกลุ่มตามหลังบ้าน)
export function tagsByGroup(db, tags) {
  const set = new Set(tags || [])
  return (db.optionGroups || [])
    .map((g) => ({ group: g, names: (g.options || []).filter((o) => set.has(o.id)).map((o) => o.name) }))
    .filter((x) => x.names.length)
    .map((x) => ({ key: x.group.key, name: x.group.name, names: x.names }))
}
