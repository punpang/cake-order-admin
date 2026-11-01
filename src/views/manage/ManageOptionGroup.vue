<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, findGroup, saveGroup, saveOption, saveBundle } from '../../data/store'
import { GROUP_TYPES, APPLIES_TO, PRICE_TYPES } from '../../lib/constants'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import RecipeEditor from '../../components/RecipeEditor.vue'
import SpecialPriceEditor from '../../components/SpecialPriceEditor.vue'

const props = defineProps({ id: { type: String, required: true } })
const group = computed(() => findGroup(props.id))
const isSize = computed(() => group.value?.key === 'size')
const isFace = computed(() => group.value?.key === 'face')
// หน้าเค้ก: เลือกเนื้อเค้ก/ขนาดที่มี
const limitGroups = computed(() => db.optionGroups.filter((x) => x.key === 'flavor' || x.key === 'size'))

const q = ref('')
const inactive = ref(false)
const options = computed(() => {
  const s = q.value.trim().toLowerCase()
  return (group.value?.options || [])
    .filter((o) => inactive.value || o.active !== false)
    .filter((o) => !s || o.name.toLowerCase().includes(s))
})

// ขนาดทั้งหมด (ใช้ตั้งราคาตามขนาด / ส่วนลดบันเดิ้ล)
const sizeOpts = computed(() => (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false))
const priceText = (o) => {
  if (isSize.value) return money(o.price)
  if (o.priceType === 'per_size') return 'ตามขนาด'
  if (!o.price) return 'ไม่บวกเพิ่ม'
  return o.priceType === 'per_pound' ? `+${money(o.price)} / ปอนด์` : `+${money(o.price)}`
}

// ---------- ตั้งค่ากลุ่ม ----------
const gOpen = ref(false)
const g = reactive({ id: null, name: '', type: 'single', required: false, appliesTo: [], placeholder: '', active: true, prepList: false, perTier: false })
const gError = ref('')
function editGroup() {
  const cur = group.value
  Object.assign(g, { id: cur.id, name: cur.name, type: cur.type, required: !!cur.required, appliesTo: [...cur.appliesTo], placeholder: cur.placeholder || '', active: cur.active !== false, prepList: !!cur.prepList, perTier: !!cur.perTier })
  gError.value = ''
  gOpen.value = true
}
function toggleApplies(k) {
  const i = g.appliesTo.indexOf(k)
  if (i >= 0) g.appliesTo.splice(i, 1)
  else g.appliesTo.push(k)
}
async function saveG() {
  if (!g.name.trim()) return (gError.value = 'กรอกชื่อกลุ่ม')
  if (!g.appliesTo.length) return (gError.value = 'เลือกอย่างน้อย 1 ประเภทสินค้า')
  if (!(await confirmDeactivate(db.optionGroups, g, g.name))) return
  saveGroup({ ...g, appliesTo: [...g.appliesTo] })
  gOpen.value = false
}

// ---------- ตัวเลือก ----------
const oOpen = ref(false)
const blank = () => ({ id: null, name: '', price: 0, priceType: 'fixed', pounds: 1, active: true, recipe: [], special: {}, allow: {}, sizePrices: {} })
const o = reactive(blank())
const oError = ref('')
function editOption(opt) {
  Object.assign(o, opt ? { ...blank(), ...opt, recipe: (opt.recipe || []).map((x) => ({ ...x })), special: { ...(opt.special || {}) }, allow: JSON.parse(JSON.stringify(opt.allow || {})), sizePrices: { ...(opt.sizePrices || {}) } } : blank())
  oError.value = ''
  oOpen.value = true
}
// ---------- บันเดิ้ล ----------
const bOpen = ref(false)
const bd = reactive({ id: null, name: '', options: [], discount: {}, active: true })
const bError = ref('')
const bundleAutoName = computed(() => bd.options.map((id) => group.value.options.find((x) => x.id === id)?.name).filter(Boolean).join(' + '))
function editBundle(b) {
  Object.assign(bd, b ? { ...b, options: [...b.options], discount: { ...(b.discount || {}) } } : { id: null, name: '', options: [], discount: {}, active: true })
  bError.value = ''
  bOpen.value = true
}
function toggleBundleOpt(id) {
  const i = bd.options.indexOf(id)
  if (i >= 0) bd.options.splice(i, 1)
  else bd.options.push(id)
}
async function saveB() {
  if (bd.options.length < 2) return (bError.value = 'เลือกอย่างน้อย 2 ตัวเลือก')
  const data = { ...bd, name: bd.name.trim() || bundleAutoName.value }
  if (!(await confirmDeactivate(group.value.bundles || [], data, data.name))) return
  saveBundle(group.value.id, data)
  bOpen.value = false
}

