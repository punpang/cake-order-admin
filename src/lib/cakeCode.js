// รหัสเค้กสั่งทำ: ลูกค้าเลือกบนหน้าเว็บ → คัดลอกส่งแชท → หลังบ้านวางแล้วได้รายการเดียวกัน (ฟังก์ชันล้วน)
// รูปแบบ: #CK1.<payload base64url>.<checksum 3 ตัว> · payload (ข้อความกระชับ) = 1|จำนวน|ราคา/ชิ้นที่ลูกค้าเห็น|ตัวเลือกทั้งก้อน|จำนวนชั้น|ตัวเลือกชั้น1~ชั้น2…|หมายเหตุ
// ตัวเลือก = กลุ่ม:ค่า;กลุ่ม:ค่า1,ค่า2 · ตัวอักษรพิเศษ \ ; : , | ~ ใส่ \ นำหน้า
// checksum ไว้จับข้อความที่ถูกตัด/พิมพ์ผิด (ไม่ใช่ความปลอดภัย) · ราคาในรหัสใช้แค่เตือนเมื่อราคาปัจจุบันต่างไป — หลังบ้านคิดราคาใหม่เสมอ
import { priceDetail, allowedBy, forType, describeSelections, groupOkFor } from './pricing'
import { MAIN_KEYS, typeFreeGroup } from './constants'
import { money } from './format'

export const CODE_RE = /#CK1\.([A-Za-z0-9_-]+)\.([0-9a-z]{3})/g
export const LIMITS = { qty: 999, tiers: 10, text: 500, note: 300, payload: 8000 }

// ---------- เข้ารหัส ----------
const toB64u = (s) => {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
const fromB64u = (s) => {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}
export function checksum(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(3, '0').slice(-3)
}

const emptyVal = (v) => v == null || v === '' || (Array.isArray(v) && !v.length)
const prune = (sels, allowedIds) => {
  const out = {}
  for (const [k, v] of Object.entries(sels || {})) if (allowedIds.has(k) && !emptyVal(v)) out[k] = Array.isArray(v) ? [...v] : v
  return out
}
const customGroups = (groups) => groups.filter((g) => g.active !== false && g.appliesTo.includes('custom'))

// ชื่อรายการ = ประเภท · เนื้อเค้ก · ขนาด (หลายชั้นคั่นด้วย /) — ตรงกับที่ ItemEditor ตั้ง
export function itemNameOf(item, groups) {
  const namesOf = (g, sels) => {
    const sel = sels?.[g.id]
    const ids = sel == null ? [] : Array.isArray(sel) ? sel : [sel]
    return ids.map((id) => g.options.find((o) => o.id === id)?.name).filter(Boolean).join(' + ')
  }
  const hasTiers = !!item.tiers?.length
  const mainOf = (t) =>
    MAIN_KEYS.map((k) => groups.find((g) => g.key === k))
      .filter(Boolean)
      .map((g) => namesOf(g, g.perTier && hasTiers ? t.selections : item.selections))
      .filter(Boolean)
      .join(' · ')
  const tiers = hasTiers ? item.tiers : [{ selections: item.selections }]
  return tiers.length > 1 ? `เค้กสั่งทำ ${tiers.length} ชั้น (${tiers.map((t) => mainOf(t) || '-').join(' / ')})` : mainOf(tiers[0]) || 'เค้กสั่งทำ'
}

// ---------- แพ็ก/แกะข้อความกระชับ ----------
const esc = (x) => String(x).replace(/[\\;:,|~]/g, '\\$&')
// แยกด้วยตัวคั่นที่ไม่ได้ถูก escape (ยังคง escape ไว้ในชิ้นส่วน)
function splitRaw(str, sep) {
  const out = []
  let cur = ''
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '\\') { cur += c + (str[i + 1] ?? ''); i++ } else if (c === sep) { out.push(cur); cur = '' } else cur += c
  }
  out.push(cur)
  return out
}
const unesc = (x) => x.replace(/\\(.)/g, '$1')
const packSel = (sels) => Object.entries(sels).map(([k, v]) => `${esc(k)}:${Array.isArray(v) ? v.map(esc).join(',') : esc(v)}`).join(';')
// สร้างรหัสจากค่าที่เตรียมแล้ว (ใช้ในเทสต์ปลอมรหัสด้วย)
export function buildCode(qty, price, whole, tiers, note = '') {
  const body = toB64u(['1', qty, price, packSel(whole), tiers.length, tiers.map(packSel).join('~'), esc(note)].join('|'))
  return `#CK1.${body}.${checksum(body)}`
}
// ข้อความ → { sels } | { error } · ชนิดค่า (หลายค่า/ค่าเดียว) ดูจากกลุ่มในร้าน
function unpackSel(str, cg) {
  const sels = {}
  if (str === '') return { sels }
  for (const part of splitRaw(str, ';')) {
    const kv = splitRaw(part, ':')
    if (kv.length !== 2 || !kv[0]) return { error: 'โครงสร้างรหัสไม่ถูกต้อง' }
    const gid = unesc(kv[0])
    const g = cg.find((x) => x.id === gid)
    if (!g) return { error: `ไม่พบกลุ่มตัวเลือก (${gid}) อาจถูกลบหรือปิดใช้งาน` }
    if (gid in sels) return { error: 'รหัสมีกลุ่มซ้ำ' }
    sels[gid] = g.type === 'multi' ? splitRaw(kv[1], ',').map(unesc) : unesc(kv[1])
  }
  return { sels }
}

