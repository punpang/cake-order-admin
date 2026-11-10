import { createRouter, createWebHashHistory } from 'vue-router'
import { customerSession, needsConsent, canAny, can } from './data/store'
import { firstHome } from './lib/adminSystems'
import StoreHome from './views/store/StoreHome.vue'
import StoreMenu from './views/store/StoreMenu.vue'
import StoreCakeGallery from './views/store/StoreCakeGallery.vue'
import StoreItem from './views/store/StoreItem.vue'
import AccountLogin from './views/account/AccountLogin.vue'
import AccountRegister from './views/account/AccountRegister.vue'
import AccountForgot from './views/account/AccountForgot.vue'
import Account from './views/account/Account.vue'
import AccountConsent from './views/account/AccountConsent.vue'
import AccountOrder from './views/account/AccountOrder.vue'
import NoAccess from './views/NoAccess.vue'
import { supabaseEnabled } from './lib/supabase'
import { staffState, ensureData } from './lib/staffAuth'
import { whenSessionReady } from './lib/dataStatus'
import LegalPage from './views/store/LegalPage.vue'
import StoreCakeDesign from './views/store/StoreCakeDesign.vue'
import OrderLink from './views/store/OrderLink.vue'
import ShortRedirect from './views/store/ShortRedirect.vue'

// หน้าหลังบ้าน: โหลดเมื่อเข้าใช้งานเท่านั้น (ลูกค้าหน้าร้านไม่ต้องดาวน์โหลดโค้ดหลังบ้าน)
const OrderList = () => import('./views/OrderList.vue')
const OrderCreate = () => import('./views/OrderCreate.vue')
const OrderDetail = () => import('./views/OrderDetail.vue')
const Payments = () => import('./views/Payments.vue')
const ManageHome = () => import('./views/manage/ManageHome.vue')
const ManageCustomers = () => import('./views/manage/ManageCustomers.vue')
const ManagePromos = () => import('./views/manage/ManagePromos.vue')
const ManageOptions = () => import('./views/manage/ManageOptions.vue')
const ManageOptionGroup = () => import('./views/manage/ManageOptionGroup.vue')
const ManageUsers = () => import('./views/manage/ManageUsers.vue')
const ManageIngredients = () => import('./views/manage/ManageIngredients.vue')
const ManagePriceLists = () => import('./views/manage/ManagePriceLists.vue')
const ManageLoyalty = () => import('./views/manage/ManageLoyalty.vue')
const ManageProfit = () => import('./views/manage/ManageProfit.vue')
const ManageShop = () => import('./views/manage/ManageShop.vue')
const Materials = () => import('./views/Materials.vue')
const Production = () => import('./views/Production.vue')
const ManageBirthdays = () => import('./views/manage/ManageBirthdays.vue')
const ManageIntegrations = () => import('./views/manage/ManageIntegrations.vue')
const Chat = () => import('./views/Chat.vue')
const Pos = () => import('./views/Pos.vue')
const ManageRetail = () => import('./views/manage/ManageRetail.vue')
const ManageStorefront = () => import('./views/manage/ManageStorefront.vue')
const ManageDeletionRequests = () => import('./views/manage/ManageDeletionRequests.vue')
const StaffLogin = () => import('./views/StaffLogin.vue')
const Accounting = () => import('./views/accounting/Accounting.vue')
const ManageLegal = () => import('./views/manage/ManageLegal.vue')
const ManageLinks = () => import('./views/manage/ManageLinks.vue')
const ManageGallery = () => import('./views/manage/ManageGallery.vue')
const ManagePhotoRequests = () => import('./views/manage/ManagePhotoRequests.vue')
const ManageBot = () => import('./views/manage/ManageBot.vue')

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
    // ---------- ระบบลูกค้า (จำลอง จนกว่าจะต่อ Supabase) ----------
    { path: '/account/login', component: AccountLogin, meta: { store: true } },
    { path: '/account/register', component: AccountRegister, meta: { store: true } },
    { path: '/account/forgot', component: AccountForgot, meta: { store: true } },
    { path: '/account/consent', component: AccountConsent, meta: { store: true, needLogin: true } },
    { path: '/account/orders/:id', component: AccountOrder, meta: { store: true, customer: true } },
    { path: '/account', component: Account, meta: { store: true, customer: true } },
    { path: '/legal/:kind(privacy|terms|cookie)', component: LegalPage, props: true, meta: { store: true } },
    { path: '/member', redirect: '/account' },
    { path: '/o/:token', component: OrderLink, meta: { store: true } },
    { path: '/s/:code', component: ShortRedirect, meta: { store: true } },
    // ---------- หลังบ้าน ----------
    { path: '/admin', redirect: () => firstHome(can) },
    // ลิงก์ตั้งค่าเดิม (/admin/manage*) → /admin/settings*
    { path: '/admin/manage/:rest(.*)*', redirect: (to) => to.fullPath.replace('/admin/manage', '/admin/settings') },
    { path: '/admin/login', component: StaffLogin, meta: { bare: true } },
    { path: '/admin/no-access', component: NoAccess },
    { path: '/admin/accounting', component: Accounting, meta: { perms: ['acctView'], data: ['ordersAll'] } },
    { path: '/admin/orders', component: OrderList, meta: { perms: ['viewAllOrders', 'viewPrepOrders', 'viewDeliveryOrders'] } },
    { path: '/admin/orders/new', component: OrderCreate, meta: { focus: true, perms: ['createOrder'], data: ['chats'] } },
    { path: '/admin/orders/:id', component: OrderDetail, props: true, meta: { focus: true, data: ['chats'] } },
    { path: '/admin/payments', component: Payments, meta: { perms: ['reportPayment', 'confirmPayment'], data: ['ordersAll'] } },
    { path: '/admin/chat', component: Chat, meta: { perms: ['chat'], lock: true, data: ['chats'] } },
    { path: '/admin/chat/:id', component: Chat, props: true, meta: { focus: true, perms: ['chat'], lock: true, data: ['chats'] } },
    { path: '/admin/pos', component: Pos, meta: { focus: true, perms: ['pos'], data: ['shifts'] } },
    { path: '/admin/materials', component: Materials, meta: { perms: ['viewMaterials'] } },
    { path: '/admin/production', component: Production, meta: { perms: ['viewMaterials'] } },
    { path: '/admin/settings', component: ManageHome, meta: { data: ['users'] } },
    { path: '/admin/settings/customers', component: ManageCustomers, meta: { data: ['ordersAll'] } },
    { path: '/admin/settings/promos', component: ManagePromos },
    { path: '/admin/settings/products', redirect: '/admin/settings/retail' },
    { path: '/admin/settings/options', component: ManageOptions },
    { path: '/admin/settings/options/:id', component: ManageOptionGroup, props: true },
    { path: '/admin/settings/users', component: ManageUsers, meta: { data: ['users'] } },
    { path: '/admin/settings/ingredients', component: ManageIngredients },
    { path: '/admin/settings/pricing', component: ManagePriceLists },
    { path: '/admin/settings/loyalty', component: ManageLoyalty },
    { path: '/admin/settings/profit', component: ManageProfit, meta: { data: ['ordersAll'] } },
    { path: '/admin/settings/shop', component: ManageShop },
    { path: '/admin/settings/birthdays', component: ManageBirthdays, meta: { data: ['ordersAll'] } },
    { path: '/admin/settings/integrations', component: ManageIntegrations },
    { path: '/admin/settings/retail', component: ManageRetail },
    { path: '/admin/settings/storefront', component: ManageStorefront },
    { path: '/admin/settings/gallery', component: ManageGallery },
    { path: '/admin/settings/photo-requests', component: ManagePhotoRequests },
    { path: '/admin/settings/deletion-requests', component: ManageDeletionRequests },
    { path: '/admin/settings/legal', component: ManageLegal },
    { path: '/admin/settings/links', component: ManageLinks },
    { path: '/admin/settings/bot', component: ManageBot },
    // ลิงก์หลังบ้านเดิม (ก่อนย้ายไป /admin)
    { path: '/:old(orders|manage|chat|pos|materials|production)/:rest(.*)*', redirect: (to) => `/admin${to.fullPath}` },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// หน้าบัญชีลูกค้าต้องล็อกอินก่อน (จำลอง: รีเฟรชหน้าแล้วต้องเข้าสู่ระบบใหม่)
