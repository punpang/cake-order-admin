<script setup>
import { reactive, ref } from 'vue'
import { db, saveShopSettings, pickupSlots } from '../../data/store'
import { toDateStr } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

const st = reactive({ ...db.shop })
const error = ref('')
const saved = ref(false)
const STEPS = [15, 30, 60]
const NEAR = [1, 2, 3, 6, 0]
const num = (v) => Number(v) >= 0 && v !== ''

function save() {
  if (!st.open || !st.close || st.close <= st.open) return (error.value = 'เวลาปิดต้องหลังเวลาเปิด')
  if (!(Number(st.slotMinutes) >= 5)) return (error.value = 'ช่วงเวลาต้องอย่างน้อย 5 นาที')
  if (![st.leadPickup, st.leadDelivery, st.birthdayDays].every(num)) return (error.value = 'กรอกตัวเลขตั้งแต่ 0 ขึ้นไป')
  if (!num(st.depositPercent) || Number(st.depositPercent) > 100) return (error.value = 'มัดจำต้องอยู่ระหว่าง 0–100%')
  error.value = ''
  saveShopSettings(st)
  Object.assign(st, db.shop)
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
// ตัวอย่างเวลาของพรุ่งนี้ (ตามค่าที่บันทึกแล้ว)
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d) })()
</script>

<template>
  <ManageShell title="ตั้งค่าร้าน" :toolbar="false">
    <section class="card space-y-4">
      <div class="card-title mb-0"><AppIcon name="clock" class="text-brand-600" /> เวลานัดรับ</div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">เวลาเปิด</label><input v-model="st.open" type="time" class="input" /></div>
        <div><label class="label">เวลาปิด (นัดได้ถึง)</label><input v-model="st.close" type="time" class="input" /></div>
      </div>
      <div>
        <div class="label">ห่างกันทุก (นาที)</div>
        <div class="flex flex-wrap items-center gap-2">
          <button v-for="m in STEPS" :key="m" type="button" class="chip" :class="Number(st.slotMinutes) === m ? 'chip-on' : 'chip-off'" @click="st.slotMinutes = m">{{ m }}</button>
          <input v-model.number="st.slotMinutes" type="text" v-num min="5" class="input w-24" />
        </div>
      </div>
      <div>
        <div class="label">ค่าเริ่มต้น ช่วงดูออร์เดอร์ก่อน/หลัง ตอนเลือกเวลา</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="h in NEAR" :key="h" type="button" class="chip" :class="Number(st.nearbyHours) === h ? 'chip-on' : 'chip-off'" @click="st.nearbyHours = h">{{ h ? `±${h} ชม.` : 'ทั้งวัน' }}</button>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="cake" class="text-brand-600" /> ตารางผลิต · ต้องเสร็จก่อนนัด (นาที)</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">รับที่ร้าน</label><input v-model.number="st.leadPickup" type="text" v-num min="0" class="input" /></div>
          <div><label class="label">จัดส่ง</label><input v-model.number="st.leadDelivery" type="text" v-num min="0" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> มัดจำ / วันเกิด</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">มัดจำขั้นต่ำ (%) <span class="font-normal text-stone-400">0 = ไม่ใช้</span></label><input v-model.number="st.depositPercent" type="text" v-num min="0" max="100" class="input" /></div>
          <div><label class="label">เตือนวันเกิดล่วงหน้า (วัน)</label><input v-model.number="st.birthdayDays" type="text" v-num min="0" class="input" /></div>
        </div>
      </div>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn-primary w-full" @click="save"><AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึก' }}</button>
      <p class="text-xs text-stone-500">ตัวอย่างพรุ่งนี้: {{ pickupSlots(tomorrow).join(', ') }}</p>
    </section>
  </ManageShell>
</template>
