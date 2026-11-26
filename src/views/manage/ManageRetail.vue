<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveRetailItem, addStock, saveModifier, moveItem, createConsignRound, markConsignPaid, can } from '../../data/store'
import { CONSIGN_PAYOUTS, consignTermsError, bkkDay } from '../../lib/consignment'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import ImageUploader from '../../components/ImageUploader.vue'
import RecipeEditor from '../../components/RecipeEditor.vue'
import { allowedBy } from '../../lib/pricing'
import { parcelDimsError, parcelFieldsOf, parcelFormOf } from '../../lib/parcelShipping'

// สินค้า (POS / สินค้าสำเร็จ): ชื่อ หมวด ราคา สต็อก (เว้นว่าง = ไม่นับสต็อก) · รูป สูตร ปักหมุดขายดี · สวิตช์ "แสดงใน POS" แยกจาก "แสดงที่หน้าร้านเว็บ"
const q = ref('')
const inactive = ref(false)
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.retailItems.filter((x) => (inactive.value || x.active !== false) && (!s || x.name.toLowerCase().includes(s) || (x.category || '').toLowerCase().includes(s)))
})
const categories = computed(() => [...new Set(db.retailItems.map((x) => x.category).filter(Boolean))])

const open = ref(false)
const blank = () => ({ id: null, name: '', category: '', price: '', stock: '', weightG: '', dimW: '', dimL: '', dimH: '', active: true, modifierIds: [], images: [], recipe: [], pinned: false, showInPos: true, showOnStore: false, noPoints: false, openPrice: false, consignment: false, consignorName: '', consignPayout: 'percent', consignPercent: '', consignFixed: '', description: '', typeId: null, flavorId: null, sizeId: null })
const form = reactive(blank())
const error = ref('')
function edit(x) {
  Object.assign(form, x ? { ...blank(), ...x, ...parcelFormOf(x), price: String(x.price ?? ''), stock: x.stock == null ? '' : String(x.stock), modifierIds: [...(x.modifierIds || [])], images: [...(x.images || [])], recipe: (x.recipe || []).map((l) => ({ ...l })) } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อสินค้า')
  if (!form.openPrice && (!(Number(form.price) >= 0) || form.price === '')) return (error.value = 'กรอกราคา')
  const ce = consignTermsError(form)
  if (ce) return (error.value = ce)
  const pe = parcelDimsError(form)
  if (pe) return (error.value = pe)
  if (!(await confirmDeactivate(db.retailItems, form, form.name))) return
  const { dimW, dimL, dimH, weightG, ...rest } = form // ค่าฟอร์มขนาด/น้ำหนักแปลงเป็นฟิลด์สินค้าที่บันทึกจริง
  saveRetailItem({ ...rest, ...parcelFieldsOf(form) })
  open.value = false
}

// ---------- สินค้าฝากขาย: สรุปยอดเป็นรอบ ----------
const consignorNames = computed(() => [...new Set(db.retailItems.filter((x) => x.consignment && String(x.consignorName || '').trim()).map((x) => x.consignorName.trim()))])
const consignRounds = computed(() => [...(db.consignRounds || [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)))
const settle = reactive({ consignor: '', from: bkkDay(new Date().toISOString()).slice(0, 8) + '01', to: bkkDay(new Date().toISOString()), error: '' })
function doSettle() {
  settle.error = ''
  const r = createConsignRound({ consignor: settle.consignor || consignorNames.value[0], from: settle.from, to: settle.to })
  if (!r.ok) settle.error = r.error
}
function paid(r) {
  const res = markConsignPaid(r.id)
  if (!res.ok) settle.error = res.error
}

// ข้อมูลเค้ก (ไม่บังคับ): ประเภท/เนื้อ/ขนาด ใช้แสดงประกอบและคิดราคาตัวเลือกตามขนาดตอนสร้างออร์เดอร์ · ราคาสินค้าเป็นราคาคงที่ ไม่คำนวณจากโครงสร้างนี้
const grp = (k) => db.optionGroups.find((g) => g.key === k)
const allow = computed(() => allowedBy(db.optionGroups, form.typeId && grp('type') ? { [grp('type').id]: form.typeId } : {}))
const optsOf = (k) => (grp(k)?.options || []).filter((o) => o.active !== false && (k === 'type' || allow.value(grp(k), o)))
const poundsOf = computed(() => grp('size')?.options.find((o) => o.id === form.sizeId)?.pounds || 0)
function pickCake(f, id) {
  form[f] = form[f] === id ? null : id
  if (f === 'typeId') for (const [ff, k] of [['flavorId', 'flavor'], ['sizeId', 'size']]) if (form[ff] && !optsOf(k).some((o) => o.id === form[ff])) form[ff] = null
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
  if (mf.options.some((o) => o.adjustIngredientId && !(String(o.adjustPct).trim() !== '' && Number(o.adjustPct) >= 0 && Number(o.adjustPct) <= 300))) return (mError.value = 'สัดส่วนวัตถุดิบต้องอยู่ระหว่าง 0–300%')
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
  <ManageShell v-model:q="q" v-model:inactive="inactive" title="สินค้า (POS / สินค้าสำเร็จ)" :subtitle="`${list.length} รายการ`" add-label="เพิ่มสินค้า" search-placeholder="ค้นหาชื่อ / หมวด" @add="edit(null)">
    <!-- สรุปยอดฝากขาย: เลือกผู้ฝากขาย + ช่วงวันที่ → สรุปเป็นรอบ · จ่ายแล้วกดยืนยัน (ล็อกรอบ) -->
    <section v-if="consignorNames.length" class="card mb-3 space-y-3 p-3" aria-label="สรุปยอดฝากขาย">
      <h2 class="font-semibold text-stone-900">สรุปยอดฝากขาย</h2>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <div class="sm:col-span-2"><label class="label" for="cs-consignor">ผู้ฝากขาย</label>
          <select id="cs-consignor" v-model="settle.consignor" class="input"><option v-for="n in consignorNames" :key="n" :value="n">{{ n }}</option></select></div>
        <div><label class="label" for="cs-from">จากวันที่</label><input id="cs-from" v-model="settle.from" type="date" class="input" /></div>
        <div><label class="label" for="cs-to">ถึงวันที่</label><input id="cs-to" v-model="settle.to" type="date" class="input" /></div>
      </div>
      <p v-if="settle.error" class="text-sm text-danger-700">{{ settle.error }}</p>
      <button type="button" class="btn-primary h-10" :disabled="!can('manage')" @click="doSettle">สรุปรอบ</button>
      <ul class="divide-y divide-stone-100" aria-label="รอบที่สรุปแล้ว">
        <li v-for="r in consignRounds" :key="r.id" class="flex flex-wrap items-center gap-2 py-2 text-sm">
          <span class="min-w-0 flex-1">{{ r.consignor }} · {{ r.from }} ถึง {{ r.to }} · ยอดขาย {{ money(r.sales) }} · จ่าย {{ money(r.payout) }} · ร้านได้ {{ money(r.shop) }}</span>
          <span v-if="r.paidAt" class="rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-700">จ่ายแล้ว {{ r.paidAt.slice(0, 10) }} (ล็อก)</span>
          <button v-else type="button" class="btn-outline h-8" :disabled="!can('manage')" @click="paid(r)">ยืนยันจ่ายแล้ว</button>
        </li>
      </ul>
    </section>
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบสินค้า</p>
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
      <div v-for="x in list" :key="x.id" class="card flex items-center gap-2 p-2" :class="x.active === false ? 'opacity-60' : ''">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left" @click="edit(x)">
          <img v-if="x.images?.length" :src="x.images[0]" alt="" loading="lazy" decoding="async" class="h-11 w-11 shrink-0 rounded-xl object-cover" />
          <span class="min-w-0 flex-1">
            <span class="flex flex-wrap items-center gap-1.5">
              <span class="truncate font-medium text-stone-900">{{ x.name }}</span>
              <span v-if="x.pinned" class="shrink-0 rounded-full bg-warning-50 px-1.5 py-0.5 text-xs text-warning-700">ปักหมุด</span>
              <span v-if="x.showInPos === false" class="shrink-0 rounded-full bg-stone-100 px-1.5 py-0.5 text-xs text-stone-500">ซ่อนใน POS</span>
              <span v-if="x.showOnStore" class="shrink-0 rounded-full bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">หน้าร้านเว็บ</span>
            </span>
            <span class="block text-xs text-stone-500">{{ x.category || '-' }} · {{ x.stock == null ? 'ไม่นับสต็อก' : `คงเหลือ ${x.stock}` }}</span>
            <span v-if="x.modifierIds?.length" class="block truncate text-xs text-brand-700">ตัวเลือก: {{ x.modifierIds.map(modName).join(', ') }}</span>
          </span>
          <span class="shrink-0 font-semibold text-stone-900">{{ x.openPrice ? 'ตามตอนขาย' : money(x.price) }}</span>
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
              <span v-if="m.required" class="rounded-full bg-danger-50 px-2 py-0.5 text-xs text-danger-700">จำเป็น</span>
              <span class="text-xs text-stone-400">ใช้ {{ usedBy(m.id) }} สินค้า</span>
            </span>
            <span class="mt-0.5 block truncate text-xs text-stone-500">{{ m.options.map((o) => o.name + (o.price ? ` +${o.price}` : '')).join(' · ') }}</span>
          </button>
          <span class="flex shrink-0 flex-col justify-center">
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 disabled:opacity-30" :disabled="i === 0" aria-label="เลื่อนขึ้น" @click="moveItem(db.posModifiers, i, -1)">▲</button>
            <button type="button" class="flex h-10 w-10 items-center justify-center rounded-md text-stone-400 hover:bg-stone-100 disabled:opacity-30" :disabled="i === db.posModifiers.length - 1" aria-label="เลื่อนลง" @click="moveItem(db.posModifiers, i, 1)">▼</button>
          </span>
        </div>
      </div>
    </section>

    <AppModal v-if="mOpen" split :title="mf.id ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก'" @close="mOpen = false">
      <template #left>
        <div><label class="label">ชื่อกลุ่ม <span class="text-rose-600">*</span></label><input v-model="mf.name" class="input" placeholder="เช่น ความหวาน" /></div>
        <div class="grid grid-cols-2 gap-1 seg-grid">
          <button v-for="t in [{ v: 'single', l: 'เลือกได้ 1 อย่าง' }, { v: 'multi', l: 'เลือกได้หลายอย่าง' }]" :key="t.v" type="button" class="h-9 rounded-lg text-sm font-medium" :class="mf.type === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="mf.type = t.v">{{ t.l }}</button>
        </div>
        <AppSwitch v-model="mf.required" label="จำเป็นต้องเลือก" class="flex" />
        <AppSwitch v-model="mf.active" label="ใช้งาน" class="flex" />
      </template>
      <template #right>
        <div>
          <div class="label">ตัวเลือก + ราคาบวกเพิ่ม (บาท)</div>
          <div class="space-y-2">
            <div v-for="(o, i) in mf.options" :key="i" class="rounded-xl border border-stone-200 p-2">
            <div class="flex items-center gap-2">
              <input v-model="o.name" class="input min-w-0 flex-1" placeholder="เช่น หวานน้อย" />
              <MoneyInput v-model="o.price" class="input w-24 shrink-0" placeholder="0" />
              <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบตัวเลือก" @click="mf.options.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
            </div>
            <div class="mt-2 flex items-center gap-2 text-sm">
              <span class="shrink-0 text-stone-500">ปรับสูตร</span>
              <select v-model="o.adjustIngredientId" class="input min-w-0 flex-1" :aria-label="`วัตถุดิบที่ปรับของ ${o.name || 'ตัวเลือก'}`">
                <option value="">ไม่ปรับ</option>
                <option v-for="m in db.ingredients" :key="m.id" :value="m.id">{{ m.name }}</option>
              </select>
              <input v-if="o.adjustIngredientId" v-model="o.adjustPct" type="text" inputmode="numeric" class="input w-20 shrink-0" placeholder="%" aria-label="สัดส่วน %" />
            </div>
            </div>
          </div>
          <button type="button" class="btn-soft mt-2 h-9 w-full" @click="mf.options.push({ id: null, name: '', price: '' })"><AppIcon name="plus" :size="16" /> เพิ่มตัวเลือก</button>
          <p class="mt-1 text-xs text-stone-400">กลุ่มที่จำเป็นและเลือกได้ 1 อย่าง จะเลือกตัวแรกไว้ให้อัตโนมัติ</p>
        </div>
        <p v-if="mError" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ mError }}</p>
      </template>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="mOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveM">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="open" split :title="form.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" @close="open = false">
      <template #left>
        <div><label class="label">ชื่อ <span class="text-rose-600">*</span></label><input v-model="form.name" class="input" /></div>
        <div>
          <label class="label" for="retail-cat-new">หมวด</label>
          <div v-if="categories.length" class="chip-row mb-2" role="group" aria-label="เลือกหมวดที่มีอยู่">
            <button v-for="c in categories" :key="c" type="button" class="chip" :class="form.category === c ? 'chip-on' : 'chip-off'" :aria-pressed="form.category === c" @click="form.category = c">{{ c }}</button>
          </div>
          <input id="retail-cat-new" v-model="form.category" class="input" placeholder="หรือพิมพ์หมวดใหม่ เช่น เค้กชิ้น" />
          <p class="mt-1 text-xs text-stone-400">กดหมวดที่มีอยู่ หรือพิมพ์ชื่อใหม่ได้เลย</p>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="label">ราคา (บาท) <span v-if="!form.openPrice" class="text-rose-600">*</span></label><MoneyInput v-model="form.price" class="input" /></div>
          <div><label class="label">สต็อก</label><input v-model="form.stock" type="text" v-num class="input" placeholder="ไม่นับ" /></div>
        </div>
        <p class="text-xs text-stone-400">สต็อกเว้นว่าง = ไม่นับสต็อก (เช่น เครื่องดื่มชงสด) · ขายใน POS แล้วตัดสต็อกอัตโนมัติ</p>
        <div>
          <div class="label">สำหรับส่งพัสดุ (ไม่บังคับ)</div>
          <div class="grid grid-cols-2 gap-3">
            <div class="col-span-2"><label class="label" for="rt-weight">น้ำหนัก (กรัม)</label><input id="rt-weight" v-model="form.weightG" type="text" inputmode="numeric" class="input" placeholder="เช่น 800" /></div>
            <div><label class="label" for="rt-dimw">กว้าง (ซม.)</label><input id="rt-dimw" v-model="form.dimW" type="text" inputmode="decimal" class="input" /></div>
            <div><label class="label" for="rt-diml">ยาว (ซม.)</label><input id="rt-diml" v-model="form.dimL" type="text" inputmode="decimal" class="input" /></div>
            <div class="col-span-2"><label class="label" for="rt-dimh">สูง (ซม.)</label><input id="rt-dimh" v-model="form.dimH" type="text" inputmode="decimal" class="input" /></div>
          </div>
          <p class="mt-1 text-xs text-stone-400">กรอกให้ครบทั้งน้ำหนักและขนาด หรือเว้นว่างทั้งหมด · สินค้าที่ไม่กรอกจะใช้ในแคมเปญส่งพัสดุไม่ได้</p>
        </div>
        <div><label class="label">คำอธิบาย (แสดงหน้าร้านเว็บ)</label><textarea v-model="form.description" rows="2" maxlength="300" class="input"></textarea></div>
        <div>
          <div class="label">รูปสินค้า (แสดงหน้าร้านเว็บ)</div>
          <ImageUploader v-model="form.images" :max="6" />
        </div>
      </template>
      <template #right>
        <details class="rounded-xl bg-stone-50 p-3">
          <summary class="cursor-pointer py-2 text-sm font-medium text-stone-700">ข้อมูลเค้ก (ไม่บังคับ) — ประเภท / เนื้อ / ขนาด</summary>
          <p class="mt-1 text-xs text-stone-400">ใช้แสดงประกอบ แนะนำสินค้า และคิดราคาตัวเลือกตามขนาด · ราคาสินค้าเป็นราคาคงที่ที่กรอกด้านบน</p>
          <div v-for="m in [{ k: 'type', f: 'typeId' }, { k: 'flavor', f: 'flavorId' }, { k: 'size', f: 'sizeId' }]" :key="m.k" class="mt-2">
            <div class="mb-1 text-xs font-medium text-stone-500">{{ grp(m.k)?.name }}</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="o in optsOf(m.k)" :key="o.id" type="button" class="chip" :class="form[m.f] === o.id ? 'chip-on' : 'chip-off'" @click="pickCake(m.f, o.id)">{{ o.name }}</button>
            </div>
          </div>
        </details>
        <div>
          <div class="label">ตัวเลือกสินค้า</div>
          <div v-if="db.posModifiers.length" class="flex flex-wrap gap-1.5">
            <button v-for="m in db.posModifiers.filter((y) => y.active !== false || form.modifierIds.includes(y.id))" :key="m.id" type="button" class="chip" :class="form.modifierIds.includes(m.id) ? 'chip-on' : 'chip-off'" @click="toggleMod(m.id)">{{ m.name }}</button>
          </div>
          <p v-else class="text-sm text-stone-500">ยังไม่มีกลุ่มตัวเลือก (เพิ่มได้ในการ์ด "ตัวเลือกสินค้า")</p>
        </div>
        <RecipeEditor v-model="form.recipe" :pounds="poundsOf" :price="Number(form.price) || 0" />
        <div class="space-y-1 rounded-xl border border-stone-200 p-2">
          <AppSwitch v-model="form.active" label="ใช้งาน (ปิด = ไม่แสดงทุกที่)" class="flex" />
          <div class="my-1 border-t border-stone-200" role="separator"></div>
          <AppSwitch v-model="form.showInPos" label="แสดงใน POS และตอนสร้างออร์เดอร์/แชท" class="flex" />
          <AppSwitch v-model="form.showOnStore" label="แสดงที่หน้าร้านเว็บ (ลูกค้าเห็น)" class="flex" />
          <AppSwitch v-model="form.pinned" label="ปักหมุดในสินค้าขายดีของหน้าร้านเว็บ" class="flex" />
          <AppSwitch v-model="form.openPrice" label="ไม่กำหนดราคา (ผู้ขายกรอกราคาตอนขายที่ POS · ไม่ขายผ่านเว็บ)" class="flex" />
          <AppSwitch v-model="form.consignment" label="สินค้าฝากขาย (ของผู้อื่นวางขายให้ร้าน)" class="flex" />
          <div v-if="form.consignment" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div><label class="label" for="cs-name">ชื่อผู้ฝากขาย <span class="text-rose-600">*</span></label><input id="cs-name" v-model="form.consignorName" class="input" maxlength="120" /></div>
            <div><label class="label" for="cs-payout">วิธีจ่ายผู้ฝากขาย</label>
              <select id="cs-payout" v-model="form.consignPayout" class="input"><option v-for="p in CONSIGN_PAYOUTS" :key="p.v" :value="p.v">{{ p.l }}</option></select></div>
            <div v-if="form.consignPayout !== 'fixed'"><label class="label" for="cs-pct">ส่วนแบ่งผู้ฝากขาย (%)</label><MoneyInput id="cs-pct" v-model="form.consignPercent" class="input" /></div>
            <div v-else><label class="label" for="cs-fixed">ค่าคงที่ต่อรอบ (บาท)</label><MoneyInput id="cs-fixed" v-model="form.consignFixed" class="input" /></div>
          </div>
          <AppSwitch v-model="form.noPoints" label="ไม่คำนวณแต้ม (ใช้คูปองส่วนลดไม่ได้ทุกแบบ · ไม่นับยอดสมาชิก)" class="flex" />
        </div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </template>
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
