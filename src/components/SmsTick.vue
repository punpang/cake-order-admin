<script setup>
import { computed } from 'vue'
import { db } from '../data/store'
import { smsChoice } from '../lib/smsChoice'
import { formatPhone } from '../lib/format'
// ติ๊ก "ส่ง SMS ด้วย" ข้างติ๊ก "แจ้งลูกค้า" (ค่าเริ่มต้นติ๊ก) · show = เปิดเมื่อติ๊กแจ้งลูกค้าอยู่
const model = defineModel({ type: Boolean, default: true })
const props = defineProps({ customer: { type: Object, default: null }, order: { type: Object, default: null }, show: { type: Boolean, default: true } })
// ซ่อนเมื่อช่อง SMS ถูกปิดไว้ที่ออร์เดอร์ (หรือที่ลูกค้า ถ้าออร์เดอร์ไม่ได้ตั้ง)
const smsOff = computed(() => { const o = props.order?.notifyChannels?.sms; return typeof o === 'boolean' ? !o : props.customer?.notifyChannels?.sms === false })
const on = computed(() => props.show && smsChoice(props.customer) && !smsOff.value && db.integrations?.sms?.enabled !== false)
</script>

<template>
  <label v-if="on" class="flex items-center gap-2 text-sm text-stone-700" data-sms-tick><input v-model="model" type="checkbox" class="h-4 w-4" aria-label="ส่ง SMS ด้วย" /> ส่ง SMS ด้วย <span class="text-xs text-stone-500">({{ formatPhone(customer.phone) }})</span></label>
</template>