// item = { qty, selections, tiers, note, unitPrice } → { code, text }
export function encodeCake(item, groups) {
  const cg = customGroups(groups)
  const whole = new Set(cg.filter((g) => !g.perTier).map((g) => g.id))
  const tier = new Set(cg.filter((g) => g.perTier).map((g) => g.id))
  const t = tier.size ? (item.tiers?.length ? item.tiers : [{ selections: {} }]).map((x) => prune(x.selections, tier)) : []
  const qty = Math.max(1, Math.round(Number(item.qty) || 1))
  const w = prune(item.selections, whole)
  const code = buildCode(qty, Math.round((Number(item.unitPrice) || 0) * 100) / 100, w, t, String(item.note || '').slice(0, LIMITS.note))
  const name = itemNameOf({ selections: item.selections, tiers: t.map((s) => ({ selections: s })) }, groups)
  const mainNames = MAIN_KEYS.map((k) => groups.find((g) => g.key === k)?.name).filter(Boolean)
  const lines = describeSelections({ kind: 'custom', selections: w, tiers: t.map((s) => ({ selections: s })) }, groups).filter((d) => !mainNames.some((n) => d.group === n || d.group.endsWith(` · ${n}`)))
  const text = [`${name} ×${qty} = ${money((Number(item.unitPrice) || 0) * qty)}`, ...lines.map((d) => `${d.group}: ${d.value}`), code].join('\n')
  return { code, text }
}

// หารหัสทั้งหมดในข้อความ (ข้อความอื่นรอบ ๆ ไม่สนใจ)
export const findCodes = (text) => [...String(text || '').matchAll(CODE_RE)].map((m) => m[0])

