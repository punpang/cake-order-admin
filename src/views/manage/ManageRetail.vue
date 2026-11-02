<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveRetailItem, addStock, saveModifier, moveItem } from '../../data/store'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// สินค้าหน้าร้าน (POS): ชื่อ หมวด ราคา สต็อก (เว้นว่าง = ไม่นับสต็อก)
const q = ref('')
const inactive = ref(false)
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.retailItems.filter((x) => (inactive.value || x.active !== false) && (!s || x.name.toLowerCase().includes(s) || (x.category || '').toLowerCase().includes(s)))
})
const categories = computed(() => [...new Set(db.retailItems.map((x) => x.category).filter(Boolean))])

const open = ref(false)
const blank = () => ({ id: null, name: '', category: '', price: '', stock: '', active: true, modifierIds: [] })
const form = reactive(blank())
const error = ref('')
function edit(x) {
  Object.assign(form, x ? { ...blank(), ...x, price: String(x.price ?? ''), stock: x.stock == null ? '' : String(x.stock), modifierIds: [...(x.modifierIds || [])] } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อสินค้า')
  if (!(Number(form.price) >= 0) || form.price === '') return (error.value = 'กรอกราคา')
  if (!(await confirmDeactivate(db.retailItems, form, form.name))) return
  saveRetailItem({ ...form })
  open.value = false
}

const toggleMod = (id) => (form.modifierIds = form.modifierIds.includes(id) ? form.modifierIds.filter((x) => x !== id) : [...form.modifierIds, id])
const modName = (id) => db.posModifiers.find((m) => m.id === id)?.name || ''

// ---------- ตัวเลือกสินค้า (กลุ่มกลาง เช่น ความหวาน น้ำแข็ง เพิ่มช็อต) ----------
const mOpen = ref(false)
const mf = reactive({ id: null, name: '', type: 'single', required: false, active: true, options: [] })
const mError = ref('')
function editMod(m) {
  Object.assign(mf, m ? { ...m, options: m.options.map((o) => ({ ...o, price: String(o.price || '') })) } : { id: null, name: '', type: 'single', required: false, active: true, options: [{ id: null, name: '', price: '' }] })
  mError.value = ''
  mOpen.value = true
}
async function saveM() {
  if (!mf.name.trim()) return (mError.value = 'กรอกชื่อกลุ่ม')
  if (!mf.options.some((o) => o.name.trim())) return (mError.value = 'เพิ่มตัวเลือกอย่างน้อย 1 อย่าง')
  if (!(await confirmDeactivate(db.posModifiers, mf, mf.name))) return
  saveModifier({ ...mf, options: mf.options.map((o) => ({ ...o })) })
  mOpen.value = false
}
const usedBy = (id) => db.retailItems.filter((x) => (x.modifierIds || []).includes(id)).length

// เติมสต็อก
const stockOpen = ref(null)
const stockAdd = ref('')
function doAdd() {
  addStock(stockOpen.value, Number(stockAdd.value) || 0)
  stockOpen.value = null
  stockAdd.value = ''
}
</script>

<template>
  <ManageShell v-model:q="q" v-model:inactive="inactive" title="สินค้าหน้าร้าน (POS)" :subtitle="`${list.length} รายการ`" add-label="เพิ่มสินค้า" search-placeholder="ค้นหาชื่อ / หมวด" @add="edit(null)">
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบสินค้า</p>
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <div v-for="x in list" :key="x.id" class="card flex items-center gap-2 p-2" :class="x.active === false ? 'opacity-60' : ''">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left" @click="edit(x)">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ x.name }}</span>
            <span class="block text-xs text-stone-500">{{ x.category || '-' }} · {{ x.stock == null ? 'ไม่นับสต็อก' : `คงเหลือ ${x.stock}` }}</span>
            <span v-if="x.modifierIds?.length" class="block truncate text-xs text-brand-700">ตัวเลือก: {{ x.modifierIds.map(modName).join(', ') }}</span>
          </span>
          <span class="shrink-0 font-semibold text-stone-900">{{ money(x.price) }}</span>
        </button>
        <button v-if="x.stock != null" type="button" class="btn-soft h-9 shrink-0 px-3 text-sm" @click="stockOpen = x; stockAdd = ''"><AppIcon name="plus" :size="14" /> สต็อก</button>
      </div>
    </div>

    <!-- ตัวเลือกสินค้า -->
    <section class="card mt-4">
      <div class="mb-3 flex items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">ตัวเลือกสินค้า <span class="text-xs font-normal text-stone-400">เช่น ความหวาน น้ำแข็ง เพิ่มช็อต</span></div>
        <button type="button" class="btn-soft h-9 px-3" @click="editMod(null)"><AppIcon name="plus" :size="16" /> เพิ่มกลุ่ม</button>
      </div>
      <p v-if="!db.posModifiers.length" class="text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือก</p>
      <div class="space-y-2">
        <div v-for="(m, i) in db.posModifiers" :key="m.id" class="flex gap-1 rounded-xl border border-stone-200 p-1" :class="m.active === false ? 'opacity-60' : ''">
          <button type="button" class="min-w-0 flex-1 rounded-lg p-2 text-left" @click="editMod(m)">
            <span class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium text-stone-900">{{ m.name }}</span>
              <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{{ m.type === 'multi' ? 'หลายอย่าง' : 'เลือก 1' }}</span>
              <span v-if="m.required" class="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">จำเป็น</span>
              <span class="text-xs text-stone-400">ใช้ {{ usedBy(m.id) }} สินค้า</span>
            </span>
            <span class="mt-0.5 block truncate text-xs text-stone-500">{{ m.options.map((o) => o.name + (o.price ? ` +${o.price}` : '')).join(' · ') }}</span>
          </button>
          <span class="flex shrink-0 flex-col justify-center">
            <button type="button" class="flex h-6 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 disabled:opacity-30" :disabled="i === 0" aria-label="เลื่อนขึ้น" @click="moveItem(db.posModifiers, i, -1)">▲</button>
            <button type="button" class="flex h-6 w-7 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 disabled:opacity-30" :disabled="i === db.posModifiers.length - 1" aria-label="เลื่อนลง" @click="moveItem(db.posModifiers, i, 1)">▼</button>
          </span>
        </div>
      </div>
    </section>

    <AppModal v-if="mOpen" :title="mf.id ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก'" @close="mOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อกลุ่ม <span class="text-rose-500">*</span></label><input v-model="mf.name" class="input" placeholder="เช่น ความหวาน" /></div>
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
          <button v-for="t in [{ v: 'single', l: 'เลือกได้ 1 อย่าง' }, { v: 'multi', l: 'เลือกได้หลายอย่าง' }]" :key="t.v" type="button" class="h-9 rounded-lg text-sm font-medium" :class="mf.type === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="mf.type = t.v">{{ t.l }}</button>
        </div>
        <div>
          <div class="label">ตัวเลือก + ราคาบวกเพิ่ม (บาท)</div>
          <div class="space-y-2">
            <div v-for="(o, i) in mf.options" :key="i" class="flex items-center gap-2">
              <input v-model="o.name" class="input min-w-0 flex-1" placeholder="เช่น หวานน้อย" />
              <input v-model="o.price" type="text" v-num.dec class="input w-24 shrink-0" placeholder="0" />
              <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบตัวเลือก" @click="mf.options.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
            </div>
          </div>
          <button type="button" class="btn-soft mt-2 h-9 w-full" @click="mf.options.push({ id: null, name: '', price: '' })"><AppIcon name="plus" :size="16" /> เพิ่มตัวเลือก</button>
          <p class="mt-1 text-xs text-stone-400">กลุ่มที่จำเป็นและเลือกได้ 1 อย่าง จะเลือกตัวแรกไว้ให้อัตโนมัติ</p>
        </div>
        <AppSwitch v-model="mf.required" label="จำเป็นต้องเลือก" class="flex" />
        <AppSwitch v-model="mf.active" label="ใช้งาน" class="flex" />
        <p v-if="mError" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ mError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="mOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveM">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" /></div>
        <div>
          <label class="label">หมวด</label>
          <input v-model="form.category" class="input" list="retail-cats" placeholder="เช่น เค้กชิ้น, เครื่องดื่ม" />
          <datalist id="retail-cats"><option v-for="c in categories" :key="c" :value="c" /></datalist>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="label">ราคา (บาท) <span class="text-rose-500">*</span></label><input v-model="form.price" type="text" v-num.dec class="input" /></div>
          <div><label class="label">สต็อก</label><input v-model="form.stock" type="text" v-num class="input" placeholder="ไม่นับ" /></div>
        </div>
        <p class="text-xs text-stone-400">สต็อกเว้นว่าง = ไม่นับสต็อก (เช่น เครื่องดื่มชงสด) · ขายใน POS แล้วตัดสต็อกอัตโนมัติ</p>
        <div>
          <div class="label">ตัวเลือกสินค้า</div>
          <div v-if="db.posModifiers.length" class="flex flex-wrap gap-1.5">
            <button v-for="m in db.posModifiers.filter((y) => y.active !== false || form.modifierIds.includes(y.id))" :key="m.id" type="button" class="chip" :class="form.modifierIds.includes(m.id) ? 'chip-on' : 'chip-off'" @click="toggleMod(m.id)">{{ m.name }}</button>
          </div>
          <p v-else class="text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือก (เพิ่มได้ในการ์ด "ตัวเลือกสินค้า")</p>
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน (แสดงใน POS)" />
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="stockOpen" :title="`เติมสต็อก: ${stockOpen.name}`" @close="stockOpen = null">
      <p class="mb-2 text-sm text-stone-600">คงเหลือ {{ stockOpen.stock }}</p>
      <label class="label">เพิ่ม (ชิ้น)</label>
      <input v-model="stockAdd" type="text" v-num class="input text-lg font-semibold" />
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="stockOpen = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!Number(stockAdd)" @click="doAdd">เติม</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
