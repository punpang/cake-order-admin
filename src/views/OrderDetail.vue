<script setup>
import { computed, reactive, ref } from 'vue'
import {
  can, findOrder, findCustomer, setStatus, reportPayment, confirmPayment, setAdjustment, cancelOrder, countPickups,
} from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, toDateStr, pad } from '../lib/format'
import { PAYMENT_METHODS, ROLES } from '../lib/constants'
import StatusBadge from '../components/StatusBadge.vue'
import ItemCard from '../components/ItemCard.vue'
import AppModal from '../components/AppModal.vue'

const props = defineProps({ id: { type: String, required: true } })
const order = computed(() => findOrder(props.id))
const customer = computed(() => order.value && findCustomer(order.value.customerId))
const t = computed(() => orderTotals(order.value))
const load = computed(() => countPickups(order.value.pickupAt, order.value.id))
const closed = computed(() => ['delivered', 'cancelled'].includes(order.value.status))

const canDeliver = computed(() =>
  order.value.fulfillment === 'delivery' ? can('deliverShipping') : can('deliverPickup'),
)

const hasActions = computed(() => {
  const s = order.value.status
  return (can('cancel') && !closed.value)
    || (s === 'draft' && can('sendToPayment'))
    || (s === 'payment_confirmed' && can('startPreparing'))
    || (s === 'preparing' && canDeliver.value)
})

