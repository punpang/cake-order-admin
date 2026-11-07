<script setup>
import { computed, reactive, ref } from 'vue'
import { findCustomer, refundOrder } from '../data/store'
import { invoiceOfOrder } from '../data/acct'
import { orderTotals } from '../lib/pricing'
import { allReturnsOf, defaultRefundMethod, refundList } from '../lib/refund'
import { money, dateTime } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import RefundEditor from './RefundEditor.vue'
import RefundCancelDialog from './RefundCancelDialog.vue'

// คืนเงินบางส่วนโดยไม่ยกเลิกออร์เดอร์/บิล (ใช้ร่วมกันทั้งหน้ารายละเอียดออร์เดอร์และ POS)
// ช่องทางคืน: เงินสด / ธนาคาร (โอน) / คะแนนสะสม · รวมทุกครั้งไม่เกินยอดที่ชำระแล้ว
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])

const t = computed(() => orderTotals(props.order))
const customer = computed(() => findCustomer(props.order.customerId))
const isPos = computed(() => props.order.channel === 'pos')
const last = props.order.payments.filter((p) => p.status === 'confirmed').at(-1)
const defMethod = defaultRefundMethod(last?.posMethod || last?.method)
const f = reactive({ reason: '', note: '', notify: true, refunds: [] })
const error = ref('')
const history = computed(() => allReturnsOf(props.order))
const more = computed(() => t.value.paidNet > 0) // ยังมียอดให้คืนเพิ่ม (ถ้าไม่เหลือ เหลือแต่รายการให้ยกเลิกการคืน)
const rcFor = ref(null)
const invoice = computed(() => invoiceOfOrder(props.order.id))

function save() {
  error.value = ''
  const r = refundOrder(props.order, { reason: f.reason, note: f.note, notify: f.notify, refunds: f.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })) })
  if (r.error) return (error.value = r.error)
  emit('done', r.entry)
  emit('close')
}
</script>

<template>
  <AppModal :title="`คืนเงิน ${order.code}`" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-sm text-stone-600">คืนเงินบางส่วนโดยไม่ยกเลิก{{ isPos ? 'บิล' : 'ออร์เดอร์' }} (ไม่คืนสต็อก ไม่ตัดคะแนนที่ได้) · ชำระสุทธิตอนนี้ <b class="text-stone-900">{{ money(t.paidNet) }}</b><template v-if="t.returned"> · คืนไปแล้ว {{ money(t.returned) }}</template></p>
      <p v-if="invoice" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ออกใบกำกับภาษีไว้แล้ว ({{ invoice.no }}) · การคืนบางส่วนยังไม่ออกใบลดหนี้ให้อัตโนมัติ (ยกเลิกทั้งใบจึงจะออก) กรุณาตรวจกับผู้ทำบัญชี</p>
      <template v-if="more">
      <div><label class="label" for="rf-reason">เหตุผล <span class="text-rose-500">*</span></label><input id="rf-reason" v-model="f.reason" class="input" maxlength="120" /></div>
      <div>
        <div class="label">คืนเงินให้ลูกค้า</div>
        <RefundEditor v-model="f.refunds" :paid="t.paidNet" :can-points="!!customer && !customer.deleted" :default-method="defMethod" />
      </div>
      <div><label class="label" for="rf-note">หมายเหตุ</label><input id="rf-note" v-model="f.note" class="input" maxlength="120" /></div>
      <label v-if="customer && !isPos" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="f.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่าคืนเงินแล้ว" /> แจ้งลูกค้าว่าคืนเงินแล้ว</label>
      </template>
      <p v-else class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">ไม่เหลือยอดให้คืนเพิ่ม · ยกเลิกการคืนรายการด้านล่างได้</p>
      <div v-if="history.length" class="space-y-2" aria-label="รายการคืนก่อนหน้า">
        <div class="text-xs font-semibold text-stone-500">รายการคืนก่อนหน้า</div>
        <div v-for="r in history" :key="r.id" class="rounded-xl border p-3 text-sm" :class="r.cancelled ? 'border-stone-200 bg-stone-50' : 'border-rose-200 bg-rose-50/60'" data-return>
          <div class="flex items-center justify-between gap-2"><span class="font-semibold" :class="r.cancelled ? 'text-stone-400 line-through' : 'text-rose-700'">−{{ money(r.amount) }}</span><span class="text-xs text-stone-500">{{ dateTime(r.at) }}</span></div>
          <div v-for="(x, i) in refundList({ refunds: r.refunds })" :key="i" class="text-stone-700">{{ x.label }} {{ money(x.amount) }}<template v-if="x.points != null"> ({{ x.points }} คะแนน)</template></div>
          <div class="break-words text-stone-600">เหตุผล: {{ r.reason }}</div>
          <div v-if="r.cancelled" class="mt-1 break-words text-xs text-stone-500"><span class="rounded-full bg-stone-200 px-2 py-0.5 font-semibold text-stone-600">ยกเลิกแล้ว</span> {{ r.cancelled.reason }}</div>
          <button v-else-if="order.status !== 'cancelled'" type="button" class="btn-outline mt-2 h-9 px-3" @click="rcFor = r"><AppIcon name="x" :size="16" /> ยกเลิกการคืน</button>
        </div>
      </div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button v-if="more" class="btn-primary flex-1 sm:flex-none" :disabled="!f.refunds.length" @click="save">ยืนยันคืนเงิน</button>
    </template>
  </AppModal>
  <RefundCancelDialog v-if="rcFor" :order="order" :entry="rcFor" @close="rcFor = null" />
</template>
