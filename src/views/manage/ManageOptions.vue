<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, saveGroup, saveBundle } from '../../data/store'
import { confirmDeactivate } from '../../lib/confirm'
import { money } from '../../lib/format'
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
  if (g.type !== 'text') router.push(`/manage/options/${g.id}`)
}

// ---------- บันเดิ้ล: ตัวเลือกรอง ในกลุ่มเดียวกันหรือข้ามกลุ่ม ลดราคาตามขนาด ----------
const sizeOpts = computed(() => (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false))
const bundleGroups = computed(() => db.optionGroups.filter((g) => !MAIN_KEYS.includes(g.key) && g.type !== 'text' && g.active !== false))
const bundleList = computed(() => db.bundles.filter((b) => inactive.value || b.active !== false))
const itemName = (x) => {
  const g = db.optionGroups.find((y) => y.id === x.groupId)
  return `${g?.name || '?'}: ${g?.options.find((o) => o.id === x.optionId)?.name || '?'}`
}
const bOpen = ref(false)
const bd = reactive({ id: null, name: '', items: [], discount: {}, active: true })
const bError = ref('')
const bundleAutoName = computed(() => bd.items.map((x) => db.optionGroups.find((g) => g.id === x.groupId)?.options.find((o) => o.id === x.optionId)?.name).filter(Boolean).join(' + '))
function editBundle(b) {
  Object.assign(bd, b ? { ...b, items: b.items.map((x) => ({ ...x })), discount: { ...(b.discount || {}) } } : { id: null, name: '', items: [], discount: {}, active: true })
  bError.value = ''
  bOpen.value = true
}
const inBundle = (g, o) => bd.items.some((x) => x.groupId === g.id && x.optionId === o.id)
function toggleItem(g, o) {
  const i = bd.items.findIndex((x) => x.groupId === g.id && x.optionId === o.id)
  if (i >= 0) bd.items.splice(i, 1)
  else bd.items.push({ groupId: g.id, optionId: o.id })
}
async function saveB() {
  if (bd.items.length < 2) return (bError.value = 'เลือกอย่างน้อย 2 ตัวเลือก')
  const data = { ...bd, name: bd.name.trim() || bundleAutoName.value }
  if (!(await confirmDeactivate(db.bundles, data, data.name))) return
  saveBundle(data)
  bOpen.value = false
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
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบกลุ่มตัวเลือก</p>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      <RouterLink
        v-for="g in list"
        :key="g.id"
        :to="`/manage/options/${g.id}`"
        class="card block transition hover:border-brand-300 active:scale-[0.99]"
        :class="g.active === false ? 'opacity-60' : ''"
      >
        <div class="flex items-start gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-semibold text-stone-900">{{ g.name }}</span>
              <span v-if="MAIN_KEYS.includes(g.key)" class="rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-800">หลัก {{ MAIN_KEYS.indexOf(g.key) + 1 }}</span>
              <span v-if="g.required" class="rounded-full bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600">จำเป็น</span>
              <span v-if="g.active === false" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
            </div>
            <div class="mt-0.5 text-sm text-stone-500">
              {{ GROUP_TYPES[g.type] }} · {{ g.appliesTo.map((a) => APPLIES_TO[a]).join(', ') }}
            </div>
          </div>
          <AppIcon name="next" class="mt-1 text-stone-300" />
        </div>
        <div v-if="g.type !== 'text'" class="mt-3 flex flex-wrap gap-1.5">
          <span v-for="o in activeOptions(g).slice(0, 6)" :key="o.id" class="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-600">{{ o.name }}</span>
          <span v-if="activeOptions(g).length > 6" class="rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-400">+{{ activeOptions(g).length - 6 }}</span>
          <span v-if="!activeOptions(g).length" class="text-xs text-stone-400">ยังไม่มีตัวเลือก</span>
        </div>
      </RouterLink>
    </div>

    <!-- บันเดิ้ล -->
    <section class="card mt-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">บันเดิ้ล <span class="text-xs font-normal text-stone-400">เลือกครบชุด ลดราคาตามขนาด (ในกลุ่มหรือข้ามกลุ่ม)</span></div>
        <button class="btn-soft h-9 px-3" @click="editBundle(null)"><AppIcon name="plus" :size="16" /> เพิ่ม</button>
      </div>
      <p v-if="!bundleList.length" class="text-sm text-stone-500">ยังไม่มีบันเดิ้ล</p>
      <div class="space-y-2">
        <button
          v-for="b in bundleList"
          :key="b.id"
          class="block w-full rounded-xl border border-stone-200 p-3 text-left hover:border-brand-300"
          :class="b.active === false ? 'opacity-60' : ''"
          @click="editBundle(b)"
        >
          <span class="flex items-center gap-2">
            <span class="min-w-0 flex-1 font-medium break-words text-stone-900">{{ b.name }}</span>
            <span v-if="b.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="mt-0.5 block text-xs break-words text-stone-500">{{ b.items.map(itemName).join(' + ') }}</span>
          <span class="mt-0.5 block text-xs text-emerald-700">{{ sizeOpts.map((sz) => `${sz.name} −${money(b.discount?.[sz.id] || 0)}`).join(' · ') }}</span>
        </button>
      </div>
    </section>

    <AppModal v-if="bOpen" :title="bd.id ? 'แก้ไขบันเดิ้ล' : 'เพิ่มบันเดิ้ล'" @close="bOpen = false">
      <div class="space-y-4">
        <div>
          <div class="label">ตัวเลือกในบันเดิ้ล (อย่างน้อย 2 · เลือกจากกลุ่มเดียวกันหรือต่างกลุ่มได้)</div>
          <div class="space-y-3">
            <div v-for="g in bundleGroups" :key="g.id">
              <div class="mb-1 text-xs font-semibold text-stone-500">{{ g.name }}</div>
              <div class="flex flex-wrap gap-2">
                <button v-for="x in g.options.filter((y) => y.active !== false || inBundle(g, y))" :key="x.id" type="button" class="chip" :class="inBundle(g, x) ? 'chip-on' : 'chip-off'" @click="toggleItem(g, x)">{{ x.name }}</button>
              </div>
            </div>
          </div>
        </div>
        <div><label class="label">ชื่อ</label><input v-model="bd.name" class="input" :placeholder="bundleAutoName || 'เช่น สตรอว์เบอร์รี + บลูเบอร์รี'" /></div>
        <div>
          <div class="label">ลดจากราคารวม (บาท) แต่ละขนาด</div>
          <div class="space-y-2">
            <div v-for="sz in sizeOpts" :key="sz.id" class="flex items-center gap-3">
              <span class="min-w-0 flex-1 text-sm text-stone-700">{{ sz.name }}</span>
              <input v-model="bd.discount[sz.id]" type="number" inputmode="numeric" min="0" class="input w-32 shrink-0" placeholder="0" />
            </div>
          </div>
          <p class="mt-1 text-xs text-stone-400">เค้กชั้น: ลดตามขนาดของแต่ละชั้นที่เลือกครบชุด</p>
        </div>
        <AppSwitch v-model="bd.active" label="ใช้งาน" class="flex" />
        <p v-if="bError" class="text-sm text-rose-600">{{ bError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="bOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveB">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="open" title="เพิ่มกลุ่มตัวเลือก" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อกลุ่ม <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" placeholder="เช่น ลายครีม" /></div>
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
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
