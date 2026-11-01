import { createRouter, createWebHashHistory } from 'vue-router'
import OrderList from './views/OrderList.vue'
import OrderCreate from './views/OrderCreate.vue'
import OrderDetail from './views/OrderDetail.vue'

// meta.focus = หน้าที่มีแถบปุ่มของตัวเอง ซ่อนแถบเมนูล่างบนมือถือ
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: OrderList },
    { path: '/orders/new', component: OrderCreate, meta: { focus: true } },
    { path: '/orders/:id', component: OrderDetail, props: true, meta: { focus: true } },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
