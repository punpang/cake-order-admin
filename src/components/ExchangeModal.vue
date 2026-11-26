<script setup>
// แลกสินค้าในหน้า POS: คืนสินค้าเดิมจากบิลเดิม + ขายสินค้าใหม่เป็นบิลใหม่ที่ผูกกับบิลเดิม
import { computed, reactive, ref, watch } from 'vue'
import { db, exchangeSale, posItems, vatNow, findCustomer } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { returnedQtyOf, itemReturnAmount, defaultRefundMethod } from '../lib/refund'
import { money, orderNo } from '../lib/format'
import { POS_METHODS } from '../lib/constants'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import MoneyInput from './MoneyInput.vue'
import RefundEditor from './RefundEditor.vue'

const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

// ---------- 1) สินค้าเดิมที่คืน ----------
const picks = reactive({}) // itemId → จำนวนที่เลือกคืน
const restock = ref(true)
const lines = computed(() =>
  (props.order.items || []).map((it) => ({ it, left: Math.max(0, it.qty - returnedQtyOf(props.order, it.id)) })).filter((l) => l.left > 0),
)
const pickedQty = (l) => Math.min(Math.max(0, Math.floor(picks[l.it.id] || 0)), l.left)
const returnPicked = computed(() => lines.value.map((l) => ({ ...l, qty: pickedQty(l) })).filter((l) => l.qty > 0))
const returnAmount = computed(() => r2(returnPicked.value.reduce((s, l) => s + itemReturnAmount(l.it, l.qty), 0)))
const canRestockAny = computed(() => returnPicked.value.some((l) => l.it.stockTaken != null))

// ---------- 2) คืนเงินสินค้าเดิม (ยอดตั้งต้นตามสินค้าที่เลือก แก้ได้) ----------
const lastPay = props.order.payments.filter((p) => p.status === 'confirmed').at(-1)
const defMethod = defaultRefundMethod(lastPay?.posMethod || lastPay?.method)
const customer = computed(() => findCustomer(props.order.customerId))
const refunds = ref([])
watch(returnAmount, (a) => {
  refunds.value = a > 0 ? [{ method: defMethod, amount: a }] : []
})

// ---------- 3) สินค้าใหม่ (เฉพาะสินค้าปลีกที่ไม่ต้องเลือกตัวเลือก) ----------
const q = ref('')
const newPicks = reactive({}) // retailId → จำนวน
const needsOptions = (r) => (r.modifierIds || []).some((id) => {
  const g = db.posModifiers.find((m) => m.id === id)
  return g && g.active !== false && g.required
})
const catalog = computed(() =>
  db.retailItems
    .filter((r) => r.active !== false && r.showInPos !== false)
    .map((r) => ({ ...r, blocked: needsOptions(r) }))
    .filter((r) => !q.value.trim() || r.name.toLowerCase().includes(q.value.trim().toLowerCase())),
)
const newLeft = (r) => (r.stock == null ? Infinity : r.stock - 0)
const newQty = (r) => Math.min(Math.max(0, Math.floor(newPicks[r.id] || 0)), newLeft(r))
const newCart = computed(() =>
  db.retailItems
    .filter((r) => newQty(r) > 0)
    .map((r) => ({ kind: 'retail', refId: r.id, qty: newQty(r), mods: [] })),
)
const newTotal = computed(() => {
  if (!newCart.value.length) return 0
  const draft = { items: posItems(newCart.value, new Date()), adjustment: { amount: 0, reason: '' }, vat: vatNow(), couponsUsed: [], pointsUsed: null, shippingFee: 0, shipPromo: null, fulfillment: 'pickup', payments: [] }
  return Math.max(orderTotals(draft).total, 0)
})
const newCount = computed(() => newCart.value.reduce((s, l) => s + l.qty, 0))

// ---------- 4) ชำระเงินของบิลใหม่ (เงินสด / บัตร · โอนต้องใช้ QR ในหน้าชำระปกติ) ----------
const method = ref('cash')
const received = ref('')
const cardConfirmed = ref(false) // บัตรต้องกดยืนยัน "รับชำระด้วยบัตรแล้ว" ก่อนบันทึกการแลก (ยอดเปลี่ยนหรือเปลี่ยนวิธีจ่ายต้องยืนยันใหม่)
watch([method, newTotal], () => { cardConfirmed.value = false })
const change = computed(() => r2((Number(received.value) || 0) - newTotal.value))
const diff = computed(() => r2(newTotal.value - returnAmount.value))
const cashOk = computed(() => method.value !== 'cash' || (Number(received.value) || 0) >= newTotal.value)
const cardOk = computed(() => method.value !== 'card' || cardConfirmed.value)

