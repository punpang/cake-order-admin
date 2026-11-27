import { createRouter, createWebHashHistory } from 'vue-router'
import { customerSession, needsConsent, canAny, can } from './data/store'
import { firstHome, APP_MODE, allowedInApp } from './lib/adminSystems'
import { trackPageView } from './lib/pageViews'
import NoAccess from './views/NoAccess.vue'
// หน้าร้าน/บัญชีลูกค้า: โหลดเมื่อเปิดหน้านั้นเท่านั้น (ลดขนาดชุดโค้ดเริ่มต้น)
const StoreHome = () => import('./views/store/StoreHome.vue')
const StoreMenu = () => import('./views/store/StoreMenu.vue')
const StoreCakeGallery = () => import('./views/store/StoreCakeGallery.vue')
const StoreItem = () => import('./views/store/StoreItem.vue')
const StorePreorder = () => import('./views/store/StorePreorder.vue')
const StorePreorderOrders = () => import('./views/store/StorePreorderOrders.vue')
const AccountLogin = () => import('./views/account/AccountLogin.vue')
const AccountRegister = () => import('./views/account/AccountRegister.vue')
const AccountForgot = () => import('./views/account/AccountForgot.vue')
const Account = () => import('./views/account/Account.vue')
const AccountConsent = () => import('./views/account/AccountConsent.vue')
const AccountOrder = () => import('./views/account/AccountOrder.vue')
import { supabaseEnabled } from './lib/supabase'
import { staffState, ensureData } from './lib/staffAuth'
import { whenSessionReady } from './lib/dataStatus'
const LegalPage = () => import('./views/store/LegalPage.vue')
const StoreCakeDesign = () => import('./views/store/StoreCakeDesign.vue')
const OrderLink = () => import('./views/store/OrderLink.vue')
const LuckyPage = () => import('./views/store/LuckyPage.vue')
const ShortRedirect = () => import('./views/store/ShortRedirect.vue')

// หน้าหลังบ้าน: โหลดเมื่อเข้าใช้งานเท่านั้น (ลูกค้าหน้าร้านไม่ต้องดาวน์โหลดโค้ดหลังบ้าน)
const OrderList = () => import('./views/OrderList.vue')
const OrderCreate = () => import('./views/OrderCreate.vue')
const OrderDetail = () => import('./views/OrderDetail.vue')
const Payments = () => import('./views/Payments.vue')
const PayQr = () => import('./views/PayQr.vue')
const ManageHome = () => import('./views/manage/ManageHome.vue')
const ManageCustomers = () => import('./views/manage/ManageCustomers.vue')
const ManagePromos = () => import('./views/manage/ManagePromos.vue')
const ManageOptions = () => import('./views/manage/ManageOptions.vue')
const ManageOptionGroup = () => import('./views/manage/ManageOptionGroup.vue')
const ManageBundles = () => import('./views/manage/ManageBundles.vue')
const ManageBundleGrid = () => import('./views/manage/ManageBundleGrid.vue')
const ManageBundleEdit = () => import('./views/manage/ManageBundleEdit.vue')
const ManageUsers = () => import('./views/manage/ManageUsers.vue')
const ManageIngredients = () => import('./views/manage/ManageIngredients.vue')
const ManagePriceLists = () => import('./views/manage/ManagePriceLists.vue')
const ManageLoyalty = () => import('./views/manage/ManageLoyalty.vue')
const ManageProfit = () => import('./views/manage/ManageProfit.vue')
const ManageShop = () => import('./views/manage/ManageShop.vue')
const ManageLucky = () => import('./views/manage/ManageLucky.vue')
const Materials = () => import('./views/Materials.vue')
const Production = () => import('./views/Production.vue')
const ManageBirthdays = () => import('./views/manage/ManageBirthdays.vue')
const ManageIntegrations = () => import('./views/manage/ManageIntegrations.vue')
const Chat = () => import('./views/Chat.vue')
const Pos = () => import('./views/Pos.vue')
const PosBills = () => import('./views/PosBills.vue')
const ManageRetail = () => import('./views/manage/ManageRetail.vue')
const ManageStorefront = () => import('./views/manage/ManageStorefront.vue')
const ManageDeletionRequests = () => import('./views/manage/ManageDeletionRequests.vue')
const StaffLogin = () => import('./views/StaffLogin.vue')
const Accounting = () => import('./views/accounting/Accounting.vue')
const ManageLegal = () => import('./views/manage/ManageLegal.vue')
const ManagePrinting = () => import('./views/manage/ManagePrinting.vue')
const ManageLinks = () => import('./views/manage/ManageLinks.vue')
const ManagePreorders = () => import('./views/manage/ManagePreorders.vue')
const ManageRetention = () => import('./views/manage/ManageRetention.vue')
const ManageGallery = () => import('./views/manage/ManageGallery.vue')
const ManagePhotoRequests = () => import('./views/manage/ManagePhotoRequests.vue')
const ManageErrors = () => import('./views/manage/ManageErrors.vue')
const ManageSyncReview = () => import('./views/manage/ManageSyncReview.vue')
const ManageFiles = () => import('./views/manage/ManageFiles.vue')
const ManageBot = () => import('./views/manage/ManageBot.vue')
const LineLink = () => import('./views/LineLink.vue')
const ManageSms = () => import('./views/manage/ManageSms.vue')
const ManeeTest = () => import('./views/ManeeTest.vue')
const CustomerDisplay = () => import('./views/CustomerDisplay.vue')

