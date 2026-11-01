<script setup>
import { computed, reactive, ref } from 'vue'
import { db, saveProduct } from '../../data/store'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import RecipeEditor from '../../components/RecipeEditor.vue'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.products
    .filter((p) => inactive.value || p.active !== false)
    .filter((p) => !s || p.name.toLowerCase().includes(s))
})

const open = ref(false)
const blank = () => ({ id: null, name: '', pounds: 1, price: 0, active: true, recipe: [] })
const form = reactive(blank())
const error = ref('')
function edit(p) {
  Object.assign(form, p ? { ...blank(), ...p, recipe: (p.recipe || []).map((x) => ({ ...x })) } : blank())
  error.value = ''
  open.value = true
}
function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อสินค้า')
  if (!(form.pounds > 0)) return (error.value = 'ขนาดต้องมากกว่า 0')
  if (!(form.price >= 0)) return (error.value = 'ราคาไม่ถูกต้อง')
  saveProduct({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="สินค้า (เค้กสำเร็จ)"
    :subtitle="`${list.length} รายการ`"
    add-label="เพิ่มสินค้า"
    search-placeholder="ค้นหาชื่อสินค้า"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบสินค้า</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        v-for="p in list"
        :key="p.id"
        class="card flex items-center gap-3 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="p.active === false ? 'opacity-60' : ''"
        @click="edit(p)"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="cake" :size="24" /></span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold text-stone-900">{{ p.name }}</span>
            <span v-if="p.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="block text-sm text-stone-500">{{ p.pounds }} ปอนด์</span>
        </span>
        <span class="shrink-0 text-lg font-bold text-stone-900">{{ money(p.price) }}</span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อสินค้า <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" /></div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="label">ขนาด (ปอนด์)</label><input v-model.number="form.pounds" type="number" inputmode="decimal" min="0.5" step="0.5" class="input" /></div>
          <div><label class="label">ราคา (บาท)</label><input v-model.number="form.price" type="number" inputmode="numeric" min="0" class="input" /></div>
        </div>
        <RecipeEditor v-model="form.recipe" />
        <AppSwitch v-model="form.active" label="ใช้งาน (แสดงตอนสร้างออร์เดอร์)" />
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
