// ระดับสมาชิก (เฟส 1) — ค่าตั้งต้น · ตรวจค่าให้ตรงกับ punpang__member_cfg (SQL) · ข้อความบัตรระดับ (≤ 3 บรรทัด) · ต้นทุนประมาณการ
// ไม่มีตรรกะคำนวณระดับ/ยอดสะสม: ระดับคำนวณบนเซิร์ฟเวอร์เท่านั้น ไคลเอนต์แสดงผลจากค่าที่เซิร์ฟเวอร์ตอบ
export const MEMBER_MODES = [
  { v: 'off', l: 'ปิด', d: 'ไม่บันทึกยอดสมาชิก และไม่คูณแต้ม' },
  { v: 'shadow', l: 'ทดลอง', d: 'บันทึกยอดและดูรายงานได้ แต่แต้มจริงยังไม่คูณ · ลูกค้าไม่เห็นระดับ' },
  { v: 'live', l: 'ใช้จริง', d: 'คูณแต้มตามระดับจริง และแสดงระดับให้ลูกค้า' },
]
export const DEFAULT_MEMBER_CFG = {
  mode: 'off',
  levels: [
    { name: 'LV1', min: 0, mult: 1 },
    { name: 'LV2', min: 500, mult: 2 },
    { name: 'LV3', min: 2500, mult: 3 },
    { name: 'LV4', min: 5000, mult: 5 },
  ],
  renewGross: 150, // ยอดรายวันก่อน VAT ที่ต่ออายุ (ถ้ามี VAT 7% เหลือ 140)
  inactiveDays: 90, // ช่วงใช้งาน (วัน) หลังต่ออายุ
  goldenDays: 14, // วันทอง: ช่วงพักสิทธิ์ที่ปลุกสิทธิ์เต็มได้ทันที
  downgradeDays: 365, // ครบรอบนี้โดยไม่ต่ออายุ = ลด 1 ขั้น
  bigBill: 500, // บิลใหญ่ (ก่อน VAT) ที่ปลุกสิทธิ์เต็มได้ทันที
  cakeCategories: [], // หมวดสินค้าที่นับเป็น "เค้ก" สำหรับส่วนลดเดือนเกิด (ร้านเลือกเอง · ว่าง = ยังไม่มีส่วนลด)
  cakeItemIds: [], // สินค้าที่ร้านเลือกเองนับเป็นเค้ก (เพิ่มจากหมวด)
}

const isNum = (x) => typeof x === 'number' && Number.isFinite(x)

// ข้อผิดพลาดของค่าตั้งค่า (ว่าง = ใช้ได้) · กติกาเดียวกับ SQL ทุกข้อ + ชื่อระดับต้องไม่ว่าง (เฉพาะหน้าจอ)
export function memberCfgErrors(c) {
  const e = []
  if (!MEMBER_MODES.some((m) => m.v === c?.mode)) e.push('โหมดไม่ถูกต้อง')
  const lv = c?.levels
  if (!Array.isArray(lv) || lv.length < 1 || lv.length > 10) e.push('ต้องมีระดับ 1–10 ขั้น')
  else {
    lv.forEach((l, i) => {
      if (!String(l?.name ?? '').trim()) e.push(`ขั้นที่ ${i + 1}: ใส่ชื่อระดับ`)
      if (!isNum(l?.min) || l.min < 0) e.push(`ขั้นที่ ${i + 1}: เกณฑ์ยอดสะสมต้องเป็นตัวเลข ≥ 0`)
      if (!isNum(l?.mult) || l.mult < 1) e.push(`ขั้นที่ ${i + 1}: ตัวคูณต้องเป็นตัวเลข ≥ 1`)
    })
    if (isNum(lv[0]?.min) && lv[0].min !== 0) e.push('ขั้นแรกต้องเริ่มที่ยอดสะสม 0')
    for (let i = 1; i < lv.length; i++) {
      if (isNum(lv[i]?.min) && isNum(lv[i - 1]?.min) && lv[i].min <= lv[i - 1].min) e.push(`ขั้นที่ ${i + 1}: เกณฑ์ต้องมากกว่าขั้นก่อนหน้า`)
    }
  }
  for (const k of ['renewGross', 'inactiveDays', 'goldenDays', 'downgradeDays', 'bigBill']) if (!isNum(c?.[k])) e.push(`${k} ต้องเป็นตัวเลข`)
  if (isNum(c?.renewGross) && c.renewGross <= 0) e.push('เกณฑ์ต่ออายุต้องมากกว่า 0')
  if (isNum(c?.inactiveDays) && c.inactiveDays < 1) e.push('ช่วงใช้งานต้องอย่างน้อย 1 วัน')
  if (isNum(c?.goldenDays) && c.goldenDays < 0) e.push('วันทองต้องไม่ติดลบ')
  if (isNum(c?.downgradeDays) && isNum(c?.inactiveDays) && c.downgradeDays <= c.inactiveDays) e.push('รอบลดขั้นต้องมากกว่าช่วงใช้งาน')
  if (isNum(c?.bigBill) && c.bigBill < 0) e.push('บิลใหญ่ต้องไม่ติดลบ')
  return e
}

