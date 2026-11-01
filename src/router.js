import { createRouter, createWebHashHistory } from 'vue-router'
import OrderList from './views/OrderList.vue'
import OrderCreate from './views/OrderCreate.vue'
import OrderDetail from './views/OrderDetail.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/orders' },
    { path: '/orders', component: OrderList },
    { path: '/orders/new', component: OrderCreate },
    { path: '/orders/:id', component: OrderDetail, props: true },
  ],
  scrollBehavior: () => ({ top: 0 }),
})
