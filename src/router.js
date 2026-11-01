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
import Materials from './views/Materials.vue'

// meta.focus = หน้าที่มีแถบปุ่มของตัวเอง ซ่อนแถบเมนูล่างบนมือถือ
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: OrderList },
    { path: '/orders/new', component: OrderCreate, meta: { focus: true } },
    { path: '/orders/:id', component: OrderDetail, props: true, meta: { focus: true } },
    { path: '/materials', component: Materials },
    { path: '/manage', component: ManageHome },
    { path: '/manage/customers', component: ManageCustomers },
    { path: '/manage/products', component: ManageProducts },
    { path: '/manage/options', component: ManageOptions },
    { path: '/manage/options/:id', component: ManageOptionGroup, props: true },
    { path: '/manage/users', component: ManageUsers },
    { path: '/manage/ingredients', component: ManageIngredients },
    { path: '/manage/pricing', component: ManagePriceLists },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