const nowLocal = () => {
  const d = new Date()
  return `${toDateStr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ---------- แจ้งชำระ ----------
const payOpen = ref(false)
const pay = reactive({ amount: 0, method: PAYMENT_METHODS[0], paidAt: '', slip: '', note: '' })
const payError = ref('')
function openPay() {
  Object.assign(pay, { amount: Math.max(t.value.balance - t.value.reported, 0), method: PAYMENT_METHODS[0], paidAt: nowLocal(), slip: '', note: '' })
  payError.value = ''
  payOpen.value = true
}
function onSlip(e) {
  const f = e.target.files[0]
  if (f) pay.slip = URL.createObjectURL(f)
}
function savePay() {
  if (!(pay.amount > 0)) return (payError.value = 'กรอกยอดเงิน')
  reportPayment(order.value, pay)
  payOpen.value = false
}

// ---------- ปรับราคา ----------
const adjOpen = ref(false)
const adj = reactive({ amount: 0, reason: '' })
const adjError = ref('')
function openAdj() {
  Object.assign(adj, { amount: order.value.adjustment.amount, reason: order.value.adjustment.reason })
  adjError.value = ''
  adjOpen.value = true
}
function saveAdj() {
  if (!adj.reason.trim()) return (adjError.value = 'ใส่เหตุผล')
  setAdjustment(order.value, adj.amount, adj.reason.trim())
  adjOpen.value = false
}

// ---------- ยกเลิก ----------
const cancelOpen = ref(false)
const cxl = reactive({ reason: '', refundAmount: 0, refundMethod: PAYMENT_METHODS[0], refundNote: '' })
const cxlError = ref('')
function openCancel() {
  Object.assign(cxl, { reason: '', refundAmount: t.value.paid, refundMethod: PAYMENT_METHODS[0], refundNote: '' })
  cxlError.value = ''
  cancelOpen.value = true
}
function saveCancel() {
  if (!cxl.reason.trim()) return (cxlError.value = 'ใส่เหตุผลการยกเลิก')
  if (cxl.refundAmount < 0 || cxl.refundAmount > t.value.paid) return (cxlError.value = `คืนเงินได้ 0 – ${money(t.value.paid)}`)
  cancelOrder(order.value, cxl)
  cancelOpen.value = false
}
</script>

<template>
  <div v-if="!order" class="card text-center text-stone-500">
    ไม่พบออร์เดอร์ <RouterLink to="/orders" class="text-rose-600 underline">กลับ</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-5xl pb-24 lg:pb-0">
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/orders" class="rounded-lg px-2 py-1 text-xl hover:bg-stone-200">‹</RouterLink>
      <h1 class="text-xl font-semibold">{{ order.code }}</h1>
      <StatusBadge :status="order.status" />
    </div>

    <div class="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_340px]">
      <!-- ซ้าย -->
      <div class="space-y-4">
        <section class="card grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div class="text-sm text-stone-500">ลูกค้า</div>
            <div class="font-semibold">{{ customer?.name }}</div>
            <a v-if="customer?.phone" :href="`tel:${customer.phone}`" class="text-sm text-rose-600">{{ customer.phone }}</a>
            <span v-if="customer?.line" class="text-sm text-stone-500"> · LINE {{ customer.line }}</span>
            <div v-if="customer?.note" class="text-sm text-stone-500">{{ customer.note }}</div>
          </div>
          <div>
            <div class="text-sm text-stone-500">นัดรับ</div>
            <div class="font-semibold">{{ dateTime(order.pickupAt) }}</div>
            <div class="text-sm">{{ order.fulfillment === 'delivery' ? '🚚 จัดส่ง' : '🏪 รับที่ร้าน' }}</div>
            <div v-if="order.address" class="text-sm text-stone-600">{{ order.address }}</div>
            <div class="mt-1 text-xs text-stone-500">วันเดียวกันมีอีก {{ load.day }} ออร์เดอร์ · ชั่วโมงเดียวกัน {{ load.hour }}</div>
          </div>
        </section>

        <section class="card space-y-2">
          <h2 class="font-semibold">สินค้า</h2>
          <ItemCard v-for="it in order.items" :key="it.id" :item="it" />
        </section>

        <section v-if="order.cancel" class="card border-rose-200 bg-rose-50">
          <h2 class="font-semibold text-rose-700">ยกเลิกแล้ว</h2>
          <div class="text-sm">เหตุผล: {{ order.cancel.reason }}</div>
          <div class="text-sm">คืนเงิน: {{ money(order.cancel.refundAmount) }} ({{ order.cancel.refundMethod }})</div>
          <div v-if="order.cancel.refundNote" class="text-sm">หมายเหตุ: {{ order.cancel.refundNote }}</div>
        </section>

        <section class="card">
          <h2 class="mb-2 font-semibold">ประวัติ</h2>
          <ol class="space-y-1 text-sm">
            <li v-for="(h, i) in order.history.slice().reverse()" :key="i" class="flex gap-2">
              <span class="shrink-0 text-stone-400">{{ dateTime(h.at) }}</span>
              <span>{{ h.text }} <span class="text-stone-400">· {{ ROLES[h.by] }}</span></span>
            </li>
          </ol>
        </section>
      </div>

      <!-- ขวา -->
      <div class="space-y-4">
        <section class="card space-y-1 text-sm">
          <div class="flex justify-between"><span>ค่าสินค้า</span><span>{{ money(t.subtotal) }}</span></div>
          <div v-if="order.fulfillment === 'delivery'" class="flex justify-between"><span>ค่าส่ง</span><span>{{ money(t.shipping) }}</span></div>
          <div v-if="t.adjustment" class="flex justify-between">
            <span>ปรับราคา <span class="text-stone-400">({{ order.adjustment.reason }})</span></span>
            <span>{{ money(t.adjustment) }}</span>
          </div>
          <div class="flex justify-between border-t border-stone-100 pt-1 text-base font-semibold"><span>รวม</span><span>{{ money(t.total) }}</span></div>
          <div class="flex justify-between text-emerald-700"><span>ยืนยันชำระแล้ว</span><span>{{ money(t.paid) }}</span></div>
          <div v-if="t.reported" class="flex justify-between text-sky-700"><span>รอยืนยัน</span><span>{{ money(t.reported) }}</span></div>
          <div v-if="order.status !== 'cancelled'" class="flex justify-between font-semibold" :class="t.balance > 0 ? 'text-amber-700' : 'text-emerald-700'">
            <span>คงค้าง</span><span>{{ money(t.balance) }}</span>
          </div>
          <button v-if="can('adjustPrice') && !closed" class="btn-outline mt-2 w-full" @click="openAdj">ปรับราคา / ส่วนลด</button>
        </section>

        <section class="card">
          <div class="mb-2 flex items-center justify-between">
            <h2 class="font-semibold">การชำระเงิน</h2>
            <button
              v-if="can('reportPayment') && order.status !== 'draft' && order.status !== 'cancelled' && t.balance > 0"
              class="btn-outline px-3 py-1"
              @click="openPay"
            >+ แจ้งชำระ</button>
          </div>
          <p v-if="!order.payments.length" class="text-sm text-stone-500">ยังไม่มีการชำระ</p>
          <ul class="space-y-2">
            <li v-for="(p, i) in order.payments" :key="p.id" class="rounded-lg border border-stone-200 p-2 text-sm">
              <div class="flex items-center justify-between">
                <span class="font-medium">งวด {{ i + 1 }} · {{ money(p.amount) }}</span>
                <span
                  class="rounded-full px-2 py-0.5 text-xs"
                  :class="p.status === 'confirmed' ? 'bg-emerald-100 text-emerald-800' : 'bg-sky-100 text-sky-800'"
                >{{ p.status === 'confirmed' ? 'ยืนยันแล้ว' : 'รอยืนยัน' }}</span>
              </div>
              <div class="text-stone-500">{{ p.method }} · {{ dateTime(p.paidAt) }}</div>
              <div v-if="p.note" class="text-stone-500">{{ p.note }}</div>
              <a v-if="p.slip" :href="p.slip" target="_blank"><img :src="p.slip" class="mt-1 h-20 rounded object-cover" /></a>
              <button
                v-if="p.status === 'reported' && can('confirmPayment') && order.status !== 'cancelled'"
                class="btn-primary mt-2 w-full py-1.5"
                @click="confirmPayment(order, p.id)"
              >ยืนยันชำระ</button>
            </li>
          </ul>
        </section>
      </div>
    </div>

    <!-- ปุ่มเปลี่ยนสถานะ -->
    <div v-if="hasActions" class="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 p-3 backdrop-blur lg:static lg:mt-4 lg:border-0 lg:bg-transparent lg:p-0">
      <div class="mx-auto flex max-w-5xl flex-wrap justify-end gap-2">
        <button v-if="can('cancel') && !closed" class="btn-danger mr-auto" @click="openCancel">ยกเลิกออร์เดอร์</button>
        <button
          v-if="order.status === 'draft' && can('sendToPayment')"
          class="btn-primary"
          @click="setStatus(order, 'awaiting_payment', 'ส่งไปรอชำระ')"
        >ส่งไปรอชำระ</button>
        <button
          v-if="order.status === 'payment_confirmed' && can('startPreparing')"
          class="btn-primary"
          @click="setStatus(order, 'preparing', 'เริ่มเตรียมสินค้า')"
        >เริ่มเตรียมสินค้า</button>
        <button
          v-if="order.status === 'preparing' && canDeliver"
          class="btn-primary"
          @click="setStatus(order, 'delivered', 'ส่งมอบแล้ว')"
        >ส่งมอบแล้ว</button>
      </div>
    </div>

    <!-- modal แจ้งชำระ -->
    <AppModal v-if="payOpen" title="แจ้งชำระเงิน" @close="payOpen = false">
      <div class="space-y-3">
        <div class="text-sm text-stone-500">คงค้าง {{ money(t.balance) }}<span v-if="t.reported"> (รอยืนยัน {{ money(t.reported) }})</span></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">ยอดเงิน</label><input v-model.number="pay.amount" type="number" min="0" class="input" /></div>
          <div>
            <label class="label">ช่องทาง</label>
            <select v-model="pay.method" class="input"><option v-for="m in PAYMENT_METHODS" :key="m">{{ m }}</option></select>
          </div>
        </div>
        <div><label class="label">วันเวลาที่ชำระ</label><input v-model="pay.paidAt" type="datetime-local" class="input" /></div>
        <div>
          <label class="label">สลิป (ไม่บังคับ)</label>
          <input type="file" accept="image/*" class="block w-full text-sm" @change="onSlip" />
          <img v-if="pay.slip" :src="pay.slip" class="mt-2 h-24 rounded object-cover" />
        </div>
        <div><label class="label">หมายเหตุ</label><input v-model="pay.note" class="input" /></div>
        <p v-if="payError" class="text-sm text-rose-600">{{ payError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline" @click="payOpen = false">ยกเลิก</button>
        <button class="btn-primary" @click="savePay">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal ปรับราคา -->
    <AppModal v-if="adjOpen" title="ปรับราคา / ส่วนลด" @close="adjOpen = false">
      <div class="space-y-3">
        <div>
          <label class="label">จำนวนเงิน (ติดลบ = ส่วนลด)</label>
          <input v-model.number="adj.amount" type="number" class="input" />
        </div>
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><input v-model="adj.reason" class="input" /></div>
        <p v-if="adjError" class="text-sm text-rose-600">{{ adjError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline" @click="adjOpen = false">ยกเลิก</button>
        <button class="btn-primary" @click="saveAdj">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal ยกเลิก -->
    <AppModal v-if="cancelOpen" title="ยกเลิกออร์เดอร์" @close="cancelOpen = false">
      <div class="space-y-3">
        <div><label class="label">เหตุผล <span class="text-rose-500">*</span></label><textarea v-model="cxl.reason" rows="2" class="input" /></div>
        <div class="text-sm text-stone-500">ชำระแล้ว {{ money(t.paid) }}</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">คืนเงิน</label><input v-model.number="cxl.refundAmount" type="number" min="0" class="input" /></div>
          <div>
            <label class="label">ช่องทาง</label>
            <select v-model="cxl.refundMethod" class="input"><option v-for="m in PAYMENT_METHODS" :key="m">{{ m }}</option></select>
          </div>
        </div>
        <div><label class="label">หมายเหตุการคืนเงิน</label><input v-model="cxl.refundNote" class="input" /></div>
        <p v-if="cxlError" class="text-sm text-rose-600">{{ cxlError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline" @click="cancelOpen = false">ปิด</button>
        <button class="btn-primary bg-rose-600" @click="saveCancel">ยืนยันยกเลิก</button>
      </template>
    </AppModal>
  </div>
</template>
