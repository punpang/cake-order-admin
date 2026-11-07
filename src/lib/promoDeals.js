// คำอธิบาย/คำเตือนของ "ดีล" (ฟังก์ชันล้วน) · การคำนวณจริงอยู่ที่ applyPosPromos (lib/posPromo.js)
import { money } from './format'

const scopeText = (d, nameOf) =>
  d.scope === 'all' ? 'ทุกสินค้า' : d.scope === 'category' ? (d.categories || []).join(', ') || '-' : (d.itemIds || []).map(nameOf).join(', ') || '-'
const offText = (t) => (t.type === 'percent' ? `${t.value}%` : money(t.value))

export function describeDeal(d, nameOf = (id) => id) {
  switch (d.kind) {
    case 'bogo':
      return `ซื้อ ${d.buyQty} ชิ้น แถม ${d.giftQty} ชิ้น${d.giftItemId ? ` (${nameOf(d.giftItemId)})` : ' (ชิ้นเดียวกัน)'} · ${scopeText(d, nameOf)}${d.repeat === false ? ' · ครั้งเดียวต่อบิล' : ''}${Number(d.maxGifts) > 0 ? ` · แถมสูงสุด ${d.maxGifts}` : ''}`
    case 'nth':
      return `${Number(d.percent) >= 100 ? `ซื้อ ${d.n} จ่าย ${d.n - 1}` : `ชิ้นที่ ${d.n} ลด ${d.percent}%`} · ${scopeText(d, nameOf)}`
    case 'spend_off':
      return [...(d.tiers || [])].sort((a, b) => a.min - b.min).map((t) => `ครบ ${money(t.min)} ลด ${offText(t)}`).join(' · ')
    case 'spend_free':
      return `ซื้อครบ ${money(d.min)} ฟรี ${nameOf(d.giftItemId)}${d.giftQty > 1 ? ` ×${d.giftQty}` : ''}`
    case 'spend_addon':
      return `ซื้อครบ ${money(d.min)} ซื้อ ${nameOf(d.itemId)} ราคา ${money(d.price)}${d.limit > 1 ? ` (สูงสุด ${d.limit} ชิ้น)` : ''}`
    case 'free_ship':
      return `ส่งฟรีเมื่อซื้อครบ ${money(d.min)} (ออร์เดอร์จัดส่ง)`
    default:
      return ''
  }
}

// คำเตือนในหน้าจัดการ (สินค้าถูกลบ/ปิด/สต็อกหมด/ขั้นไม่สมเหตุผล)
export function dealWarnings(d, retail = []) {
  const find = (id) => retail.find((x) => x.id === id)
  const w = []
  const need = (id, label) => {
    const it = find(id)
    if (!it) w.push(`${label}ถูกลบแล้ว`)
    else if (it.active === false) w.push(`${label} (${it.name}) ปิดขายอยู่`)
    else if (it.stock === 0) w.push(`${label} (${it.name}) สต็อกหมด จะไม่แถม`)
  }
  if (d.kind === 'bogo' && d.giftItemId) need(d.giftItemId, 'สินค้าของแถม')
  if (d.kind === 'spend_free') need(d.giftItemId, 'สินค้าของแถม')
  if (d.kind === 'spend_addon') {
    need(d.itemId, 'สินค้า add-on')
    const it = find(d.itemId)
    if (it && !(d.price < it.price)) w.push('ราคาพิเศษไม่ต่ำกว่าราคาปกติแล้ว (ดีลนี้จะไม่ลด)')
  }
  if ((d.kind === 'bogo' || d.kind === 'nth') && d.scope === 'items' && (d.itemIds || []).some((id) => !find(id))) w.push('มีสินค้าที่ถูกลบในขอบเขตดีล')
  return w
}

// ข้อความโปรในกล่องโปรโมชันหน้าร้านเว็บ
export const dealPublicText = (d, nameOf) => describeDeal(d, nameOf)
