<script setup>
import { ref } from 'vue'
import { db, grantPayExtension } from '../data/store'
import { QUICK_DUE, quickDue } from '../lib/payDue'
import AppModal from './AppModal.vue'

// ขยายเวลาชำระของงวดที่แจ้งไว้ (ใช้ร่วมกันที่หน้ารายละเอียดออร์เดอร์และหน้าชำระเงิน) · เปิดด้วย v-if ใหม่ทุกครั้ง
const props = defineProps({ order: { type: Object, required: true }, payment: { type: Object, required: true } })
const emit = defineEmits(['close'])
const extAt = ref(quickDue(db.shop.payDueMin || 30))
function save() {
  if (!extAt.value || new Date(extAt.value).getTime() <= Date.now()) return
  grantPayExtension(props.order, props.payment.id, extAt.value)
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
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="save">ขยายเวลา</button>
    </template>
  </AppModal>
</template>
