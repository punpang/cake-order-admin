<script setup>
import { computed, ref } from 'vue'
import { db, countPickups, pickupSlots, setPickup } from '../data/store'
import { toDateStr } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'

// แก้วันเวลานัด: เลือกเวลาเป็นปุ่มตามตั้งค่าร้าน เวลาต้องมากกว่าเวลาปัจจุบัน
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close'])

const date = ref(props.order.pickupAt.slice(0, 10) < toDateStr(new Date()) ? toDateStr(new Date()) : props.order.pickupAt.slice(0, 10))
const slots = computed(() => pickupSlots(date.value))
const time = ref(slots.value.includes(props.order.pickupAt.slice(11, 16)) ? props.order.pickupAt.slice(11, 16) : '')
const pickupAt = computed(() => (date.value && time.value ? `${date.value}T${time.value}` : ''))
const load = computed(() => countPickups(pickupAt.value, props.order.id))
const error = ref('')

function onDate() {
  if (!slots.value.includes(time.value)) time.value = ''
}
function save() {
  if (!pickupAt.value) return (error.value = 'เลือกวันและเวลานัดรับ')
  if (new Date(pickupAt.value) <= new Date()) return (error.value = 'เวลานัดต้องมากกว่าเวลาปัจจุบัน')
  setPickup(props.order, pickupAt.value)
  emit('close')
}
</script>

<template>
  <AppModal title="แก้วันเวลานัด" @close="emit('close')">
    <div class="space-y-4">
      <div><label class="label">วันที่</label><input v-model="date" type="date" :min="toDateStr(new Date())" class="input" @change="onDate" /></div>
      <div>
        <div class="label">เวลา <span class="font-normal text-stone-400">(ทุก {{ db.shop.slotMinutes }} นาที)</span></div>
        <p v-if="!slots.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ไม่มีเวลาว่างในวันนี้ เลือกวันอื่น</p>
        <div v-else class="grid grid-cols-4 gap-1.5">
          <button
            v-for="s in slots"
            :key="s"
            type="button"
            class="h-10 rounded-xl border text-sm font-medium transition"
            :class="time === s ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700 hover:border-brand-300'"
            @click="time = s; error = ''"
          >{{ s }}</button>
        </div>
      </div>
      <div v-if="pickupAt" class="flex items-start gap-2.5 rounded-xl p-3 text-sm" :class="load.day ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'">
        <AppIcon :name="load.day ? 'alert' : 'check'" :size="18" class="mt-0.5" />
        <span>วันนั้นมีอีก <b>{{ load.day }}</b> ออร์เดอร์ · ช่วง {{ time.slice(0, 2) }}:00 น. มี <b>{{ load.hour }}</b> ออร์เดอร์</span>
      </div>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
    </template>
  </AppModal>
</template>
