<script setup>
import { computed, ref } from 'vue'
import { db, findCustomer, grantPayExtension } from '../data/store'
import { QUICK_DUE, quickDue } from '../lib/payDue'
import AppModal from './AppModal.vue'
import SmsTick from './SmsTick.vue'

// ขยายเวลาชำระของงวดที่แจ้งไว้ (ใช้ร่วมกันที่หน้ารายละเอียดออร์เดอร์และหน้าชำระเงิน) · เปิดด้วย v-if ใหม่ทุกครั้ง
const props = defineProps({ order: { type: Object, required: true }, payment: { type: Object, required: true } })
const emit = defineEmits(['close'])
const extAt = ref(quickDue(db.shop.payDueMin || 30))
const customer = computed(() => findCustomer(props.order.customerId))
const notifyCust = ref(true) // แจ้งลูกค้าว่าขยายเวลาแล้ว (ค่าเริ่มต้นติ๊ก)
const smsCust = ref(true)
function save() {
  if (!extAt.value || new Date(extAt.value).getTime() <= Date.now()) return
  grantPayExtension(props.order, props.payment.id, extAt.value, { notify: notifyCust.value, sms: smsCust.value })
  emit('close')
}
</script>

<template>
  <AppModal title="ขยายเวลาชำระ" @close="emit('close')">
    <div class="space-y-4">
      <div class="flex flex-wrap gap-2">
        <button v-for="q in QUICK_DUE" :key="q.m" type="button" class="chip chip-off" @click="extAt = quickDue(q.m)">อีก {{ q.label }}</button>
      </div>
      <div><label class="label">ต้องชำระก่อน</label><input v-model="extAt" type="datetime-local" class="input" /></div>
      <div v-if="customer" class="space-y-2 rounded-xl border border-stone-200 bg-white p-3">
        <label class="flex items-center gap-2 text-sm text-stone-700"><input v-model="notifyCust" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> แจ้งลูกค้าว่าขยายเวลาชำระแล้ว</label>
        <SmsTick v-model="smsCust" :customer="customer" :order="order" :show="notifyCust" />
      </div>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="save">ขยายเวลา</button>
    </template>
  </AppModal>
</template>
