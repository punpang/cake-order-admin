<script setup>
import { computed, reactive, ref } from 'vue'
import { findCustomer, refundOrder } from '../data/store'
import { invoiceOfOrder } from '../data/acct'
import { orderTotals } from '../lib/pricing'
import { defaultRefundMethod } from '../lib/refund'
import { money } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import RefundEditor from './RefundEditor.vue'

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
      <div><label class="label" for="rf-reason">เหตุผล <span class="text-rose-500">*</span></label><input id="rf-reason" v-model="f.reason" class="input" maxlength="120" /></div>
      <div>
        <div class="label">คืนเงินให้ลูกค้า</div>
        <RefundEditor v-model="f.refunds" :paid="t.paidNet" :can-points="!!customer && !customer.deleted" :default-method="defMethod" />
      </div>
      <div><label class="label" for="rf-note">หมายเหตุ</label><input id="rf-note" v-model="f.note" class="input" maxlength="120" /></div>
      <label v-if="customer && !isPos" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="f.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่าคืนเงินแล้ว" /> แจ้งลูกค้าว่าคืนเงินแล้ว</label>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button class="btn-primary flex-1 sm:flex-none" :disabled="!f.refunds.length" @click="save">ยืนยันคืนเงิน</button>
    </template>
  </AppModal>
</template>
