// ระบบหลังบ้าน 4 ระบบ (ออร์เดอร์ / POS / บัญชี / ตั้งค่า) · ฟังก์ชันล้วน ไม่ผูกกับ store
// items: เมนูย่อยของระบบ · perms = มีข้อใดข้อหนึ่งจึงเห็น · exact = ไฮไลต์เฉพาะลิงก์ตรง · mobile = แสดงในเมนูล่างมือถือ · badge = ป้ายตัวเลข
// โหมดแอป Android (VITE_APP_MODE=android): เหลือเฉพาะ POS และออร์เดอร์ (ออร์เดอร์ สร้างออร์เดอร์ ชำระเงิน) · ความปลอดภัยยังอยู่ที่ RLS
// โหมดแอปลูกค้า (VITE_APP_MODE=customer): หน้าร้านเหมือนเว็บ (หน้าแรก เมนู ฯลฯ) + บัญชีลูกค้า + หน้าที่เปิดจากลิงก์ · ไม่มีหลังบ้าน
export const APP_MODE = import.meta.env?.VITE_APP_MODE === 'android' ? 'android' : import.meta.env?.VITE_APP_MODE === 'customer' ? 'customer' : 'web'
const ALL_SYSTEMS = [
  {
    key: 'orders', label: 'ออร์เดอร์', icon: 'list', home: '/admin/orders',
    items: [
      { to: '/admin/orders', label: 'ออร์เดอร์', icon: 'list', perms: ['viewAllOrders', 'viewPrepOrders', 'viewDeliveryOrders'], exact: true, mobile: true },
      { to: '/admin/orders/new', label: 'สร้างออร์เดอร์', icon: 'plus', perms: ['createOrder'], exact: true },
      { to: '/admin/chat', label: 'แชท', icon: 'chat', perms: ['chat'], badge: 'chat', mobile: true },
      { to: '/admin/payments', label: 'ชำระเงิน', icon: 'wallet', perms: ['reportPayment', 'confirmPayment'], badge: 'pay', mobile: true },
      { to: '/admin/materials', label: 'ครัว', icon: 'basket', perms: ['viewMaterials'], exact: true, mobile: true },
      { to: '/admin/production', label: 'ตารางผลิต', icon: 'cake', perms: ['viewMaterials'], exact: true },
    ],
  },
  { key: 'pos', label: 'POS', icon: 'pos', home: '/admin/pos', perms: ['pos'], items: [{ to: '/admin/pos', label: 'POS', icon: 'pos', perms: ['pos'] }] },
  { key: 'manee', label: 'ถุงเงิน', icon: 'wallet', home: '/admin/manee-test', perms: ['pos'], items: [{ to: '/admin/manee-test', label: 'ถุงเงิน', icon: 'wallet', perms: ['pos'], exact: true, mobile: true }] },
  { key: 'accounting', label: 'บัญชี', icon: 'wallet', home: '/admin/accounting', perms: ['acctView'], items: [{ to: '/admin/accounting', label: 'บัญชี', icon: 'wallet', perms: ['acctView'] }] },
  { key: 'settings', label: 'ตั้งค่า', icon: 'settings', home: '/admin/settings', perms: ['manage', 'manageUsers'], items: [{ to: '/admin/settings', label: 'ตั้งค่า', icon: 'settings', perms: ['manage', 'manageUsers'] }] },
]

const ANDROID_KEYS = ['orders', 'pos']
const ANDROID_ORDER_LINKS = ['/admin/orders', '/admin/orders/new', '/admin/payments', '/admin/chat']
const ANDROID_PATHS = ['/admin/login', '/admin/no-access', '/admin/pos', '/admin/orders', '/admin/payments', '/admin/chat', '/display']
export const SYSTEMS = APP_MODE === 'android'
  ? ALL_SYSTEMS.filter((s) => ANDROID_KEYS.includes(s.key)).map((s) => (s.key === 'orders' ? { ...s, items: s.items.filter((i) => ANDROID_ORDER_LINKS.includes(i.to)) } : s))
  : ALL_SYSTEMS
// เส้นทางที่เปิดได้ในแอป (โหมดเว็บเปิดทุกเส้นทาง) · หน้าแรกเป็น '' เมื่อผ่าน router (ตัด / ท้ายแล้ว)
const CUSTOMER_PATHS = ['/menu', '/line', '/legal', '/account', '/o', '/luck', '/s']
const isCustomerPath = (path) => ['', '/'].includes(path) || CUSTOMER_PATHS.some((p) => path === p || path.startsWith(p + '/'))
export const allowedInApp = (path) => {
  if (APP_MODE === 'customer') return isCustomerPath(path)
  return APP_MODE !== 'android' || ANDROID_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

// ระบบของเส้นทางนี้ (null = ไม่ใช่หน้าหลังบ้านของระบบใด เช่น no-access)
export function systemOf(path) {
  const p = String(path || '')
  if (!p.startsWith('/admin')) return null
  if (p === '/admin/no-access') return null
  if (p === '/admin/pos' || p.startsWith('/admin/pos/')) return 'pos'
  if (p === '/admin/manee-test' || p.startsWith('/admin/manee-test/')) return 'manee'
  if (p === '/admin/accounting' || p.startsWith('/admin/accounting/')) return 'accounting'
  if (p === '/admin/settings' || p.startsWith('/admin/settings/')) return 'settings'
  return 'orders'
}
const any = (perms, can) => perms.some((p) => can(p))
export const visibleItems = (sys, can) => sys.items.filter((i) => any(i.perms, can))
// ระบบที่เห็น: ระบบออร์เดอร์ดูจากเมนูย่อย ระบบอื่นดูจากสิทธิ์ของระบบ
export const visibleSystems = (can) => SYSTEMS.filter((s) => !s.hidden && (s.key === 'orders' ? visibleItems(s, can).length > 0 : any(s.perms, can)))
export const systemByKey = (key) => SYSTEMS.find((s) => s.key === key) || null
// หน้าแรกของระบบ: ระบบออร์เดอร์ใช้เมนูย่อยแรกที่มีสิทธิ์
export function homeOf(sys, can) {
  if (sys.key === 'orders') return visibleItems(sys, can)[0]?.to || sys.home
  return sys.home
}
export const firstHome = (can) => {
  const s = visibleSystems(can)[0]
  return s ? homeOf(s, can) : '/admin/no-access'
}
