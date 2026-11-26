<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveIngredient } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import { unitCost } from '../../lib/materials'
import { qty } from '../../lib/format'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.ingredients
    .filter((m) => inactive.value || m.active !== false)
    .filter((m) => !s || m.name.toLowerCase().includes(s))
})

const UNITS = ['g', 'kg', 'ml', 'l', 'ฟอง', 'ชิ้น', 'ใบ']

const open = ref(false)
const blank = () => ({ id: null, name: '', unit: 'g', packSize: 0, packPrice: 0, stock: null, active: true })
const costText = (m) => (m.packSize > 0 ? `${unitCost(m).toLocaleString('th-TH', { maximumFractionDigits: 4 })} ฿/${m.unit}` : 'ยังไม่ตั้งต้นทุน')
const stockText = (m) => (m.stock == null ? 'ยังไม่นับคงเหลือ' : `คงเหลือ ${qty(m.stock)} ${m.unit}`)
const form = reactive(blank())
const error = ref('')
function edit(m) {
  Object.assign(form, m ? { ...blank(), ...m } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อวัตถุดิบ')
  if (!form.unit.trim()) return (error.value = 'กรอกหน่วย')
  if (!(await confirmDeactivate(db.ingredients, form, form.name))) return
  saveIngredient({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="วัตถุดิบ"
    :subtitle="`${list.length} รายการ`"
    add-label="เพิ่มวัตถุดิบ"
    search-placeholder="ค้นหาวัตถุดิบ"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบวัตถุดิบ</p>

    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="m in list"
        :key="m.id"
        class="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="m.active === false ? 'opacity-60' : ''"
        @click="edit(m)"
      >
        <span class="flex min-w-0 flex-1 items-center gap-2">
          <span class="truncate font-medium text-stone-900">{{ m.name }}</span>
          <span v-if="m.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
        </span>
        <span class="shrink-0 text-right text-sm leading-tight">
          <span class="block text-stone-500">{{ m.unit }}</span>
          <span class="block text-xs" :class="m.packSize > 0 ? 'text-stone-400' : 'text-warning-700'">{{ costText(m) }}</span>
          <span class="block text-xs" :class="m.stock == null ? 'text-stone-400' : 'text-stone-600'">{{ stockText(m) }}</span>
        </span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขวัตถุดิบ' : 'เพิ่มวัตถุดิบ'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อวัตถุดิบ <span class="text-danger-700">*</span></label><input v-model="form.name" class="input" /></div>
        <div>
          <label class="label">หน่วย <span class="text-danger-700">*</span></label>
          <input v-model="form.unit" class="input" list="unit-list" />
          <datalist id="unit-list"><option v-for="u in UNITS" :key="u" :value="u" /></datalist>
        </div>
        <div>
          <div class="label">ต้นทุน (ราคาต่อแพ็ก)</div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="text-xs text-stone-500">ขนาดแพ็ก ({{ form.unit || 'หน่วย' }})</label><MoneyInput v-model.number="form.packSize" min="0" class="input" /></div>
            <div><label class="text-xs text-stone-500">ราคาต่อแพ็ก (บาท)</label><MoneyInput v-model.number="form.packPrice" min="0" class="input" /></div>
          </div>
          <p class="mt-1 text-xs text-stone-500">= {{ costText(form) }}</p>
        </div>
        <div>
          <label class="label">คงเหลือ ({{ form.unit || 'หน่วย' }}) <span class="font-normal text-stone-500">· ว่าง = ยังไม่นับ</span></label>
          <input v-model="form.stock" type="number" min="0" step="any" inputmode="decimal" class="input" />
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน (เลือกใส่สูตรได้)" />
        <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