// meta.store = หน้าร้าน/ระบบลูกค้า (ใช้ StoreLayout) · meta.focus = หน้าหลังบ้านที่มีแถบปุ่มของตัวเอง ซ่อนแถบเมนูล่างบนมือถือ
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // ---------- หน้าร้าน (ทุกคนดูได้ ไม่ต้องล็อกอิน) ----------
    { path: '/', component: StoreHome, meta: { store: true, pub: true } },
    { path: '/menu', component: StoreMenu, meta: { store: true, pub: true } },
    { path: '/menu/gallery', component: StoreCakeGallery, meta: { store: true, pub: true } },
    { path: '/menu/design/:id', component: StoreCakeDesign, props: true, meta: { store: true, pub: true } },
    { path: '/menu/custom', component: StoreItem, props: { kind: 'custom', id: '' }, meta: { store: true, pub: true } },
    { path: '/menu/:kind/:id', component: StoreItem, props: true, meta: { store: true, pub: true } },
    { path: '/preorder', component: StorePreorder, meta: { store: true, pub: true } },
    { path: '/preorder/orders', component: StorePreorderOrders, meta: { store: true, pub: true } },
    // ---------- ระบบลูกค้า (จำลอง จนกว่าจะต่อ Supabase) ----------
    { path: '/account/login', component: AccountLogin, meta: { store: true } },
    { path: '/account/register', component: AccountRegister, meta: { store: true } },
    { path: '/account/forgot', component: AccountForgot, meta: { store: true } },
    { path: '/account/consent', component: AccountConsent, meta: { store: true, needLogin: true } },
    { path: '/account/orders/:id', component: AccountOrder, meta: { store: true, customer: true } },
    { path: '/line', component: LineLink, meta: { store: true, pub: true } },
    { path: '/account', component: Account, meta: { store: true, customer: true } },
    { path: '/legal/:kind(privacy|terms|cookie)', component: LegalPage, props: true, meta: { store: true } },
    { path: '/member', redirect: '/account' },
    { path: '/o/:token', component: OrderLink, meta: { store: true } },
    { path: '/luck/:token', component: LuckyPage, props: true, meta: { store: true } },
    { path: '/s/:code', component: ShortRedirect, meta: { store: true } },
    // ---------- หลังบ้าน ----------
    { path: '/admin', redirect: () => firstHome(can) },
    // ลิงก์ตั้งค่าเดิม (/admin/manage*) → /admin/settings*
    { path: '/admin/manage/:rest(.*)*', redirect: (to) => to.fullPath.replace('/admin/manage', '/admin/settings') },
    { path: '/admin/login', component: StaffLogin, meta: { bare: true } },
    { path: '/admin/no-access', component: NoAccess },
    { path: '/admin/accounting', component: Accounting, meta: { perms: ['acctView'], data: ['ordersAcct'] } },
    { path: '/admin/orders', component: OrderList, meta: { perms: ['viewAllOrders', 'viewPrepOrders', 'viewDeliveryOrders'] } },
    { path: '/admin/preorders', component: ManagePreorders, meta: { perms: ['managePreorder'], data: ['preorders'] } },
    { path: '/admin/orders/new', component: OrderCreate, meta: { focus: true, perms: ['createOrder'], data: ['chats'] } },
    { path: '/admin/orders/:id', component: OrderDetail, props: true, meta: { focus: true, data: ['chats'] } },
    { path: '/admin/payments', component: Payments, meta: { perms: ['reportPayment', 'confirmPayment'] } },
    { path: '/admin/qr', component: PayQr, meta: { perms: ['reportPayment'] } },
    { path: '/admin/chat', component: Chat, meta: { perms: ['chat'], lock: true, data: ['chats'] } },
    { path: '/admin/chat/:id', component: Chat, props: true, meta: { focus: true, perms: ['chat'], lock: true, data: ['chats'] } },
    { path: '/admin/pos', component: Pos, meta: { focus: true, lock: true, perms: ['pos'], data: ['shifts'] } },
    { path: '/admin/pos/bills', component: PosBills, meta: { focus: true, perms: ['pos'] } },
    { path: '/admin/manee-test', component: ManeeTest, meta: { perms: ['pos'] } },
    { path: '/admin/materials', component: Materials, meta: { perms: ['viewMaterials'] } },
    { path: '/admin/production', component: Production, meta: { perms: ['viewMaterials'] } },
    { path: '/admin/dashboard', component: () => import('./views/manage/ManageDashboard.vue'), meta: { perms: ['viewAllOrders'], data: ['chats', 'retailStats'] } },
    { path: '/admin/settings', component: ManageHome, meta: { data: ['users'] } },
    { path: '/admin/settings/customers', component: ManageCustomers },
    { path: '/admin/settings/promos', component: ManagePromos },
    { path: '/admin/settings/campaigns', component: () => import('./views/manage/ManageCampaigns.vue'), meta: { perms: ['manage'] } },
    { path: '/admin/settings/products', redirect: '/admin/settings/retail' },
    { path: '/admin/settings/options', component: ManageOptions },
    { path: '/admin/settings/options/:id', component: ManageOptionGroup, props: true },
    { path: '/admin/settings/bundles', component: ManageBundles },
    { path: '/admin/settings/bundles/grid', component: ManageBundleGrid },
    { path: '/admin/settings/bundles/:id', component: ManageBundleEdit, props: true },
    { path: '/admin/settings/users', component: ManageUsers, meta: { data: ['users'] } },
    { path: '/admin/settings/ingredients', component: ManageIngredients },
    { path: '/admin/settings/pricing', component: ManagePriceLists },
    { path: '/admin/settings/loyalty', component: ManageLoyalty, meta: { data: ['rec:coupons'] } },
    { path: '/admin/settings/profit', component: ManageProfit },
    { path: '/admin/settings/shop', component: ManageShop },
    { path: '/admin/settings/lucky', component: ManageLucky },
    { path: '/admin/settings/printing', component: ManagePrinting },
    { path: '/admin/settings/line-history', component: () => import('./views/manage/ManageLineHistory.vue'), meta: { perms: ['chat'] } },
    { path: '/admin/settings/birthdays', component: ManageBirthdays },
    { path: '/admin/settings/integrations', component: ManageIntegrations },
    { path: '/admin/settings/retail', component: ManageRetail },
    { path: '/admin/settings/storefront', component: ManageStorefront, meta: { data: ['retailStats', 'rec:reviews'] } },
    { path: '/admin/settings/gallery', component: ManageGallery },
    { path: '/admin/settings/photo-requests', component: ManagePhotoRequests, meta: { data: ['rec:photoRequests'] } },
    { path: '/admin/settings/files', component: ManageFiles },
    { path: '/admin/settings/deletion-requests', component: ManageDeletionRequests, meta: { data: ['rec:deletionRequests'] } },
    { path: '/admin/settings/legal', component: ManageLegal, meta: { data: ['rec:consents'] } },
    { path: '/admin/settings/links', component: ManageLinks },
    { path: '/admin/settings/preorders', redirect: '/admin/preorders' },
    { path: '/admin/settings/bot', component: ManageBot },
    { path: '/admin/settings/retention', component: ManageRetention },
    { path: '/admin/settings/errors', component: ManageErrors, meta: { data: ['users'] } },
    { path: '/admin/settings/sync-review', component: ManageSyncReview, meta: { data: ['users'], perms: ['manage'] } },
    { path: '/admin/settings/sms', component: ManageSms },
    // ลิงก์หลังบ้านเดิม (ก่อนย้ายไป /admin)
    { path: '/:old(orders|manage|chat|pos|materials|production)/:rest(.*)*', redirect: (to) => `/admin${to.fullPath}` },
    // จอลูกค้า (แอป Android ส่งสถานะเข้ามา) · ไม่มีเมนูหรือข้อมูลส่วนตัวในหน้านี้
    { path: '/display', component: CustomerDisplay, meta: { bare: true, display: true } },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// หน้าบัญชีลูกค้าต้องล็อกอินก่อน (จำลอง: รีเฟรชหน้าแล้วต้องเข้าสู่ระบบใหม่)
