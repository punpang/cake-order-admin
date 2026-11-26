<script setup>
import ThaiDateField from './ThaiDateField.vue'
import { computed, ref } from 'vue'
import { db, countPickups, pickupSlots, pickupSlotsInfo, setPickup, findCustomer } from '../data/store'
import { dayClosed } from '../lib/shopHours'
import { toDateStr } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SmsTick from './SmsTick.vue'

// แก้วันเวลานัด: เลือกเวลาเป็นปุ่มตามตั้งค่าร้าน เวลาต้องมากกว่าเวลาปัจจุบัน
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close'])

const date = ref(props.order.pickupAt.slice(0, 10) < toDateStr(new Date()) ? toDateStr(new Date()) : props.order.pickupAt.slice(0, 10))
const slots = computed(() => pickupSlots(date.value))
const slotInfo = computed(() => pickupSlotsInfo(date.value))
const dayClosure = computed(() => (date.value ? dayClosed(db.shop, date.value) : null))
const time = ref(slots.value.includes(props.order.pickupAt.slice(11, 16)) ? props.order.pickupAt.slice(11, 16) : '')
const pickupAt = computed(() => (date.value && time.value ? `${date.value}T${time.value}` : ''))
const load = computed(() => countPickups(pickupAt.value, props.order.id))
const error = ref('')
const notify = ref(true) // แจ้งลูกค้าว่าเปลี่ยนวันนัด (ไม่ติ๊ก = ไม่ส่งข้อความถึงลูกค้า)
const sms = ref(true)
const customer = computed(() => findCustomer(props.order.customerId))

function onDate() {
  if (!slots.value.includes(time.value)) time.value = ''
}
function save() {
  if (!pickupAt.value) return (error.value = 'เลือกวันและเวลานัดรับ')
  if (new Date(pickupAt.value) <= new Date()) return (error.value = 'เวลานัดต้องมากกว่าเวลาปัจจุบัน')
  const r = setPickup(props.order, pickupAt.value, { notify: notify.value, sms: sms.value })
  if (r.error) return (error.value = r.error)
  emit('close')
}
</script>

<template>
  <AppModal title="แก้วันเวลานัด" @close="emit('close')">
    <div class="space-y-4">
      <div><label class="label">วันที่</label><ThaiDateField v-model="date" :min="toDateStr(new Date())" label="วันที่" @update:model-value="onDate" /></div>
      <div>
        <div class="label">เวลา <span class="font-normal text-stone-400">(ทุก {{ db.shop.slotMinutes }} นาที)</span></div>
        <p v-if="dayClosure" class="rounded-xl bg-danger-50 p-3 text-sm font-medium text-danger-700" role="alert">ร้านปิด: {{ dayClosure.reason }} · เลือกวันอื่น</p>
        <p v-else-if="!slotInfo.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ไม่มีเวลาว่างในวันนี้ เลือกวันอื่น</p>
        <div v-else class="grid grid-cols-4 gap-1.5">
          <button
            v-for="s in slotInfo"
            :key="s.t"
            type="button"
            class="h-10 rounded-xl border text-sm font-medium transition disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-500 disabled:line-through"
            :class="time === s.t ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700 hover:border-brand-300'"
            :disabled="s.closed"
            :title="s.closed ? `ร้านปิด: ${s.reason}` : ''"
            :aria-label="s.closed ? `${s.t} ร้านปิด ${s.reason}` : s.t"
            @click="time = s.t; error = ''"
          >{{ s.t }}</button>
        </div>
      </div>
      <div v-if="pickupAt" class="flex items-start gap-2.5 rounded-xl p-3 text-sm" :class="load.day ? 'bg-warning-50 text-warning-800' : 'bg-success-50 text-success-800'">
        <AppIcon :name="load.day ? 'alert' : 'check'" :size="18" class="mt-0.5" />
        <span>วันนั้นมีอีก <b>{{ load.day }}</b> ออร์เดอร์ · ช่วง {{ time.slice(0, 2) }}:00 น. มี <b>{{ load.hour }}</b> ออร์เดอร์ · ภายใน ±1 ชม. มี <b>{{ load.near }}</b> ออร์เดอร์</span>
      </div>
      <label v-if="customer" class="flex items-center gap-2 text-sm text-stone-700"><input v-model="notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าว่าเปลี่ยนวันนัด" /> แจ้งลูกค้าว่าเปลี่ยนวันนัด</label>
      <SmsTick v-if="customer" v-model="sms" :customer="customer" :order="order" :show="notify" />
      <p v-if="error" class="text-sm text-danger-700">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
    </template>
  </AppModal>
</template>
