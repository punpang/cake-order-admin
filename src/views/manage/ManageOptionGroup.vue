<script setup>
import { computed, reactive, ref } from 'vue'
import { findGroup, saveGroup, saveOption } from '../../data/store'
import { GROUP_TYPES, APPLIES_TO, PRICE_TYPES } from '../../lib/constants'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import RecipeEditor from '../../components/RecipeEditor.vue'

const props = defineProps({ id: { type: String, required: true } })
const group = computed(() => findGroup(props.id))
const isSize = computed(() => group.value?.key === 'size')

const q = ref('')
const inactive = ref(false)
const options = computed(() => {
  const s = q.value.trim().toLowerCase()
  return (group.value?.options || [])
    .filter((o) => inactive.value || o.active !== false)
    .filter((o) => !s || o.name.toLowerCase().includes(s))
})

const priceText = (o) => {
  if (isSize.value) return money(o.price)
  if (!o.price) return 'ไม่บวกเพิ่ม'
  return o.priceType === 'per_pound' ? `+${money(o.price)} / ปอนด์` : `+${money(o.price)}`
}

// ---------- ตั้งค่ากลุ่ม ----------
const gOpen = ref(false)
const g = reactive({ id: null, name: '', type: 'single', required: false, appliesTo: [], placeholder: '', active: true, prepList: false })
const gError = ref('')
function editGroup() {
  const cur = group.value
  Object.assign(g, { id: cur.id, name: cur.name, type: cur.type, required: !!cur.required, appliesTo: [...cur.appliesTo], placeholder: cur.placeholder || '', active: cur.active !== false, prepList: !!cur.prepList })
  gError.value = ''
  gOpen.value = true
}
function toggleApplies(k) {
  const i = g.appliesTo.indexOf(k)
  if (i >= 0) g.appliesTo.splice(i, 1)
  else g.appliesTo.push(k)
}
function saveG() {
  if (!g.name.trim()) return (gError.value = 'กรอกชื่อกลุ่ม')
  if (!g.appliesTo.length) return (gError.value = 'เลือกอย่างน้อย 1 ประเภทสินค้า')
  saveGroup({ ...g, appliesTo: [...g.appliesTo] })
  gOpen.value = false
}

// ---------- ตัวเลือก ----------
const oOpen = ref(false)
const blank = () => ({ id: null, name: '', price: 0, priceType: 'fixed', pounds: 1, active: true, recipe: [] })
const o = reactive(blank())
const oError = ref('')
function editOption(opt) {
  Object.assign(o, opt ? { ...blank(), ...opt, recipe: (opt.recipe || []).map((x) => ({ ...x })) } : blank())
  oError.value = ''
  oOpen.value = true
}
function saveO() {
  if (!o.name.trim()) return (oError.value = 'กรอกชื่อตัวเลือก')
  if (!(o.price >= 0)) return (oError.value = 'ราคาไม่ถูกต้อง')
  if (isSize.value && !(o.pounds > 0)) return (oError.value = 'ขนาดต้องมากกว่า 0')
  const data = { ...o }
  if (isSize.value) data.priceType = 'fixed'
  else delete data.pounds
  saveOption(group.value.id, data)
  oOpen.value = false
}
</script>

