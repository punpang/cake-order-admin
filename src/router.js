import { createRouter, createWebHashHistory } from 'vue-router'
import { customerSession, needsConsent } from './data/store'
import OrderList from './views/OrderList.vue'
import OrderCreate from './views/OrderCreate.vue'
import OrderDetail from './views/OrderDetail.vue'
import ManageHome from './views/manage/ManageHome.vue'
import ManageCustomers from './views/manage/ManageCustomers.vue'
import ManagePromos from './views/manage/ManagePromos.vue'
import ManageOptions from './views/manage/ManageOptions.vue'
import ManageOptionGroup from './views/manage/ManageOptionGroup.vue'
import ManageUsers from './views/manage/ManageUsers.vue'
import ManageIngredients from './views/manage/ManageIngredients.vue'
import ManagePriceLists from './views/manage/ManagePriceLists.vue'
import ManageLoyalty from './views/manage/ManageLoyalty.vue'
import ManageProfit from './views/manage/ManageProfit.vue'
import ManageShop from './views/manage/ManageShop.vue'
import Materials from './views/Materials.vue'
import Production from './views/Production.vue'
import ManageBirthdays from './views/manage/ManageBirthdays.vue'
import ManageIntegrations from './views/manage/ManageIntegrations.vue'
import Chat from './views/Chat.vue'
import Pos from './views/Pos.vue'
import ManageRetail from './views/manage/ManageRetail.vue'
import ManageStorefront from './views/manage/ManageStorefront.vue'
import ManageDeletionRequests from './views/manage/ManageDeletionRequests.vue'
import StoreHome from './views/store/StoreHome.vue'
import StoreMenu from './views/store/StoreMenu.vue'
import StoreItem from './views/store/StoreItem.vue'
import AccountLogin from './views/account/AccountLogin.vue'
import AccountRegister from './views/account/AccountRegister.vue'
import AccountForgot from './views/account/AccountForgot.vue'
import Account from './views/account/Account.vue'
import AccountConsent from './views/account/AccountConsent.vue'
import LegalPage from './views/store/LegalPage.vue'
import ManageLegal from './views/manage/ManageLegal.vue'
import ManageLinks from './views/manage/ManageLinks.vue'
import OrderLink from './views/store/OrderLink.vue'
import ShortRedirect from './views/store/ShortRedirect.vue'

// meta.store = หน้าร้าน/ระบบลูกค้า (ใช้ StoreLayout) · meta.focus = หน้าหลังบ้านที่มีแถบปุ่มของตัวเอง ซ่อนแถบเมนูล่างบนมือถือ
const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    // ---------- หน้าร้าน (ทุกคนดูได้ ไม่ต้องล็อกอิน) ----------
    { path: '/', component: StoreHome, meta: { store: true } },
    { path: '/menu', component: StoreMenu, meta: { store: true } },
    { path: '/menu/:kind/:id', component: StoreItem, props: true, meta: { store: true } },
    // ---------- ระบบลูกค้า (จำลอง จนกว่าจะต่อ Supabase) ----------
    { path: '/account/login', component: AccountLogin, meta: { store: true } },
    { path: '/account/register', component: AccountRegister, meta: { store: true } },
    { path: '/account/forgot', component: AccountForgot, meta: { store: true } },
    { path: '/account/consent', component: AccountConsent, meta: { store: true, needLogin: true } },
    { path: '/account', component: Account, meta: { store: true, customer: true } },
    { path: '/legal/:kind(privacy|terms|cookie)', component: LegalPage, props: true, meta: { store: true } },
    { path: '/member', redirect: '/account' },
    { path: '/o/:token', component: OrderLink, meta: { store: true } },
    { path: '/s/:code', component: ShortRedirect, meta: { store: true } },
    // ---------- หลังบ้าน ----------
    { path: '/admin', redirect: '/admin/orders' },
    { path: '/admin/orders', component: OrderList },
    { path: '/admin/orders/new', component: OrderCreate, meta: { focus: true } },
    { path: '/admin/orders/:id', component: OrderDetail, props: true, meta: { focus: true } },
    { path: '/admin/chat', component: Chat },
    { path: '/admin/chat/:id', component: Chat, props: true, meta: { focus: true } },
    { path: '/admin/pos', component: Pos, meta: { focus: true } },
    { path: '/admin/materials', component: Materials },
    { path: '/admin/production', component: Production },
    { path: '/admin/manage', component: ManageHome },
    { path: '/admin/manage/customers', component: ManageCustomers },
    { path: '/admin/manage/promos', component: ManagePromos },
    { path: '/admin/manage/products', redirect: '/admin/manage/retail' },
    { path: '/admin/manage/options', component: ManageOptions },
    { path: '/admin/manage/options/:id', component: ManageOptionGroup, props: true },
    { path: '/admin/manage/users', component: ManageUsers },
    { path: '/admin/manage/ingredients', component: ManageIngredients },
    { path: '/admin/manage/pricing', component: ManagePriceLists },
    { path: '/admin/manage/loyalty', component: ManageLoyalty },
    { path: '/admin/manage/profit', component: ManageProfit },
    { path: '/admin/manage/shop', component: ManageShop },
    { path: '/admin/manage/birthdays', component: ManageBirthdays },
    { path: '/admin/manage/integrations', component: ManageIntegrations },
    { path: '/admin/manage/retail', component: ManageRetail },
    { path: '/admin/manage/storefront', component: ManageStorefront },
    { path: '/admin/manage/deletion-requests', component: ManageDeletionRequests },
    { path: '/admin/manage/legal', component: ManageLegal },
    { path: '/admin/manage/links', component: ManageLinks },
    // ลิงก์หลังบ้านเดิม (ก่อนย้ายไป /admin)
    { path: '/:old(orders|manage|chat|pos|materials|production)/:rest(.*)*', redirect: (to) => `/admin${to.fullPath}` },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

// หน้าบัญชีลูกค้าต้องล็อกอินก่อน (จำลอง: รีเฟรชหน้าแล้วต้องเข้าสู่ระบบใหม่)
// เอกสารเวอร์ชันใหม่ที่ยังไม่ยอมรับ → ไปหน้ายอมรับก่อน
router.beforeEach((to) => {
  if ((to.meta.customer || to.meta.needLogin) && !customerSession.customerId) return '/account/login'
  if (to.meta.customer && needsConsent().length) return '/account/consent'
})

export default router
