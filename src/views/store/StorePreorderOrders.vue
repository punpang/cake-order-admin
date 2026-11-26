<script setup>
// สั่งล่วงหน้า: ออร์เดอร์ของฉัน (เห็นเฉพาะออร์เดอร์ของเซสชันสั่งล่วงหน้าที่ยืนยันแล้ว)
// แสดงเลขพัสดุ ยอดคงค้าง (ชำระส่วนต่างด้วย QR) และผลการตัดสินของร้าน · ลูกค้าไม่มีปุ่มขอคืนในหน้านี้
import { onMounted, ref } from 'vue'
import { callPreorder, readPreorderToken } from '../../lib/preorderRemote'

const orders = ref([])
const loading = ref(true)
const error = ref('')
const needLogin = ref(false)
const msg = ref('')
const qrOf = ref({}) // orderId → { payload, dataUrl, amount }

const STATUS = {
  awaiting_payment: 'รอชำระมัดจำ',
  payment_confirmed: 'ชำระมัดจำแล้ว',
  shipped: 'ส่งพัสดุแล้ว',
  delivered: 'ได้รับสินค้าแล้ว',
  returned: 'พัสดุตีกลับ/รับคืนแล้ว',
  expired: 'หมดเวลาชำระ',
  cancelled: 'ยกเลิกแล้ว',
}
const DECISION = { refund: 'คืนเงินแล้ว (ค่าส่งเดิมถูกริบ)', reship: 'กำลังจัดส่งใหม่ (ค่าส่งเดิมถูกริบ)' }

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

// ชำระส่วนต่างด้วยคำขอ QR ของเซิร์ฟเวอร์ (ยอดและรหัสฝั่งเซิร์ฟเวอร์เท่านั้น)
async function payBalance(o) {
  msg.value = ''
  const r = await callPreorder('qr_request', { orderId: o.id, amount: o.balanceDue })
  if (r.error) { msg.value = r.error; return }
  let dataUrl = ''
  try {
    const QR = await import('qrcode')
    dataUrl = await (QR.default || QR).toDataURL(r.payload, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
  } catch { dataUrl = '' }
  qrOf.value = { ...qrOf.value, [o.id]: { payload: r.payload, dataUrl, amount: r.amount } }
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
    <p v-else-if="error" class="mt-4 text-sm text-danger-700" role="alert">{{ error }}</p>
    <p v-else-if="!orders.length" class="mt-4 text-sm text-stone-500">ยังไม่มีออร์เดอร์สั่งล่วงหน้า</p>
    <p v-if="msg" class="mt-3 text-sm text-stone-700" role="status">{{ msg }}</p>
    <ul v-if="!loading && !needLogin && orders.length" class="mt-4 space-y-3">
      <li v-for="o in orders" :key="o.id" class="card p-4 text-sm" data-order>
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-stone-900">{{ o.code }}</span>
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{{ STATUS[o.status] || o.status }}</span>
        </div>
        <div class="mt-1 text-stone-600">รับสินค้า {{ o.pickupDate }} · ยอดรวม {{ o.total ?? '-' }} บาท · ชำระแล้ว {{ o.paid }} บาท</div>
        <div v-if="o.deposit" class="text-stone-600">มัดจำ {{ o.deposit.amount }} บาท ({{ o.deposit.percent }}%)</div>
        <div v-if="o.payDueAt && o.status === 'awaiting_payment'" class="text-xs text-stone-500">กำหนดชำระ {{ new Date(o.payDueAt).toLocaleString('th-TH') }}</div>

        <div v-if="o.shipping" class="mt-2 rounded-lg bg-stone-50 p-2" data-shipping>
          จัดส่งทาง {{ o.shipping.carrier }} · เลขพัสดุ <span class="font-mono">{{ o.shipping.trackingNo }}</span>
        </div>

        <div v-if="o.balanceDue > 0 && (o.status === 'payment_confirmed' || o.status === 'returned')" class="mt-2 space-y-2" data-balance>
          <p>ยอดที่ต้องชำระเพิ่ม {{ o.balanceDue }} บาท</p>
          <button type="button" class="btn-primary h-11 w-full" @click="payBalance(o)">ชำระด้วย QR</button>
          <div v-if="qrOf[o.id]" class="text-center" data-qr>
            <img v-if="qrOf[o.id].dataUrl" :src="qrOf[o.id].dataUrl" alt="QR พร้อมเพย์" class="mx-auto h-60 w-60" />
            <p class="text-xs text-stone-500">ยอด {{ qrOf[o.id].amount }} บาท</p>
          </div>
        </div>

        <div v-if="o.returnDecision?.decision" class="mt-2 text-stone-700">{{ DECISION[o.returnDecision.decision] }}</div>
      </li>
    </ul>
  </section>
</template>