// เอกสารเวอร์ชันใหม่ที่ยังไม่ยอมรับ → ไปหน้ายอมรับก่อน
router.beforeEach(async (to) => {
  // โหมด Supabase: หลังบ้านต้องล็อกอินพนักงานก่อน
  if (supabaseEnabled && to.path.startsWith('/admin') && to.path !== '/admin/login' && !staffState.staff) return '/admin/login'
  // หลังบ้าน: ต้องมีสิทธิ์อย่างน้อยหนึ่งข้อของหน้านั้น (หน้าจัดการ /admin/settings* ตรวจต่อใน ManageShell)
  if (to.meta.perms && !canAny(to.meta.perms)) return '/admin/no-access'
  // เซสชันลูกค้าที่ค้างไว้กำลังกู้คืน → รอก่อนตัดสินใจว่าต้องล็อกอินหรือไม่
  if (to.meta.customer || to.meta.needLogin) await whenSessionReady()
  if ((to.meta.customer || to.meta.needLogin) && !customerSession.customerId) return '/account/login'
  if (to.meta.customer && needsConsent().length) return '/account/consent'
  // กลุ่มข้อมูลของหน้า (โหลดครั้งแรกเมื่อเข้าหน้า แล้วคงไว้)
  if (to.meta.data && supabaseEnabled && staffState.staff) await ensureData(to.meta.data)
})

export default router