const allowOn = (lg, oid) => !o.allow[lg.id] || o.allow[lg.id].includes(oid)
function toggleAllow(lg, oid) {
  const cur = o.allow[lg.id] ? [...o.allow[lg.id]] : lg.options.map((x) => x.id)
  const i = cur.indexOf(oid)
  if (i >= 0) cur.splice(i, 1)
  else cur.push(oid)
  // เลือกครบทุกตัว = ไม่จำกัด
  if (lg.options.every((x) => cur.includes(x.id))) delete o.allow[lg.id]
  else o.allow[lg.id] = cur
}
async function saveO() {
  if (!o.name.trim()) return (oError.value = 'กรอกชื่อตัวเลือก')
  if (!(o.price >= 0)) return (oError.value = 'ราคาไม่ถูกต้อง')
  if (isSize.value && !(o.pounds > 0)) return (oError.value = 'ขนาดต้องมากกว่า 0')
  const data = { ...o }
  if (isSize.value) data.priceType = 'fixed'
  if (!isFace.value) delete data.allow
  else for (const lg of limitGroups.value) if (data.allow[lg.id] && !data.allow[lg.id].length) return (oError.value = `เลือก${lg.name}อย่างน้อย 1 อย่าง`)
  else delete data.pounds
  if (!(await confirmDeactivate(group.value.options, o, o.name))) return
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
          <span class="shrink-0 text-sm font-semibold" :class="opt.price || opt.priceType === 'per_size' ? 'text-stone-900' : 'text-stone-400'">{{ priceText(opt) }}</span>
        </button>
      </div>

      <!-- บันเดิ้ล (กลุ่มเลือกได้หลายอย่าง) -->
      <section v-if="group.type === 'multi'" class="card mt-4">
        <div class="mb-3 flex items-center justify-between gap-2">
          <div class="text-[15px] font-semibold text-stone-900">บันเดิ้ล <span class="text-xs font-normal text-stone-400">เลือกครบคู่ ลดราคาตามขนาด</span></div>
          <button class="btn-soft h-9 px-3" @click="editBundle(null)"><AppIcon name="plus" :size="16" /> เพิ่ม</button>
        </div>
        <p v-if="!(group.bundles || []).length" class="text-sm text-stone-500">ยังไม่มีบันเดิ้ล</p>
        <div class="space-y-2">
          <button
            v-for="b in group.bundles || []"
            :key="b.id"
            class="flex w-full items-center gap-3 rounded-xl border border-stone-200/70 p-3 text-left hover:border-brand-300"
            :class="b.active === false ? 'opacity-60' : ''"
            @click="editBundle(b)"
          >
            <span class="min-w-0 flex-1 font-medium break-words text-stone-900">{{ b.name }}</span>
            <span class="shrink-0 text-xs text-stone-500">{{ sizeOpts.map((sz) => `${sz.name} −${b.discount?.[sz.id] || 0}`).join(' · ') }}</span>
          </button>
        </div>
      </section>
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
        <AppSwitch v-if="g.appliesTo.includes('custom')" v-model="g.perTier" label="เลือกแยกแต่ละชั้น (เค้กสั่งทำ)" class="flex" />
        <AppSwitch v-if="g.type !== 'text' && !isSize && group.key !== 'flavor'" v-model="g.prepList" label="แสดงในรายการเตรียม (นับเป็นชุด แยกตามขนาด)" class="flex" />
        <p v-if="gError" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ gError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="gOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveG">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal บันเดิ้ล -->
    <AppModal v-if="bOpen" :title="bd.id ? 'แก้ไขบันเดิ้ล' : 'เพิ่มบันเดิ้ล'" @close="bOpen = false">
      <div class="space-y-4">
        <div>
          <div class="label">ตัวเลือกในบันเดิ้ล (อย่างน้อย 2)</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="x in group.options.filter((y) => y.active !== false || bd.options.includes(y.id))" :key="x.id" type="button" class="chip" :class="bd.options.includes(x.id) ? 'chip-on' : 'chip-off'" @click="toggleBundleOpt(x.id)">{{ x.name }}</button>
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
        </div>
        <AppSwitch v-model="bd.active" label="ใช้งาน" class="flex" />
        <p v-if="bError" class="text-sm text-rose-600">{{ bError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="bOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveB">บันทึก</button>
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
            <div class="grid grid-cols-3 gap-2">
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
          <div v-if="o.priceType === 'per_size'">
            <div class="label">ราคาแต่ละขนาด (บาท)</div>
            <div class="space-y-2">
              <div v-for="sz in sizeOpts" :key="sz.id" class="flex items-center gap-3">
                <span class="min-w-0 flex-1 text-sm text-stone-700">{{ sz.name }}</span>
                <input v-model="o.sizePrices[sz.id]" type="number" inputmode="numeric" min="0" class="input w-32 shrink-0" placeholder="0" />
              </div>
            </div>
          </div>
          <div v-else>
            <label class="label">ราคาบวกเพิ่ม (บาท{{ o.priceType === 'per_pound' ? ' / ปอนด์' : '' }})</label>
            <input v-model.number="o.price" type="number" inputmode="numeric" min="0" class="input" />
            <p class="mt-1 text-xs text-stone-400">ใส่ 0 ถ้าไม่บวกเพิ่ม</p>
          </div>
        </template>

        <div v-if="isFace" class="space-y-3">
          <div v-for="lg in limitGroups" :key="lg.id">
            <div class="label">{{ lg.name }}ที่มีสำหรับหน้านี้</div>
            <div class="flex flex-wrap gap-2">
              <button v-for="x in lg.options.filter((y) => y.active !== false || allowOn(lg, y.id))" :key="x.id" type="button" class="chip" :class="allowOn(lg, x.id) ? 'chip-on' : 'chip-off'" @click="toggleAllow(lg, x.id)">{{ x.name }}</button>
            </div>
          </div>
          <p class="text-xs text-stone-400">ที่ไม่เลือกจะไม่แสดงตอนสั่ง</p>
        </div>
        <SpecialPriceEditor v-if="o.priceType !== 'per_size' || isSize" v-model="o.special" :unit="!isSize && o.priceType === 'per_pound' ? 'บาท/ปอนด์' : 'บาท'" />
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