// ---------- บันทึก ----------
const err = ref('')
const saving = ref(false)
function save() {
  if (saving.value) return
  err.value = ''
  saving.value = true
  const r = exchangeSale({
    order: props.order,
    returnItems: returnPicked.value.map((l) => ({ id: l.it.id, qty: l.qty })),
    restock: restock.value,
    refunds: refunds.value.map((x) => ({ method: x.method, amount: Number(x.amount) })),
    newCart: newCart.value,
    method: method.value,
    received: method.value === 'cash' ? Number(received.value) || 0 : null,
    confirmed: method.value === 'card' && cardConfirmed.value,
    reason: `แลกสินค้า ${props.order.code}`,
  })
  saving.value = false
  if (r.error) return (err.value = r.error)
  emit('done', r.order)
  emit('close')
}
</script>

<template>
  <AppModal split :title="`แลกสินค้า ${orderNo(order.code)}`" @close="emit('close')">
    <template #left>
    <div class="space-y-5">
      <!-- 1) สินค้าเดิมที่คืน -->
      <section class="space-y-2">
        <div class="label">1. สินค้าเดิมที่ลูกค้าคืน</div>
        <p v-if="!lines.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">คืนสินค้าครบแล้ว ไม่มีรายการให้คืนเพิ่ม</p>
        <div v-for="l in lines" :key="l.it.id" class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-2.5">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium text-stone-900">{{ l.it.name }}</div>
            <div class="text-xs text-stone-500">{{ money(itemReturnAmount(l.it, 1)) }}/ชิ้น · คืนได้อีก {{ l.left }} ชิ้น</div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <button type="button" class="btn-outline h-11 w-11 px-0" :disabled="pickedQty(l) <= 0" :aria-label="`ลดจำนวนคืน ${l.it.name}`" @click="picks[l.it.id] = pickedQty(l) - 1">−</button>
            <span class="w-6 text-center text-sm font-semibold tabular-nums">{{ pickedQty(l) }}</span>
            <button type="button" class="btn-outline h-11 w-11 px-0" :disabled="pickedQty(l) >= l.left" :aria-label="`เพิ่มจำนวนคืน ${l.it.name}`" @click="picks[l.it.id] = pickedQty(l) + 1">+</button>
          </div>
        </div>
        <label v-if="canRestockAny" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="restock" type="checkbox" class="h-4 w-4" aria-label="คืนสินค้าเดิมเข้าสต็อก" /> คืนสินค้าเดิมเข้าสต็อก</label>
      </section>

      <!-- 2) คืนเงินสินค้าเดิม -->
      <section v-if="returnPicked.length" class="space-y-2">
        <div class="label">2. คืนเงินสินค้าเดิม · {{ money(returnAmount) }}</div>
        <RefundEditor v-model="refunds" :paid="orderTotals(order).paidNet" :can-credit="!!customer && !customer.deleted" :default-method="defMethod" />
      </section>

    </div>
    </template>
    <template #center>
    <div class="space-y-5">
      <!-- 3) สินค้าใหม่ -->
      <section class="space-y-2">
        <div class="label">3. สินค้าใหม่</div>
        <input v-model="q" type="search" class="input" maxlength="60" placeholder="ค้นหาสินค้า" aria-label="ค้นหาสินค้าใหม่" />
        <div class="max-h-72 space-y-2 overflow-y-auto pr-1">
          <div v-for="r in catalog" :key="r.id" class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-2.5" :class="r.blocked ? 'opacity-50' : ''">
            <div class="min-w-0">
              <div class="truncate text-sm font-medium text-stone-900">{{ r.name }}</div>
              <div class="text-xs text-stone-500">{{ money(r.price) }}<template v-if="r.blocked"> · ต้องเลือกตัวเลือก (ใช้ขายปกติ)</template><template v-else-if="r.stock != null"> · เหลือ {{ r.stock }}</template></div>
            </div>
            <div v-if="!r.blocked" class="flex shrink-0 items-center gap-2">
              <button type="button" class="btn-outline h-11 w-11 px-0" :disabled="newQty(r) <= 0" :aria-label="`ลดจำนวน ${r.name}`" @click="newPicks[r.id] = newQty(r) - 1">−</button>
              <span class="w-6 text-center text-sm font-semibold tabular-nums">{{ newQty(r) }}</span>
              <button type="button" class="btn-outline h-11 w-11 px-0" :disabled="newQty(r) >= (r.stock == null ? 99 : r.stock)" :aria-label="`เพิ่มจำนวน ${r.name}`" @click="newPicks[r.id] = newQty(r) + 1">+</button>
            </div>
          </div>
          <p v-if="!catalog.length" class="py-4 text-center text-sm text-stone-500">ไม่พบสินค้า</p>
        </div>
      </section>

    </div>
    </template>
    <template #right>
    <div class="space-y-5">
      <!-- สรุป + ชำระ -->
      <section class="space-y-3 rounded-xl bg-stone-50 p-3">
        <div class="flex justify-between text-sm"><span class="text-stone-600">คืนสินค้าเดิม</span><b class="tabular-nums text-stone-900">−{{ money(returnAmount) }}</b></div>
        <div class="flex justify-between text-sm"><span class="text-stone-600">สินค้าใหม่ ({{ newCount }} ชิ้น)</span><b class="tabular-nums text-stone-900">{{ money(newTotal) }}</b></div>
        <div v-if="returnAmount && newTotal" class="flex justify-between border-t border-stone-200 pt-2 text-sm font-semibold" :class="diff > 0 ? 'text-stone-900' : diff < 0 ? 'text-success-700' : 'text-stone-900'">
          <span>{{ diff > 0 ? 'ลูกค้าจ่ายเพิ่ม' : diff < 0 ? 'คืนให้ลูกค้าเพิ่ม' : 'ยอดเท่ากัน' }}</span><span class="tabular-nums">{{ money(Math.abs(diff)) }}</span>
        </div>
        <div v-if="newTotal > 0" class="space-y-2 border-t border-stone-200 pt-3">
          <div class="label">รับชำระสินค้าใหม่</div>
          <div class="grid grid-cols-2 gap-2">
            <button type="button" class="h-11 rounded-xl border text-sm font-medium" :class="method === 'cash' ? 'border-brand-500 bg-brand-600 text-white' : 'border-stone-200 bg-white text-stone-700'" :aria-pressed="method === 'cash'" @click="method = 'cash'">{{ POS_METHODS.cash }}</button>
            <button type="button" class="h-11 rounded-xl border text-sm font-medium" :class="method === 'card' ? 'border-brand-500 bg-brand-600 text-white' : 'border-stone-200 bg-white text-stone-700'" :aria-pressed="method === 'card'" @click="method = 'card'">{{ POS_METHODS.card }}</button>
          </div>
          <div v-if="method === 'cash'" class="space-y-1">
            <MoneyInput v-model="received" class="input" placeholder="รับเงินมา (บาท)" aria-label="รับเงินมา" />
            <p class="text-xs" :class="cashOk ? 'text-stone-500' : 'text-danger-700'">{{ cashOk ? `ทอน ${money(Math.max(change, 0))}` : 'รับเงินมายังไม่พอ' }}</p>
          </div>
          <div v-if="method === 'card'" class="space-y-2">
            <button v-if="!cardConfirmed" type="button" class="btn-primary h-11 w-full" @click="cardConfirmed = true">รับชำระด้วยบัตรแล้ว</button>
            <div v-else class="flex items-center justify-center gap-2 rounded-xl bg-success-50 p-3 font-semibold text-success-800">รับชำระด้วยบัตรแล้ว</div>
          </div>
          <p class="text-xs text-stone-500">โอนเงินต้องใช้ QR ในหน้าชำระปกติ จึงแลกด้วยการโอนที่นี่ไม่ได้</p>
        </div>
      </section>

      <p v-if="err" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>
    </div>
    </template>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button class="btn-primary flex-1 sm:flex-none" :disabled="saving || !returnPicked.length || !newCart.length || !cashOk || !cardOk" @click="save">ยืนยันแลกสินค้า</button>
    </template>
  </AppModal>
</template>
