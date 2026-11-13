<script setup>
import { computed, ref } from 'vue'
import { cancelRefund, findCustomer } from '../data/store'
import { refundList } from '../lib/refund'
import { money, dateTime } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SmsTick from './SmsTick.vue'

// ยกเลิกการคืนเงินบางส่วนรายการหนึ่ง (ใช้ร่วมกันทั้งหน้ารายละเอียดออร์เดอร์และ POS) · เก็บประวัติเป็น "ยกเลิกแล้ว"
const props = defineProps({ order: { type: Object, required: true }, entry: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])
const hasCustomer = computed(() => !!findCustomer(props.order.customerId))
const f = ref({ reason: '', notify: false, sms: true }) // ค่าเริ่มต้นไม่แจ้งลูกค้า
const error = ref('')
const rows = computed(() => refundList({ refunds: props.entry.refunds }))

function save() {
  error.value = ''
  const r = cancelRefund(props.order, props.entry.id, { reason: f.value.reason, notify: f.value.notify, sms: f.value.sms })
  if (r.error) return (error.value = r.error)
  emit('done', r.entry)
  emit('close')
}
</script>

<template>
  <AppModal title="ยกเลิกการคืนเงิน" @close="emit('close')">
    <div class="space-y-4">
      <div class="rounded-xl border border-rose-200 bg-rose-50/60 p-3 text-sm">
        <div class="font-semibold text-rose-700">−{{ money(entry.amount) }} <span class="text-xs font-normal text-stone-500">{{ dateTime(entry.at) }}</span></div>
        <div v-for="(x, i) in rows" :key="i" class="text-stone-700">{{ x.label }} {{ money(x.amount) }}<template v-if="x.points != null"> ({{ x.points }} คะแนน)</template></div>
        <div class="break-words text-stone-600">เหตุผลเดิม: {{ entry.reason }}</div>
      </div>
      <p class="text-sm text-stone-600">ยกเลิกแล้วยอดคืนนี้จะไม่นับ (ชำระสุทธิกลับขึ้น) และบัญชีบันทึกรายการกลับ · ถ้าคืนเป็นคะแนนจะหักคะแนนคืน (ทำไม่ได้ถ้าลูกค้าใช้คะแนนนั้นไปแล้ว)</p>
      <div><label class="label" for="rc-reason">เหตุผลที่ยกเลิกการคืน <span class="text-rose-600">*</span></label><input id="rc-reason" v-model="f.reason" class="input" maxlength="120" /></div>
      <label v-if="hasCustomer" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="f.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่ายกเลิกการคืนเงิน" /> แจ้งลูกค้าว่ายกเลิกการคืนเงิน</label>
      <SmsTick v-if="hasCustomer" v-model="f.sms" :customer="findCustomer(order.customerId)" :order="order" :show="f.notify" />
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button class="btn-danger flex-1 sm:flex-none" :disabled="!f.reason.trim()" @click="save">ยืนยันยกเลิกการคืน</button>
    </template>
  </AppModal>
</template>
