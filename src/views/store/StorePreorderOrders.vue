<script setup>
// สั่งล่วงหน้า: ออร์เดอร์ของฉัน (เห็นเฉพาะออร์เดอร์ของเซสชันสั่งล่วงหน้าที่ยืนยันเบอร์แล้ว)
// การชำระมัดจำอยู่ในเฟสถัดไป · ไม่มีปุ่มจ่ายในหน้านี้
import { onMounted, ref } from 'vue'
import { callPreorder, readPreorderToken } from '../../lib/preorderRemote'

const orders = ref([])
const loading = ref(true)
const error = ref('')
const needLogin = ref(false)

const STATUS = { awaiting_payment: 'รอชำระมัดจำ', payment_confirmed: 'ชำระมัดจำแล้ว', preparing: 'กำลังเตรียม', prepared: 'เตรียมเสร็จแล้ว', delivered: 'รับแล้ว', cancelled: 'ยกเลิกแล้ว' }

async function load() {
  loading.value = true
  error.value = ''
  if (!readPreorderToken()) { needLogin.value = true; loading.value = false; return }
  const r = await callPreorder('state')
  loading.value = false
  if (r.status === 401 || r.error === 'กรุณายืนยันเบอร์ใหม่') { needLogin.value = true; return }
  if (r.error) { error.value = r.error; return }
  orders.value = r.orders || []
}

onMounted(load)
</script>

<template>
  <section class="mx-auto max-w-2xl px-4 py-6">
    <h1 class="text-xl font-semibold text-stone-900">ออร์เดอร์ของฉัน</h1>
    <p v-if="loading" class="mt-4 text-sm text-stone-500">กำลังโหลด…</p>
    <div v-else-if="needLogin" class="mt-4 card p-4 text-sm">
      <p>กรุณายืนยันเบอร์ก่อนดูออร์เดอร์ของคุณ</p>
      <router-link to="/preorder" class="btn-primary mt-3 inline-flex h-11 items-center px-4">ไปยืนยันเบอร์</router-link>
    </div>
    <p v-else-if="error" class="mt-4 text-sm text-rose-700" role="alert">{{ error }}</p>
    <p v-else-if="!orders.length" class="mt-4 text-sm text-stone-500">ยังไม่มีออร์เดอร์สั่งล่วงหน้า</p>
    <ul v-else class="mt-4 space-y-3">
      <li v-for="o in orders" :key="o.id" class="card p-4 text-sm" data-order>
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-stone-900">{{ o.code }}</span>
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{{ STATUS[o.status] || o.status }}</span>
        </div>
        <div class="mt-1 text-stone-600">รับสินค้า {{ o.pickupDate }} · ยอดรวม {{ o.total ?? '-' }} บาท</div>
        <div v-if="o.deposit" class="text-stone-600">มัดจำ {{ o.deposit.amount }} บาท ({{ o.deposit.percent }}%)</div>
        <div v-if="o.payDueAt" class="text-xs text-stone-500">กำหนดชำระ {{ new Date(o.payDueAt).toLocaleString('th-TH') }}</div>
      </li>
    </ul>
  </section>
</template>
