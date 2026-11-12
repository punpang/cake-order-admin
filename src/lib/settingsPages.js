// รายการหน้าตั้งค่า จัดเป็นกลุ่มตามงาน (ใช้ทั้งหน้าการ์ดตั้งค่า และเมนูข้างของทุกหน้าย่อยบน PC) · perm = สิทธิ์ที่ต้องมี (ค่าเริ่มต้น manage)
// keywords = คำค้นเพิ่มเติมสำหรับช่องค้นหาในหน้าตั้งค่า
export const SETTINGS_GROUPS = [
  { key: 'overview', title: 'ภาพรวม & รายงาน', tone: 'bg-brand-100 text-brand-700' },
  { key: 'catalog', title: 'สินค้า & ราคา', tone: 'bg-orange-100 text-orange-800' },
  { key: 'customers', title: 'ลูกค้า & สมาชิก', tone: 'bg-amber-100 text-amber-800' },
  { key: 'shop', title: 'ร้าน & หน้าเว็บ', tone: 'bg-matcha-soft text-stone-800' },
  { key: 'channels', title: 'แชท & การแจ้งเตือน', tone: 'bg-sky-100 text-sky-800' },
  { key: 'privacy', title: 'ข้อมูล & ความเป็นส่วนตัว', tone: 'bg-violet-100 text-violet-800' },
  { key: 'team', title: 'ทีมงาน', tone: 'bg-stone-200 text-stone-800' },
]
export const SETTINGS_PAGES = [
  { group: 'overview', to: '/admin/dashboard', icon: 'grid', title: 'ภาพรวมระบบ', perm: 'viewAllOrders', keywords: 'dashboard สถิติ' },
  { group: 'overview', to: '/admin/settings/profit', icon: 'history', title: 'ยอดขาย & กำไร', keywords: 'รายงาน กราฟ ต้นทุน' },
  { group: 'catalog', to: '/admin/settings/options', icon: 'tag', title: 'ตัวเลือก + ราคา', keywords: 'เค้ก ขนาด รสชาติ' },
  { group: 'catalog', to: '/admin/settings/bundles', icon: 'tag', title: 'บันเดิ้ล (ชุดลดราคา)', keywords: 'ชุด ลด ส่วนลด ราคาชุด เลือกครบชุด combo' },
  { group: 'catalog', to: '/admin/settings/pricing', icon: 'calendar', title: 'การกำหนดราคา', keywords: 'ราคาพิเศษ ช่วงวัน โปร' },
  { group: 'catalog', to: '/admin/settings/retail', icon: 'pos', title: 'สินค้า (POS / สินค้าสำเร็จ)', keywords: 'สต็อก เมนู' },
  { group: 'catalog', to: '/admin/settings/promos', icon: 'star', title: 'โปรโมชัน POS / คะแนนพิเศษ', keywords: 'ส่วนลด บันเดิ้ล' },
  { group: 'catalog', to: '/admin/settings/ingredients', icon: 'basket', title: 'วัตถุดิบ', keywords: 'ต้นทุน สูตร' },
  { group: 'customers', to: '/admin/settings/customers', icon: 'users', title: 'ลูกค้า', keywords: 'สมาชิก เบอร์' },
  { group: 'customers', to: '/admin/settings/birthdays', icon: 'cake', title: 'เตือนวันเกิด', keywords: 'อวยพร' },
  { group: 'customers', to: '/admin/settings/loyalty', icon: 'wallet', title: 'คะแนน & รางวัล', keywords: 'แต้ม กาชา ของแลก' },
  { group: 'shop', to: '/admin/settings/shop', icon: 'clock', title: 'ตั้งค่าร้าน', keywords: 'เวลาเปิด บัญชีรับชำระ พร้อมเพย์ มัดจำ ภาษี vat ใบเสร็จ สลิป' },
  { group: 'shop', to: '/admin/settings/storefront', icon: 'store', title: 'หน้าร้าน (เว็บลูกค้า)', keywords: 'รีวิว เมนู' },
  { group: 'shop', to: '/admin/settings/gallery', icon: 'image', title: 'คลังรูปเค้กสั่งทำ', keywords: 'รูป แท็ก' },
  { group: 'shop', to: '/admin/settings/links', icon: 'link', title: 'ลิงก์ย่อ & ลิงก์ออร์เดอร์', keywords: 'url หมดอายุ' },
  { group: 'channels', to: '/admin/settings/integrations', icon: 'send', title: 'การเชื่อมต่อ & แจ้งเตือน', keywords: 'line facebook telegram ข้อความ' },
  { group: 'channels', to: '/admin/settings/sms', icon: 'phone', title: 'SMS Gateway', keywords: 'ข้อความ โทรศัพท์' },
  { group: 'channels', to: '/admin/settings/bot', icon: 'chat', title: 'บอทตอบแชท', keywords: 'ai อัตโนมัติ คีย์เวิร์ด' },
  { group: 'privacy', to: '/admin/settings/legal', icon: 'shield', title: 'PDPA / คุกกี้ / เงื่อนไข', keywords: 'นโยบาย ความเป็นส่วนตัว' },
  { group: 'privacy', to: '/admin/settings/photo-requests', icon: 'alert', title: 'คำขอไม่เผยแพร่รูป', keywords: 'รูปงาน ลูกค้า' },
  { group: 'privacy', to: '/admin/settings/deletion-requests', icon: 'user', title: 'คำขอลบข้อมูลลูกค้า', keywords: 'pdpa ลบบัญชี' },
  { group: 'privacy', to: '/admin/settings/files', icon: 'filter', title: 'พื้นที่รูป & การลบรูป', keywords: 'storage ไฟล์' },
  { group: 'privacy', to: '/admin/settings/retention', icon: 'trash', title: 'จัดการข้อมูลที่เป็นขยะ', keywords: 'ลบอัตโนมัติ ข้อมูลเก่า' },
  { group: 'team', to: '/admin/settings/users', icon: 'lock', title: 'ผู้ใช้ & สิทธิ์', perm: 'manageUsers', keywords: 'พนักงาน รหัสผ่าน' },
]

// จัดกลุ่มรายการที่ผู้ใช้มีสิทธิ์เห็น และกรองด้วยคำค้น (ชื่อ/คำอธิบาย/คำค้นเพิ่มเติม) · กลุ่มที่ไม่มีรายการถูกตัดออก
export function groupSettings(pages, q = '') {
  const s = String(q).trim().toLowerCase()
  const hit = (p) => !s || `${p.title} ${p.desc || ''} ${p.keywords || ''}`.toLowerCase().includes(s)
  return SETTINGS_GROUPS.map((g) => ({ ...g, items: pages.filter((p) => p.group === g.key && hit(p)) })).filter((g) => g.items.length)
}
