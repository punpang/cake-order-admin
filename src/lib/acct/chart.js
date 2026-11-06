// ผังบัญชีไทยตั้งต้น (แก้/เพิ่มได้) · kind: asset | liability | equity | revenue | expense
// system = ระบบดึงข้อมูลอัตโนมัติใช้ (ปิดใช้/ลบไม่ได้) · quick = ให้เลือกในฟอร์มบันทึกรายได้/ค่าใช้จ่าย · taxDeductible = ค่าใช้จ่ายหักภาษีได้ตามปกติ
const A = (id, name, kind, extra = {}) => ({ id, name, kind, active: true, system: false, quick: false, taxDeductible: kind === 'expense', ...extra })

export const DEFAULT_ACCOUNTS = [
  A('1010', 'เงินสด', 'asset', { system: true, group: 'cash' }),
  A('1020', 'ธนาคาร / โอน / บัตร', 'asset', { system: true, group: 'cash' }),
  A('1100', 'ลูกหนี้การค้า', 'asset', { system: true, group: 'current' }),
  A('1200', 'วัตถุดิบ / สินค้าคงเหลือ', 'asset', { system: true, group: 'current' }),
  A('1250', 'ภาษีซื้อ', 'asset', { system: true, group: 'current' }),
  A('1260', 'ภาษีซื้อต้องห้าม (รอปรับปรุง)', 'asset', { group: 'current' }),
  A('1300', 'ค่าใช้จ่ายจ่ายล่วงหน้า', 'asset', { system: true, group: 'current' }),
  A('1500', 'สินทรัพย์ถาวร (ราคาทุน)', 'asset', { system: true, group: 'fixed' }),
  A('1590', 'ค่าเสื่อมราคาสะสม', 'asset', { system: true, group: 'fixed', contra: true }),
  A('2100', 'เจ้าหนี้การค้า / ค้างจ่าย', 'liability', { system: true, group: 'current' }),
  A('2200', 'ภาษีขาย', 'liability', { system: true, group: 'current' }),
  A('2210', 'ภาษีมูลค่าเพิ่มรอนำส่ง / ชำระเกิน', 'liability', { system: true, group: 'current' }),
  A('2300', 'รายได้รับล่วงหน้า / เงินมัดจำลูกค้า', 'liability', { system: true, group: 'current' }),
  A('2310', 'ภาระคะแนนที่คืนให้ลูกค้า', 'liability', { system: true, group: 'current' }),
  A('2350', 'รายได้รับล่วงหน้า (อื่น ๆ)', 'liability', { system: true, group: 'current' }),
  A('2400', 'เงินกู้ / เจ้าหนี้ผ่อนชำระ', 'liability', { system: true, group: 'long' }),
  A('3100', 'ทุน / เงินลงทุนเจ้าของ', 'equity', { system: true }),
  A('3200', 'กำไร (ขาดทุน) สะสม', 'equity', { system: true }),
  A('3300', 'ถอนใช้ส่วนตัว', 'equity', { system: true, contra: true }),
  A('4100', 'รายได้ขายเค้กสั่งทำ', 'revenue', { system: true }),
  A('4200', 'รายได้ขายหน้าร้าน / สินค้าสำเร็จ', 'revenue', { system: true }),
  A('4300', 'รายได้ค่าจัดส่ง', 'revenue', { system: true }),
  A('4800', 'รายได้อื่น (ดอกเบี้ยรับ ฯลฯ)', 'revenue', { quick: true }),
  A('4810', 'กำไรจากการจำหน่ายสินทรัพย์', 'revenue', { system: true }),
  A('4900', 'รายได้อื่น - ริบมัดจำ/ค่าธรรมเนียมยกเลิก', 'revenue', { system: true }),
  A('5100', 'ต้นทุนขาย (วัตถุดิบตามสูตร)', 'expense', { system: true }),
  A('5110', 'ซื้อวัตถุดิบ/บรรจุภัณฑ์ (ตัดเป็นค่าใช้จ่ายทันที)', 'expense', { quick: true }),
  A('5200', 'ค่าเช่า', 'expense', { quick: true }),
  A('5210', 'ค่าน้ำ ค่าไฟ', 'expense', { quick: true }),
  A('5220', 'ค่าแก๊ส/เชื้อเพลิง', 'expense', { quick: true }),
  A('5300', 'เงินเดือน / ค่าแรง', 'expense', { quick: true }),
  A('5400', 'ค่าโฆษณา / การตลาด', 'expense', { quick: true }),
  A('5410', 'ค่าใช้จ่ายคะแนนสะสม (ใช้เป็นส่วนลด)', 'expense', { system: true }),
  A('5420', 'ค่าใช้จ่ายส่วนลดคูปอง', 'expense', { system: true }),
  A('5430', 'ต้นทุนของรางวัลที่มอบ', 'expense', { system: true }),
  A('5500', 'ค่าขนส่ง / ค่าส่งสินค้า', 'expense', { quick: true }),
  A('5600', 'ค่าซ่อมแซม / บำรุงรักษา', 'expense', { quick: true }),
  A('5700', 'ค่าสื่อสาร / อินเทอร์เน็ต / ระบบ', 'expense', { quick: true }),
  A('5710', 'ค่าธรรมเนียมธนาคาร / ค่ารูดบัตร', 'expense', { quick: true }),
  A('5800', 'ค่าเสื่อมราคา', 'expense', { system: true }),
  A('5810', 'ดอกเบี้ยจ่าย', 'expense', { system: true }),
  A('5820', 'ขาดทุนจากการจำหน่ายสินทรัพย์', 'expense', { system: true }),
  A('5900', 'ค่าใช้จ่ายเบ็ดเตล็ด', 'expense', { quick: true }),
  A('5910', 'ค่ารับรอง', 'expense', { quick: true, taxLimited: true }),
  A('5990', 'ค่าปรับ / เบี้ยปรับ / เงินเพิ่มภาษี', 'expense', { quick: true, taxDeductible: false }),
]

export const KIND_LABEL = { asset: 'สินทรัพย์', liability: 'หนี้สิน', equity: 'ส่วนของเจ้าของ', revenue: 'รายได้', expense: 'ค่าใช้จ่าย' }
// ด้านปกติของแต่ละหมวด (สินทรัพย์/ค่าใช้จ่าย = เดบิต)
export const normalSide = (kind) => (kind === 'asset' || kind === 'expense' ? 'dr' : 'cr')
export const accountMap = (accounts) => new Map(accounts.map((a) => [a.id, a]))
// รหัสบัญชีที่ระบบใช้ดึงอัตโนมัติ
export const CASH = '1010', BANK = '1020', AR = '1100', INV = '1200', INPUT_VAT = '1250', DEPOSIT = '2300', OUTPUT_VAT = '2200', POINTS_LIAB = '2310', AP = '2100'