// ---------- ถอดรหัส ----------
// ctx = { groups, products, active, bundles } (เหมือนที่ ItemEditor ใช้คิดราคา) · คืน { item, warnings, expected } | { error }
export function decodeCake(raw, ctx) {
  const m = new RegExp(CODE_RE.source).exec(String(raw || ''))
  if (!m) return { error: 'ไม่พบรหัสสินค้า (#CK1…) ในข้อความ' }
  const [, body, chk] = m
  if (body.length > LIMITS.payload) return { error: 'รหัสยาวเกินกำหนด' }
  if (checksum(body) !== chk) return { error: 'รหัสไม่ครบหรือพิมพ์ผิด (checksum ไม่ตรง) ให้ลูกค้าคัดลอกใหม่' }
  let raw8
  try { raw8 = fromB64u(body) } catch { return { error: 'อ่านรหัสไม่ได้ ให้ลูกค้าคัดลอกใหม่' } }
  const f = splitRaw(raw8, '|')
  if (f[0] !== '1') return { error: 'รหัสเวอร์ชันนี้ไม่รองรับ' }
  if (f.length !== 7) return { error: 'โครงสร้างรหัสไม่ถูกต้อง' }
  const qty = /^\d+$/.test(f[1]) ? Number(f[1]) : NaN
  const price = Number(f[2])
  if (!Number.isInteger(qty) || qty < 1 || qty > LIMITS.qty) return { error: 'จำนวนในรหัสไม่ถูกต้อง' }
  const nT = /^\d+$/.test(f[4]) ? Number(f[4]) : NaN
  if (!Number.isInteger(nT) || nT > LIMITS.tiers) return { error: 'โครงสร้างรหัสไม่ถูกต้อง' }
  const note = unesc(f[6])
  const tierParts = nT ? splitRaw(f[5], '~') : []
  if (tierParts.length !== nT || (!nT && f[5] !== '')) return { error: 'โครงสร้างรหัสไม่ถูกต้อง' }

  const groups = ctx.groups
  const cg = customGroups(groups)
  const typeG = groups.find((g) => g.key === 'type')
  const wholeR = unpackSel(f[3], cg)
  if (wholeR.error) return { error: wholeR.error }
  const tierList = []
  for (const part of tierParts) {
    const r = unpackSel(part, cg)
    if (r.error) return { error: r.error }
    tierList.push({ selections: r.sels })
  }
  const sel = { ...wholeR.sels }
  const places = [{ s: sel, tierGroups: false }, ...tierList.map((t) => ({ s: t.selections, tierGroups: true }))]
  const warnings = []
  // ตัวเลือกที่ประเภทของชั้นใช้ได้ (ตรงกับ ItemEditor.allowFor)
  const typeSelsOf = (t) => (typeG && typeG.perTier && t ? t.selections : sel)
  const allowFor = (t) => {
    const a = allowedBy(groups, typeSelsOf(t))
    const v = typeSelsOf(t)?.[typeG?.id]
    const tid = Array.isArray(v) ? v[0] : v
    const gok = groupOkFor(groups, { kind: 'custom', selections: sel, tiers: tierList }, t)
    return (g, o) => gok(g) && (!o || (a(g, o) && (typeFreeGroup(g) || forType(o, tid))))
  }
  if (tierList.length && !cg.some((g) => g.perTier)) return { error: 'โครงสร้างตัวเลือกร้านเปลี่ยนไป (ไม่มีกลุ่มแยกชั้น)' }
  for (const [pi, p] of places.entries()) {
    const t = pi === 0 ? tierList[0] : tierList[pi - 1]
    const allow = allowFor(t)
    for (const [gid, v] of Object.entries(p.s)) {
      const g = cg.find((x) => x.id === gid)
      if (!g) return { error: `ไม่พบกลุ่มตัวเลือก (${gid}) อาจถูกลบหรือปิดใช้งาน` }
      if (!allow(g, null)) { delete p.s[gid]; warnings.push({ kind: 'group', text: `"${g.name}" เลือกไม่ได้กับรูปแบบตกแต่งที่เลือก (ตัดออกแล้ว)` }); continue }
      if (!!g.perTier !== p.tierGroups) return { error: `กลุ่ม "${g.name}" อยู่ผิดตำแหน่ง โครงสร้างราคาร้านเปลี่ยนไป` }
      if (g.type === 'text') {
        if (typeof v !== 'string' || v.length > LIMITS.text) return { error: `ข้อความของ "${g.name}" ไม่ถูกต้อง` }
        continue
      }
      const ids = g.type === 'multi' ? v : [v]
      for (const id of ids) {
        const o = g.options.find((x) => x.id === id)
        if (!o || o.active === false) return { error: `ไม่พบตัวเลือกของ "${g.name}" (${id}) อาจถูกลบหรือปิดใช้งาน` }
        if (!allow(g, o)) return { error: `"${o.name}" ใช้กับประเภทที่เลือกไม่ได้` }
      }
    }
  }
  // กลุ่มที่จำเป็นแต่ไม่ได้เลือก → เตือน (ให้พนักงานเติม)
  const need = []
  for (const g of cg.filter((x) => x.required)) {
    if (g.perTier) tierList.forEach((t, i) => allowFor(t)(g, null) && emptyVal(t.selections[g.id]) && need.push(tierList.length > 1 ? `ชั้น ${i + 1} · ${g.name}` : g.name))
    else if (allowFor(tierList[0])(g, null) && emptyVal(sel[g.id])) need.push(g.name)
  }
  if (need.length) warnings.push({ kind: 'missing', text: `ยังไม่ได้เลือก: ${need.join(', ')}` })

  const item = { id: `i${Date.now()}${Math.floor(Math.random() * 1e4)}`, kind: 'custom', retailId: null, retailPrice: 0, sizeId: null, typeId: null, name: '', qty, note: note.slice(0, LIMITS.note), images: [], selections: sel, tiers: tierList }
  item.name = itemNameOf(item, groups)
  const detail = priceDetail(item, groups, ctx.products, ctx.active, ctx.bundles)
  const expected = Number.isFinite(price) ? price : 0
  if (Math.abs(detail.unitPrice - expected) > 0.005) warnings.push({ kind: 'price', text: `ราคาที่ลูกค้าเห็น ${money(expected)}/ชิ้น · ราคาตอนนี้ ${money(detail.unitPrice)}/ชิ้น (ใช้ราคาตอนนี้)`, expected, now: detail.unitPrice })
  return { item: { ...item, ...detail }, warnings, expected }
}
