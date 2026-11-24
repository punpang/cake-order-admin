<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { findCustomer, refundOrder } from '../data/store'
import { invoiceOfOrder } from '../data/acct'
import { orderTotals } from '../lib/pricing'
import { allReturnsOf, defaultRefundMethod, refundList, returnedQtyOf, itemReturnAmount } from '../lib/refund'
import { money, dateTime } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SmsTick from './SmsTick.vue'
import RefundEditor from './RefundEditor.vue'
import RefundCancelDialog from './RefundCancelDialog.vue'

// คืนเงินบางส่วนโดยไม่ยกเลิกออร์เดอร์/บิล (ใช้ร่วมกันทั้งหน้ารายละเอียดออร์เดอร์และ POS)
// ช่องทางคืน: เงินสด / ธนาคาร (โอน) / คะแนนสะสม · รวมทุกครั้งไม่เกินยอดที่ชำระแล้ว
// บิล POS เลือกสินค้าที่คืนเป็นชิ้นได้ด้วย (ยอดคืนเติมให้ตามราคาหลังส่วนลดของชิ้นนั้น แก้ไขได้)
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])

const t = computed(() => orderTotals(props.order))
const customer = computed(() => findCustomer(props.order.customerId))
const isPos = computed(() => props.order.channel === 'pos')
const last = props.order.payments.filter((p) => p.status === 'confirmed').at(-1)
const defMethod = defaultRefundMethod(last?.posMethod || last?.method)
const f = reactive({ reason: '', note: '', notify: true, sms: true, refunds: [] })
const error = ref('')
const history = computed(() => allReturnsOf(props.order))
// คืนได้เฉพาะยอดสินค้า/ค่าบริการที่ชำระแล้ว (goodsPaidNet) · เงินพักไม่ปนในการคืนนี้ ให้แก้ที่ "แก้เงินพัก"
const more = computed(() => t.value.goodsPaidNet > 0) // ยังมียอดให้คืนเพิ่ม (ถ้าไม่เหลือ เหลือแต่รายการให้ยกเลิกการคืน)
const rcFor = ref(null)
const invoice = computed(() => invoiceOfOrder(props.order.id))

// ---------- สินค้าที่คืนเป็นชิ้น (เฉพาะ POS) ----------
const picks = reactive({}) // itemId → จำนวนที่เลือกคืน
const restock = ref(true)
const lines = computed(() =>
  (props.order.items || []).map((it) => ({ it, left: Math.max(0, it.qty - returnedQtyOf(props.order, it.id)) })).filter((l) => l.left > 0),
)
const showItems = computed(() => isPos.value && lines.value.length > 0)
const pickedQty = (l) => Math.min(Math.max(0, Math.floor(picks[l.it.id] || 0)), l.left)
const pickedLines = computed(() => lines.value.map((l) => ({ ...l, qty: pickedQty(l) })).filter((l) => l.qty > 0))
const itemsAmount = computed(() => Math.round(pickedLines.value.reduce((s, l) => s + itemReturnAmount(l.it, l.qty), 0) * 100) / 100)
const canRestockAny = computed(() => pickedLines.value.some((l) => l.it.stockTaken != null))
// เลือกสินค้าแล้วเติมยอดคืนให้ตามสินค้า (แก้ไขยอดได้ที่ช่องคืนเงิน)
watch(itemsAmount, (a) => {
  f.refunds = a > 0 ? [{ method: defMethod, amount: a }] : []
})

function save() {
  error.value = ''
  const r = refundOrder(props.order, {
    reason: f.reason,
    note: f.note,
    notify: f.notify,
    sms: f.sms,
    refunds: f.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })),
    items: pickedLines.value.map((l) => ({ id: l.it.id, qty: l.qty })),
    restock: restock.value,
  })
  if (r.error) return (error.value = r.error)
  emit('done', r.entry)
  emit('close')
}
</script>

