<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, saveGroup, moveItem } from '../../data/store'
import { GROUP_TYPES, APPLIES_TO, MAIN_KEYS } from '../../lib/constants'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const router = useRouter()
const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.optionGroups
    .filter((g) => inactive.value || g.active !== false)
    .filter((g) => !s || g.name.toLowerCase().includes(s))
})

const activeOptions = (g) => (g.options || []).filter((o) => o.active !== false)
// จัดลำดับกลุ่ม (ลำดับนี้ใช้ตอนสร้างออร์เดอร์ด้วย)
const moveGroup = (g, dir) => moveItem(db.optionGroups, db.optionGroups.indexOf(g), dir)
// บันเดิ้ลอยู่ในหน้าของตัวเองแล้ว · ที่นี่แค่แสดงจำนวนและลิงก์ไป
const bundleCount = computed(() => db.bundles.filter((b) => b.active !== false).length)

// เพิ่มกลุ่มใหม่
const open = ref(false)
const form = reactive({ name: '', type: 'single', required: false, appliesTo: ['custom'], placeholder: '' })
const error = ref('')
function add() {
  Object.assign(form, { name: '', type: 'single', required: false, appliesTo: ['custom'], placeholder: '' })
  error.value = ''
  open.value = true
}
function toggleApplies(k) {
  const i = form.appliesTo.indexOf(k)
  if (i >= 0) form.appliesTo.splice(i, 1)
  else form.appliesTo.push(k)
}
function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อกลุ่ม')
  if (!form.appliesTo.length) return (error.value = 'เลือกอย่างน้อย 1 ประเภทสินค้า')
  const g = saveGroup({ ...form, appliesTo: [...form.appliesTo], options: [] })
  open.value = false
  if (g.type !== 'text') router.push(`/admin/settings/options/${g.id}`)
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="ตัวเลือก + ราคา"
    :subtitle="`${list.length} กลุ่ม`"
    add-label="เพิ่มกลุ่ม"
    search-placeholder="ค้นหาชื่อกลุ่ม"
    @add="add"
  >
    <RouterLink to="/admin/settings/bundles" class="card mb-4 flex items-center gap-3 p-3 transition hover:border-brand-300" data-bundle-link>
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-warning-50 text-warning-700"><AppIcon name="tag" :size="20" /></span>
      <span class="min-w-0 flex-1">
        <span class="block font-semibold text-stone-900">บันเดิ้ล (ชุดลดราคา)</span>
        <span class="block text-sm text-stone-500">{{ bundleCount }} ชุดที่ใช้งาน · ลดราคาเมื่อลูกค้าเลือกตัวเลือกครบชุด</span>
      </span>
      <AppIcon name="next" class="shrink-0 text-stone-500" />
    </RouterLink>

    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบกลุ่มตัวเลือก</p>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="g in list" :key="g.id" class="card flex gap-2 p-2 transition hover:border-brand-300" :class="g.active === false ? 'opacity-60' : ''">
      <RouterLink :to="`/admin/settings/options/${g.id}`" class="block min-w-0 flex-1 rounded-xl p-2 active:scale-[0.99]">
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-stone-900">{{ g.name }}</span>
              <span v-if="MAIN_KEYS.includes(g.key)" class="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">หลัก {{ MAIN_KEYS.indexOf(g.key) + 1 }}</span>
              <span v-if="g.required" class="rounded-full bg-danger-50 px-2 py-0.5 text-xs font-medium text-danger-700">จำเป็น</span>
              <span v-if="g.active === false" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
            </div>
            <div class="mt-0.5 text-sm text-stone-500">
              {{ GROUP_TYPES[g.type] }} · {{ g.appliesTo.map((a) => APPLIES_TO[a]).join(', ') }}
            </div>
          </div>
          <AppIcon name="next" class="mt-1 text-stone-500" />
        </div>
        <div v-if="g.type !== 'text'" class="mt-3 flex flex-wrap gap-1.5">
          <span v-for="o in activeOptions(g).slice(0, 6)" :key="o.id" class="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-600">{{ o.name }}</span>
          <span v-if="activeOptions(g).length > 6" class="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-400">+{{ activeOptions(g).length - 6 }}</span>
          <span v-if="!activeOptions(g).length" class="text-xs text-stone-400">ยังไม่มีตัวเลือก</span>
        </div>
      </RouterLink>
      <span class="flex shrink-0 flex-col justify-center">
        <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30" :disabled="db.optionGroups.indexOf(g) === 0" aria-label="เลื่อนขึ้น" @click="moveGroup(g, -1)">▲</button>
        <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 hover:text-stone-700 disabled:opacity-30" :disabled="db.optionGroups.indexOf(g) === db.optionGroups.length - 1" aria-label="เลื่อนลง" @click="moveGroup(g, 1)">▼</button>
      </span>
      </div>
    </div>

    <AppModal v-if="open" title="เพิ่มกลุ่มตัวเลือก" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อกลุ่ม <span class="text-danger-700">*</span></label><input v-model="form.name" class="input" placeholder="เช่น ลายครีม" /></div>
        <div>
          <div class="label">รูปแบบ</div>
          <div class="grid gap-2">
            <button
              v-for="(label, key) in GROUP_TYPES"
              :key="key"
              type="button"
              class="flex h-11 items-center gap-2 rounded-xl border px-3 text-left text-sm font-medium transition"
              :class="form.type === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
              @click="form.type = key"
            >
              <AppIcon v-if="form.type === key" name="check" :size="16" /> {{ label }}
            </button>
          </div>
        </div>
        <div>
          <div class="label">ใช้กับ</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="(label, key) in APPLIES_TO" :key="key" type="button" class="chip" :class="form.appliesTo.includes(key) ? 'chip-on' : 'chip-off'" @click="toggleApplies(key)">{{ label }}</button>
          </div>
        </div>
        <div v-if="form.type === 'text'"><label class="label">ข้อความตัวอย่างในช่อง</label><input v-model="form.placeholder" class="input" /></div>
        <AppSwitch v-model="form.required" label="จำเป็นต้องเลือก/กรอก" />
        <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