// ข้อความบัตรระดับของลูกค้า (ไม่เกิน 3 บรรทัด) จากค่าที่เซิร์ฟเวอร์ตอบ · ไม่มียอดสะสม
// ถ้อยคำบรรทัดสิทธิ์พัก/วันทองยังรอผู้ใช้ยืนยัน
export function tierLines(t) {
  if (!t?.enabled) return []
  const lines = [`${t.levelName} · ${t.mult > 1 ? `แต้มคูณ ${t.mult} เท่า` : 'แต้มปกติ'}`]
  if (t.status === 'active') lines.push(`ใช้สิทธิ์ถึง ${fmtDate(t.activeUntil)}`)
  else lines.push('สิทธิ์พัก · ซื้อตามเกณฑ์ในวันเดียวเพื่อต่ออายุ')
  if (t.golden) lines.push('ช่วงพิเศษ · ซื้อตามเกณฑ์วันนี้ได้สิทธิ์เต็มทันที')
  else if (t.downgradeAt) lines.push(`รักษาระดับถึง ${fmtDate(t.downgradeAt)}`)
  // LV4 Active ได้คูปองส่วนลด 10 บาททุกเดือน (ตามสเปก) · แทรกเป็นบรรทัดที่ 2 ให้เห็นก่อนบรรทัดรอง
  if (t.levelNo === 4 && t.status === 'active') lines.splice(1, 0, 'คูปองส่วนลด 10 บาททุกเดือน (ซื้อเดือนก่อนครบ 150 บาท)')
  return lines.slice(0, 3)
}
function fmtDate(s) {
  if (!s) return '-'
  const d = new Date(`${s}T12:00:00+07:00`)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Bangkok' })
}

// ต้นทุนประมาณการของระดับหนึ่งต่อยอดซื้อ base (ก่อน VAT): แต้มที่เพิ่มจากตัวคูณ × มูลค่าแต้ม × สัดส่วนที่แลกจริง
export function levelCost({ mult, base, earnPer, pointValue, redeem }) {
  const extraPoints = earnPer > 0 ? ((mult - 1) * base) / earnPer : 0
  const costBaht = extraPoints * pointValue * redeem
  // สูตรเต็ม = รวมแต้มปกติทั้งหมด (ตัวคูณ × ยอดฐาน) · ส่วนเพิ่ม = เฉพาะแต้มที่เกินแต้มปกติ
  const fullCostBaht = earnPer > 0 ? (mult * base * pointValue * redeem) / earnPer : 0
  return {
    extraPoints,
    costBaht,
    costPct: base > 0 ? (costBaht / base) * 100 : 0,
    fullCostPct: base > 0 ? (fullCostBaht / base) * 100 : 0,
  }
}