<template>
  <div v-if="!group" class="card py-10 text-center text-stone-500">
    ไม่พบกลุ่มตัวเลือก <RouterLink to="/manage/options" class="text-brand-700 underline">กลับ</RouterLink>
  </div>

  <ManageShell
    v-else
    v-model:q="q"
    v-model:inactive="inactive"
    :title="group.name"
    back="/manage/options"
    :add-label="group.type !== 'text' ? 'เพิ่มตัวเลือก' : ''"
    :toolbar="group.type !== 'text'"
    search-placeholder="ค้นหาตัวเลือก"
    @add="editOption(null)"
  >
    <!-- ตั้งค่ากลุ่ม -->
    <section class="card mb-4">
      <div class="flex items-start gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><AppIcon name="tag" :size="22" /></span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-semibold text-stone-900">{{ group.name }}</span>
            <span v-if="group.required" class="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">จำเป็น</span>
            <span v-if="group.active === false" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </div>
          <div class="text-sm text-stone-500">{{ GROUP_TYPES[group.type] }} · {{ group.appliesTo.map((a) => APPLIES_TO[a]).join(', ') }}</div>
          <div v-if="isSize" class="mt-1 text-xs text-stone-400">กลุ่มขนาดใช้เป็นราคาฐานของเค้กสั่งทำ</div>
        </div>
        <button class="btn-outline h-9 px-3" @click="editGroup"><AppIcon name="edit" :size="16" /> แก้ไข</button>
      </div>
    </section>

    <p v-if="group.type === 'text'" class="card py-8 text-center text-sm text-stone-500">กลุ่มนี้เป็นช่องพิมพ์ข้อความ ไม่มีตัวเลือกและไม่มีราคา</p>

    <template v-else>
      <p v-if="!options.length" class="card py-10 text-center text-stone-500">ยังไม่มีตัวเลือก</p>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          v-for="opt in options"
          :key="opt.id"
          class="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand-300 active:scale-[0.99]"
          :class="opt.active === false ? 'opacity-60' : ''"
          @click="editOption(opt)"
        >
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span class="truncate font-medium text-stone-900">{{ opt.name }}</span>
              <span v-if="opt.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
            </span>
            <span v-if="isSize" class="block text-xs text-stone-500">{{ opt.pounds }} ปอนด์</span>
          </span>
          <span class="shrink-0 text-sm font-semibold" :class="opt.price ? 'text-stone-900' : 'text-stone-400'">{{ priceText(opt) }}</span>
        </button>
      </div>
    </template>

    <!-- modal กลุ่ม -->
    <AppModal v-if="gOpen" title="ตั้งค่ากลุ่ม" @close="gOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อกลุ่ม <span class="text-rose-500">*</span></label><input v-model="g.name" class="input" /></div>
        <div v-if="g.type !== 'text'">
          <div class="label">รูปแบบ</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="key in ['single', 'multi']"
              :key="key"
              type="button"
              class="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium"
              :class="g.type === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
              @click="g.type = key"
            >{{ GROUP_TYPES[key] }}</button>
          </div>
        </div>
        <div>
          <div class="label">ใช้กับ</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="(label, key) in APPLIES_TO" :key="key" type="button" class="chip" :class="g.appliesTo.includes(key) ? 'chip-on' : 'chip-off'" @click="toggleApplies(key)">{{ label }}</button>
          </div>
        </div>
        <div v-if="g.type === 'text'"><label class="label">ข้อความตัวอย่างในช่อง</label><input v-model="g.placeholder" class="input" /></div>
        <AppSwitch v-model="g.required" label="จำเป็นต้องเลือก/กรอก" class="flex" />
        <AppSwitch v-model="g.active" label="ใช้งาน (แสดงตอนสร้างออร์เดอร์)" class="flex" />
        <AppSwitch v-if="g.type !== 'text' && !isSize && group.key !== 'flavor'" v-model="g.prepList" label="แสดงในรายการเตรียม (นับเป็นชุด แยกตามขนาด)" class="flex" />
        <p v-if="gError" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ gError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="gOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveG">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal ตัวเลือก -->
    <AppModal v-if="oOpen" :title="o.id ? 'แก้ไขตัวเลือก' : 'เพิ่มตัวเลือก'" @close="oOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อตัวเลือก <span class="text-rose-500">*</span></label><input v-model="o.name" class="input" /></div>

        <template v-if="isSize">
          <div class="grid grid-cols-2 gap-4">
            <div><label class="label">ขนาด (ปอนด์)</label><input v-model.number="o.pounds" type="number" inputmode="decimal" min="0.5" step="0.5" class="input" /></div>
            <div><label class="label">ราคาฐาน (บาท)</label><input v-model.number="o.price" type="number" inputmode="numeric" min="0" class="input" /></div>
          </div>
        </template>

        <template v-else>
          <div>
            <div class="label">วิธีคิดราคา</div>
            <div class="grid grid-cols-2 gap-2">
              <button
                v-for="(label, key) in PRICE_TYPES"
                :key="key"
                type="button"
                class="flex h-11 items-center justify-center rounded-xl border text-sm font-medium"
                :class="o.priceType === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600'"
                @click="o.priceType = key"
              >{{ label }}</button>
            </div>
          </div>
          <div>
            <label class="label">ราคาบวกเพิ่ม (บาท{{ o.priceType === 'per_pound' ? ' / ปอนด์' : '' }})</label>
            <input v-model.number="o.price" type="number" inputmode="numeric" min="0" class="input" />
            <p class="mt-1 text-xs text-stone-400">ใส่ 0 ถ้าไม่บวกเพิ่ม</p>
          </div>
        </template>

        <RecipeEditor v-model="o.recipe" />
        <AppSwitch v-model="o.active" label="ใช้งาน (แสดงตอนสร้างออร์เดอร์)" class="flex" />
        <p v-if="oError" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ oError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="oOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveO">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
