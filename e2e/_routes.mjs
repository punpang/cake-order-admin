// รายการ route แบบคงที่ของแอป (ตรงกับ src/router.js ที่ไม่ต้องใช้พารามิเตอร์) ใช้ร่วมกันโดยเทสต์ e2e หลายไฟล์
export const STATIC = [
  '/', '/account', '/account/consent', '/account/forgot', '/account/login', '/account/register',
  '/admin', '/admin/accounting', '/admin/chat', '/admin/dashboard', '/admin/login', '/admin/manee-test',
  '/admin/materials', '/admin/no-access', '/admin/orders', '/admin/orders/new', '/admin/payments',
  '/admin/pos', '/admin/pos/bills', '/admin/production', '/admin/qr', '/admin/settings',
  '/admin/settings/birthdays', '/admin/settings/bot', '/admin/settings/bundles', '/admin/settings/campaigns',
  '/admin/settings/customers', '/admin/settings/deletion-requests', '/admin/settings/errors', '/admin/settings/files', '/admin/settings/gallery',
  '/admin/settings/ingredients', '/admin/settings/integrations', '/admin/settings/legal', '/admin/settings/line-history',
  '/admin/settings/links', '/admin/settings/loyalty', '/admin/settings/lucky', '/admin/settings/options',
  '/admin/settings/photo-requests', '/admin/settings/pricing', '/admin/settings/products', '/admin/settings/profit',
  '/admin/settings/printing', '/admin/settings/promos', '/admin/settings/retail', '/admin/settings/retention', '/admin/settings/shop',
  '/admin/settings/sms', '/admin/settings/storefront', '/admin/settings/test', '/admin/settings/users',
  '/display', '/legal/privacy', '/legal/terms', '/legal/cookie', '/line', '/member', '/menu', '/menu/custom', '/menu/gallery',
  '/manage', '/pos', '/chat', '/orders',
]
