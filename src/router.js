import { createRouter, createWebHashHistory } from 'vue-router'
import OrderList from './views/OrderList.vue'
import OrderCreate from './views/OrderCreate.vue'
import OrderDetail from './views/OrderDetail.vue'
import ManageHome from './views/manage/ManageHome.vue'
import ManageCustomers from './views/manage/ManageCustomers.vue'
import ManageProducts from './views/manage/ManageProducts.vue'
import ManageOptions from './views/manage/ManageOptions.vue'
import ManageOptionGroup from './views/manage/ManageOptionGroup.vue'
import ManageUsers from './views/manage/ManageUsers.vue'
import ManageIngredients from './views/manage/ManageIngredients.vue'
import ManagePriceLists from './views/manage/ManagePriceLists.vue'
import ManageLoyalty from './views/manage/ManageLoyalty.vue'
import ManageProfit from './views/manage/ManageProfit.vue'
import ManageShop from './views/manage/ManageShop.vue'
import Member from './views/Member.vue'
import Materials from './views/Materials.vue'
import Production from './views/Production.vue'
import ManageBirthdays from './views/manage/ManageBirthdays.vue'
import ManageIntegrations from './views/manage/ManageIntegrations.vue'
import Chat from './views/Chat.vue'
import Pos from './views/Pos.vue'
import ManageRetail from './views/manage/ManageRetail.vue'

// meta.focus = หน้าที่มีแถบปุ่มของตัวเอง ซ่อนแถบเมนูล่างบนมือถือ
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: OrderList },
    { path: '/orders/new', component: OrderCreate, meta: { focus: true } },
    { path: '/orders/:id', component: OrderDetail, props: true, meta: { focus: true } },
    { path: '/chat', component: Chat },
    { path: '/chat/:id', component: Chat, props: true, meta: { focus: true } },
    { path: '/pos', component: Pos, meta: { focus: true } },
    { path: '/materials', component: Materials },
    { path: '/production', component: Production },
    { path: '/manage', component: ManageHome },
    { path: '/manage/customers', component: ManageCustomers },
    { path: '/manage/products', component: ManageProducts },
    { path: '/manage/options', component: ManageOptions },
    { path: '/manage/options/:id', component: ManageOptionGroup, props: true },
    { path: '/manage/users', component: ManageUsers },
    { path: '/manage/ingredients', component: ManageIngredients },
    { path: '/manage/pricing', component: ManagePriceLists },
    { path: '/manage/loyalty', component: ManageLoyalty },
    { path: '/manage/profit', component: ManageProfit },
    { path: '/manage/shop', component: ManageShop },
    { path: '/manage/birthdays', component: ManageBirthdays },
    { path: '/manage/integrations', component: ManageIntegrations },
    { path: '/manage/retail', component: ManageRetail },
    // หน้าลูกค้า (จำลอง ยังไม่มีล็อกอินลูกค้า)
    { path: '/member', component: Member, meta: { member: true } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