// เอกสารเวอร์ชันใหม่ที่ยังไม่ยอมรับ → ไปหน้ายอมรับก่อน
router.beforeEach(async (to) => {
  // โหมด Supabase: หลังบ้านต้องล็อกอินพนักงานก่อน
  // vue-router จับคู่เส้นทางโดยไม่สนตัวพิมพ์ใหญ่/เล็ก (/ADMIN/... ก็เปิดหน้าหลังบ้าน) จึงเทียบแบบตัวพิมพ์เล็กและ trim / ท้าย
  const p = to.path.toLowerCase().replace(/\/+$/, '')
  // แอป Android: เปิดได้เฉพาะหลังบ้าน POS/ออร์เดอร์ ส่วนอื่นกลับไปหน้าแรกของแอป
  if (APP_MODE === 'android' && !allowedInApp(p)) return '/admin'
  // แอปลูกค้า: เปิดได้เฉพาะหน้าลูกค้า ส่วนอื่น (รวมหน้าแรกของร้าน) กลับไปที่บัญชีลูกค้า
  if (APP_MODE === 'customer' && !allowedInApp(p)) return '/account'
  if (supabaseEnabled && (p === '/admin' || p.startsWith('/admin/')) && p !== '/admin/login' && !staffState.staff) return '/admin/login'
  // หลังบ้าน: ต้องมีสิทธิ์อย่างน้อยหนึ่งข้อของหน้านั้น (หน้าจัดการ /admin/settings* ตรวจต่อใน ManageShell)
  if (to.meta.perms && !canAny(to.meta.perms)) return '/admin/no-access'
  // เซสชันลูกค้าที่ค้างไว้กำลังกู้คืน → รอก่อนตัดสินใจว่าต้องล็อกอินหรือไม่
  if (to.meta.customer || to.meta.needLogin) await whenSessionReady()
  if ((to.meta.customer || to.meta.needLogin) && !customerSession.customerId) return '/account/login'
  if (to.meta.customer && needsConsent().length) return '/account/consent'
  // กลุ่มข้อมูลของหน้า (โหลดครั้งแรกเมื่อเข้าหน้า แล้วคงไว้)
  if (to.meta.data && supabaseEnabled && staffState.staff) await ensureData(to.meta.data)
})

// นับการเข้าชมหน้าเว็บลูกค้า (หน้าร้านและบัญชีลูกค้า) · หลังบ้านไม่นับ
router.afterEach((to) => {
  if (to.meta?.store) trackPageView()
})

export default router
