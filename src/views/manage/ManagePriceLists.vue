<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, savePriceList } from '../../data/store'
import { activeLists } from '../../lib/pricing'
import { dateOnly, toDateStr } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.priceLists
    .filter((l) => inactive.value || l.active !== false)
    .filter((l) => !s || l.name.toLowerCase().includes(s))
})

const today = toDateStr(new Date())
const nowIds = computed(() => activeLists(db.priceLists, today).map((l) => l.id))
const period = (l) => (l.scheduled ? `${l.from ? dateOnly(l.from) : '…'} – ${l.to ? dateOnly(l.to) : '…'}` : 'ไม่กำหนดเวลา')

const open = ref(false)
const blank = () => ({ id: null, name: '', active: true, scheduled: false, from: today, to: today })
const form = reactive(blank())
const error = ref('')
function edit(l) {
  Object.assign(form, l ? { ...blank(), ...l } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อราคาพิเศษ')
  if (form.scheduled && (!form.from || !form.to)) return (error.value = 'เลือกวันเริ่มและวันสิ้นสุด')
  if (form.scheduled && form.to < form.from) return (error.value = 'วันสิ้นสุดต้องไม่ก่อนวันเริ่ม')
  if (!(await confirmDeactivate(db.priceLists, form, form.name))) return
  savePriceList({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="การกำหนดราคา"
    subtitle="แบบราคาพิเศษ · ราคาต่อรายการตั้งในหน้าสินค้า/ตัวเลือก"
    add-label="เพิ่มราคาพิเศษ"
    search-placeholder="ค้นหาชื่อ"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ยังไม่มีราคาพิเศษ</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        v-for="l in list"
        :key="l.id"
        class="card flex items-center gap-3 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="l.active === false ? 'opacity-60' : ''"
        @click="edit(l)"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="wallet" :size="24" /></span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold text-stone-900">{{ l.name }}</span>
            <span v-if="nowIds.includes(l.id)" class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">ใช้อยู่ตอนนี้</span>
            <span v-else-if="l.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="block text-sm text-stone-500">{{ period(l) }}</span>
        </span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขราคาพิเศษ' : 'เพิ่มราคาพิเศษ'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" placeholder="เช่น ราคาสมาชิก, โปรวันแม่" /></div>
        <AppSwitch v-model="form.scheduled" label="กำหนดช่วงเวลา (นับจากวันที่สร้างออร์เดอร์)" class="flex" />
        <div v-if="form.scheduled" class="grid grid-cols-2 gap-3">
          <div><label class="label">วันเริ่ม</label><input v-model="form.from" type="date" class="input" /></div>
          <div><label class="label">วันสิ้นสุด</label><input v-model="form.to" type="date" :min="form.from" class="input" /></div>
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน" class="flex" />
        <p class="text-xs text-stone-400">ถ้ามีหลายแบบใช้งานพร้อมกัน จะใช้ราคาที่ต่ำสุด</p>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
