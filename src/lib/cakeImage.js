// เลือกรูปเค้กสั่งทำตามตัวเลือกที่ลูกค้าเลือก (ฟังก์ชันล้วน)
// คลังรูป = [{ id, image, tags: [optionId…], caption, active }] · รูปของ "ประเภท" ที่ตั้งไว้เดิม (type.images) นับเป็นรูปที่แท็กประเภทนั้น
// ให้คะแนน = Σ น้ำหนักแท็กที่ตรงกับตัวเลือก − 0.6 × Σ น้ำหนักแท็กที่ไม่ตรง (รูปที่ระบุเฉพาะเจาะจงกว่าและไม่ขัดกับตัวเลือกชนะ)
// น้ำหนักตามกลุ่ม: ประเภท 8 · เนื้อเค้ก 4 · ขนาด 2 · อื่น ๆ 1
const WEIGHT = { type: 8, flavor: 4, size: 2 }
const PENALTY = 0.6

// แผนที่ optionId → { groupKey, groupName, name }
export function optionIndex(groups) {
  const m = new Map()
  for (const g of groups || []) for (const o of g.options || []) m.set(o.id, { groupKey: g.key, groupName: g.name, name: o.name, group: g.id })
  return m
}
// รวมรูปทั้งหมดที่ใช้เลือก: คลังที่เปิดใช้ + รูปประเภทเดิม
export function galleryOf(db) {
  const out = []
  for (const g of db.cakeGallery || []) if (g.active !== false && g.image) out.push({ id: g.id, image: g.image, tags: [...(g.tags || [])], caption: g.caption || '' })
  const typeG = (db.optionGroups || []).find((x) => x.key === 'type')
  for (const t of typeG?.options || []) {
    if (t.active === false) continue
    ;(t.images || []).forEach((im, i) => out.push({ id: `type:${t.id}:${i}`, image: im, tags: [t.id], caption: '' }))
  }
  return out
}
// selected = รายการ optionId ที่ลูกค้าเลือก (รวมประเภท) · คืน { image, exact, matched, missing, alternatives, caption }
export function pickImage(selected, gallery, groups) {
  const idx = optionIndex(groups)
  const sel = new Set(selected || [])
  const w = (id) => WEIGHT[idx.get(id)?.groupKey] ?? 1
  const nameOf = (id) => idx.get(id)?.name || id
  // กลุ่มที่ "มีรูปถ่ายไว้" อย่างน้อยหนึ่งแท็ก: ตัวเลือกในกลุ่มนั้นที่รูปที่เลือกไม่ครอบคลุม = "ยังไม่มีรูป" (กลุ่มที่ไม่เคยมีรูปเลยไม่นับว่าขาด)
  const photoGroups = new Set()
  for (const e of gallery) for (const t of e.tags) photoGroups.add(idx.get(t)?.group)
  const photographed = { has: (id) => photoGroups.has(idx.get(id)?.group) }
  const scored = gallery.map((e, order) => {
    let s = 0
    for (const t of e.tags) s += sel.has(t) ? w(t) : -PENALTY * w(t)
    const matched = e.tags.filter((t) => sel.has(t))
    return { e, s, order, matched, tagged: e.tags.length }
  }).filter((x) => x.matched.length > 0)
  if (!scored.length) return { image: '', entry: null, exact: false, matched: [], missing: [...sel].filter((id) => photographed.has(id)).map(nameOf), alternatives: [], caption: 'ยังไม่มีรูปของแบบนี้' }
  scored.sort((a, b) => b.s - a.s || b.tagged - a.tagged || a.order - b.order)
  const best = scored[0]
  const tags = new Set(best.e.tags)
  const missingIds = [...sel].filter((id) => photographed.has(id) && !tags.has(id))
  const foreign = best.e.tags.filter((t) => !sel.has(t))
  const exact = !missingIds.length && !foreign.length
  return {
    image: best.e.image,
    entry: best.e,
    exact,
    matched: best.matched.map(nameOf),
    missing: missingIds.map(nameOf),
    foreign: foreign.map(nameOf),
    alternatives: scored.filter((x) => Math.abs(x.s - best.s) < 1e-9).map((x) => x.e),
    caption: best.e.caption || '',
  }
}
// ข้อความกำกับใต้รูปเมื่อไม่ตรงเป๊ะ ('' = ไม่ต้องกำกับ)
export function imageNote(p) {
  if (!p) return ''
  if (!p.image) return 'ยังไม่มีรูปของแบบนี้ — ร้านจะส่งรูปตัวอย่างให้ทางแชท'
  if (p.exact) return ''
  const parts = []
  if (p.matched.length) parts.push(`ตรงกับ: ${p.matched.join(', ')}`)
  if (p.missing.length) parts.push(`ยังไม่มีรูปของ: ${p.missing.join(', ')}`)
  if (p.foreign?.length) parts.push(`รูปนี้เป็นแบบ: ${p.foreign.join(', ')}`)
  return `รูปตัวอย่างใกล้เคียง (${parts.join(' · ')}) งานจริงอาจต่างเล็กน้อย`
}
// ความครอบคลุมของคลังรูป: ตัวเลือกที่ยังไม่มีรูปอ้างถึงเลย (ต่อกลุ่ม) + ชุด ประเภท×เนื้อ ที่ลูกค้าสั่งจริงแต่ยังไม่มีรูปตรง
export function galleryCoverage(db, groups = db.optionGroups) {
  const gal = galleryOf(db)
  const tagged = new Set(gal.flatMap((e) => e.tags))
  const rows = (groups || []).filter((g) => g.active !== false && g.appliesTo?.includes("custom") && g.type !== "text").map((g) => ({ group: g, missing: (g.options || []).filter((o) => o.active !== false && !tagged.has(o.id)) }))
  // ชุดที่นิยม: ประเภท+เนื้อ จากออร์เดอร์เค้กสั่งทำ (ไม่นับร่าง/ยกเลิก)
  const typeG = (groups || []).find((g) => g.key === 'type')
  const flavG = (groups || []).find((g) => g.key === 'flavor')
  const count = new Map()
  for (const o of db.orders || []) {
    if (['draft', 'cancelled'].includes(o.status)) continue
    for (const it of o.items || []) {
      if (it.kind !== 'custom') continue
      const sels = [it.selections || {}, ...(it.tiers || []).map((t) => t.selections || {})]
      const pick = (g) => { for (const s of sels) { const v = s[g?.id]; const id = Array.isArray(v) ? v[0] : v; if (id) return id } return null }
      const t = pick(typeG), f = pick(flavG)
      if (!t || !f) continue
      const k = `${t}|${f}`
      count.set(k, (count.get(k) || 0) + (Number(it.qty) || 1))
    }
  }
  const nm = (g, id) => g?.options?.find((o) => o.id === id)?.name || id
  const popular = [...count].map(([k, n]) => { const [t, f] = k.split('|'); return { typeId: t, flavorId: f, label: `${nm(typeG, t)} · ${nm(flavG, f)}`, count: n, covered: gal.some((e) => e.tags.includes(t) && e.tags.includes(f)) } }).sort((a, b) => b.count - a.count)
  return { groups: rows, popular: popular.filter((p) => !p.covered), totalImages: gal.length }
}
