// ระบบจัดส่ง (ฟังก์ชันล้วน): ค่าส่งจากระยะทาง · ตรวจ url แผนที่ · ล้างข้อมูลจัดส่ง · จำสถานที่ของลูกค้า

export const DEFAULT_DELIVERY = { enabled: false, freeKm: 0, perKm: 10, minFee: 0, roundTo: 5 }
export const PLACE_MAX = 10 // จำสถานที่ล่าสุดต่อลูกค้า
export const LIMITS = { placeName: 80, address: 300, detail: 300, url: 500, km: 999 }

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)

export function cleanDeliveryConfig(c = {}) {
  const roundTo = Math.round(num(c.roundTo, 5))
  return {
    enabled: !!c.enabled,
    freeKm: Math.min(LIMITS.km, Math.max(0, num(c.freeKm, 0))),
    perKm: Math.min(100000, Math.max(0, num(c.perKm, 0))),
    minFee: Math.min(100000, Math.max(0, num(c.minFee, 0))),
    roundTo: roundTo >= 1 && roundTo <= 1000 ? roundTo : 5,
  }
}

// ค่าส่งที่แนะนำ: ปิดใช้/ระยะไม่ถูกต้อง/เรต 0 → null · ≤ freeKm → 0 · เกิน → max(minFee, ปัดขึ้นตาม roundTo ของ (km − freeKm) × perKm)
export function deliveryFee(km, cfg) {
  const c = cleanDeliveryConfig(cfg)
  const d = Number(km)
  if (!c.enabled || !Number.isFinite(d) || d < 0 || !(c.perKm > 0)) return null
  if (d <= c.freeKm) return 0
  const raw = Math.round((d - c.freeKm) * c.perKm * 100) / 100
  const rounded = Math.ceil(raw / c.roundTo - 1e-9) * c.roundTo
  return Math.max(c.minFee, rounded)
}

// url แผนที่: https เท่านั้น · ไม่มี userinfo · ยาว ≤ 500 · ว่าง = ไม่ใส่ (ok, url '')
export function checkMapUrl(raw) {
  const s = String(raw ?? '').trim()
  if (!s) return { ok: true, url: '', host: '' }
  if (s.length > LIMITS.url) return { error: `url ยาวเกิน ${LIMITS.url} ตัวอักษร` }
  if (/[\s<>"'`\\]/.test(s)) return { error: 'url มีตัวอักษรที่ไม่อนุญาต' }
  let u
  try { u = new URL(s) } catch { return { error: 'url ไม่ถูกต้อง (ต้องขึ้นต้น https://)' } }
  if (u.protocol !== 'https:') return { error: 'ต้องเป็น https:// เท่านั้น' }
  if (u.username || u.password) return { error: 'url ห้ามมีชื่อผู้ใช้/รหัสผ่าน' }
  if (!u.hostname.includes('.')) return { error: 'url ไม่ถูกต้อง' }
  return { ok: true, url: u.href, host: u.hostname }
}

// ล้างข้อมูลจัดส่ง (ตัดความยาว/ชนิด) · คืน { value, error } error = ข้อความภาษาไทยของช่องแรกที่ผิด
export function cleanDelivery(d = {}) {
  const url = checkMapUrl(d.mapUrl)
  if (url.error) return { error: url.error, field: 'mapUrl' }
  const km = d.distanceKm === '' || d.distanceKm == null ? null : Number(d.distanceKm)
  if (km != null && (!Number.isFinite(km) || km < 0 || km > LIMITS.km)) return { error: `ระยะทางต้องอยู่ระหว่าง 0–${LIMITS.km} กม.`, field: 'distanceKm' }
  const fee = d.shippingFee === '' || d.shippingFee == null ? 0 : Number(d.shippingFee)
  if (!Number.isFinite(fee) || fee < 0) return { error: 'ค่าส่งต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', field: 'shippingFee' }
  const t = (v, n) => String(v ?? '').trim().slice(0, n)
  return {
    value: {
      placeName: t(d.placeName, LIMITS.placeName), address: t(d.address, LIMITS.address), mapUrl: url.url, detail: t(d.detail, LIMITS.detail),
      distanceKm: km == null ? null : Math.round(km * 100) / 100, shippingFee: Math.round(fee * 100) / 100, feeManual: !!d.feeManual,
    },
  }
}

const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase()
export const placeKey = (p) => `${norm(p.address)}|${String(p.mapUrl || '').trim()}`

// จำสถานที่: ซ้ำ (ที่อยู่+url เดียวกัน) → เพิ่ม uses / อัปเดตข้อมูล · ใหม่ → เพิ่มหัวรายการ · เก็บ PLACE_MAX ที่ล่าสุด · คืน list ใหม่
export function rememberPlace(places, p, nowIso, newId) {
  if (!norm(p.address)) return places
  const list = (places || []).map((x) => ({ ...x }))
  const i = list.findIndex((x) => placeKey(x) === placeKey(p))
  if (i >= 0) {
    const cur = list.splice(i, 1)[0]
    list.unshift({ ...cur, name: p.placeName || cur.name, detail: p.detail || cur.detail, distanceKm: p.distanceKm ?? cur.distanceKm, uses: (cur.uses || 1) + 1, lastUsedAt: nowIso })
  } else {
    list.unshift({ id: newId(), name: p.placeName || '', address: String(p.address).trim(), mapUrl: p.mapUrl || '', detail: p.detail || '', distanceKm: p.distanceKm ?? null, uses: 1, lastUsedAt: nowIso })
  }
  return list.slice(0, PLACE_MAX)
}