<template>
  <AppModal split :title="`คืนเงิน ${order.code}`" @close="emit('close')">
    <template #left>
    <div class="space-y-4">
      <p class="text-sm text-stone-600">คืนเงินบางส่วนโดยไม่ยกเลิก{{ isPos ? 'บิล' : 'ออร์เดอร์' }} (ไม่ตัดคะแนนที่ได้{{ isPos ? '' : ' · ไม่คืนสต็อก' }}) · ชำระสุทธิตอนนี้ <b class="text-stone-900">{{ money(t.goodsPaidNet) }}</b><template v-if="t.returned"> · คืนไปแล้ว {{ money(t.returned) }}</template></p>
      <p v-if="t.hold > 0" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">เงินพัก {{ money(t.hold) }} ไม่รวมในการคืนนี้ · แก้เงินพักได้ที่ "แก้เงินพัก" ในหน้าออร์เดอร์</p>
      <p v-if="invoice" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800">ระบบจะออกใบลดหนี้อัตโนมัติ อ้างใบกำกับภาษี {{ invoice.no }} · ใบกำกับเดิมยังใช้งานอยู่</p>
      <template v-if="more">
      <div><label class="label" for="rf-reason">เหตุผล <span class="text-rose-600">*</span></label><input id="rf-reason" v-model="f.reason" class="input" maxlength="120" /></div>
      <div v-if="showItems" class="space-y-2">
        <div class="label">สินค้าที่คืน (ไม่บังคับ)</div>
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
        <label v-if="canRestockAny" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="restock" type="checkbox" class="h-4 w-4" aria-label="คืนจำนวนนี้เข้าสต็อก" /> คืนจำนวนนี้เข้าสต็อก</label>
      </div>
      </template>
    </div>
    </template>
    <template #right>
    <div class="space-y-4">
      <template v-if="more">
      <div>
        <div class="label">คืนเงินให้ลูกค้า</div>
        <RefundEditor v-model="f.refunds" :paid="t.goodsPaidNet" :can-credit="!!customer && !customer.deleted" :default-method="defMethod" />
      </div>
      <div><label class="label" for="rf-note">หมายเหตุ</label><input id="rf-note" v-model="f.note" class="input" maxlength="120" /></div>
      <label v-if="customer" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="f.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่าคืนเงินแล้ว" /> แจ้งลูกค้าว่าคืนเงินแล้ว</label>
      <SmsTick v-if="customer" v-model="f.sms" :customer="customer" :order="order" :show="f.notify" />
      </template>
      <p v-else class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">ไม่เหลือยอดให้คืนเพิ่ม · ยกเลิกการคืนรายการด้านล่างได้</p>
      <div v-if="history.length" class="space-y-2" aria-label="รายการคืนก่อนหน้า">
        <div class="text-xs font-semibold text-stone-500">รายการคืนก่อนหน้า</div>
        <div v-for="r in history" :key="r.id" class="rounded-xl border p-3 text-sm" :class="r.cancelled ? 'border-stone-200 bg-stone-50' : 'border-rose-200 bg-rose-50/60'" data-return>
          <div class="flex items-center justify-between gap-2"><span class="font-semibold" :class="r.cancelled ? 'text-stone-400 line-through' : 'text-rose-700'">−{{ money(r.amount) }}</span><span class="text-xs text-stone-500">{{ dateTime(r.at) }}</span></div>
          <div v-for="(x, i) in refundList({ refunds: r.refunds })" :key="i" class="text-stone-700">{{ x.label }} {{ money(x.amount) }}<template v-if="x.points != null"> ({{ x.points }} คะแนน)</template></div>
          <div v-for="(x, i) in (r.items || [])" :key="'it' + i" class="text-stone-700">คืนสินค้า {{ x.name }} ×{{ x.qty }}<template v-if="x.restock"> · เข้าสต็อก {{ x.restock }}</template></div>
          <div class="break-words text-stone-600">เหตุผล: {{ r.reason }}</div>
          <div v-if="r.cancelled" class="mt-1 break-words text-xs text-stone-500"><span class="rounded-full bg-stone-200 px-2 py-0.5 font-semibold text-stone-600">ยกเลิกแล้ว</span> {{ r.cancelled.reason }}</div>
          <button v-else-if="order.status !== 'cancelled'" type="button" class="btn-outline mt-2 h-9 px-3" @click="rcFor = r"><AppIcon name="x" :size="16" /> ยกเลิกการคืน</button>
        </div>
      </div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    </template>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button v-if="more" class="btn-primary flex-1 sm:flex-none" :disabled="!f.refunds.length" @click="save">ยืนยันคืนเงิน</button>
    </template>
  </AppModal>
  <RefundCancelDialog v-if="rcFor" :order="order" :entry="rcFor" @close="rcFor = null" />
</template>
