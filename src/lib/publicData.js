// ข้อมูลที่เปิดสาธารณะ (ฟังก์ชันล้วน ไม่พึ่งไลบรารีอื่น) — ใช้ร่วมระหว่าง configSync (เขียนสำเนา) และ publicSync (อ่าน)
export const PUBLIC_COLLECTION = 'shop_public'
export const PUBLIC_KEYS = ['optionGroups', 'bundles', 'priceLists', 'posModifiers', 'posDiscounts', 'posBundles', 'posDeals']
const SHOP_FIELDS = ['name', 'open', 'close', 'slotMinutes', 'nearbyHours', 'leadPickup', 'leadDelivery', 'depositPercent', 'birthdayDays', 'closures', 'delivery']

// ข้อมูลร้านที่เปิดสาธารณะ: เฉพาะฟิลด์ในรายการ + VAT (เปิด/แบบ/อัตรา) — ไม่รวมบัญชีรับเงิน เลขผู้เสียภาษี ที่อยู่ ลิงก์/การเตือนภายใน
export function publicShop(shop) {
  const out = {}
  for (const k of SHOP_FIELDS) if (shop?.[k] !== undefined) out[k] = JSON.parse(JSON.stringify(shop[k]))
  if (shop?.vat) out.vat = { enabled: !!shop.vat.enabled, mode: shop.vat.mode, rate: shop.vat.rate }
  return out
}

// แถวสำเนาสาธารณะของคีย์ที่เปลี่ยน (optionGroups ต้องตัดสูตรออกก่อนเสมอ — ส่ง groups ที่ตัดแล้วเข้ามา)
export function mirrorRows(values) {
  const rows = []
  for (const k of Object.keys(values)) {
    if (k === 'shop') rows.push({ collection: PUBLIC_COLLECTION, id: 'shop', data: { v: publicShop(values.shop) } })
    else if (PUBLIC_KEYS.includes(k)) rows.push({ collection: PUBLIC_COLLECTION, id: k, data: { v: values[k] ?? null } })
  }
  return rows
}

