<script setup>
import { computed, reactive, ref, toRaw } from 'vue'
import { db } from '../data/store'
import { calcUnitPrice } from '../lib/pricing'
import { money } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import OptionPicker from './OptionPicker.vue'

const props = defineProps({ item: { type: Object, default: null } })
const emit = defineEmits(['save', 'close'])

const blank = () => ({ id: `i${Date.now()}`, kind: 'ready', productId: null, name: '', qty: 1, note: '', images: [], selections: {} })
const form = reactive(props.item ? JSON.parse(JSON.stringify(toRaw(props.item))) : blank())
const errors = ref({})

const groups = computed(() => db.optionGroups.filter((g) => g.appliesTo.includes(form.kind)))
const products = computed(() => db.products.filter((p) => p.active))
const unitPrice = computed(() => calcUnitPrice(form, db.optionGroups, db.products))

function setKind(k) {
  if (form.kind === k) return
  form.kind = k
  form.productId = null
  form.selections = {}
  errors.value = {}
}

function onImages(e) {
  for (const f of e.target.files) form.images.push(URL.createObjectURL(f))
  e.target.value = ''
}

function save() {
  const err = {}
  if (form.kind === 'ready' && !form.productId) err.product = 'เลือกเค้ก'
  for (const g of groups.value) {
    if (g.required && (form.selections[g.id] == null || form.selections[g.id] === '')) err[g.id] = `เลือก${g.name}`
  }
  if (!(form.qty >= 1)) err.qty = 'จำนวนอย่างน้อย 1'
  errors.value = err
  if (Object.keys(err).length) return

  // ตัดตัวเลือกของอีกประเภทออก
  const allowed = new Set(groups.value.map((g) => g.id))
  for (const k of Object.keys(form.selections)) if (!allowed.has(k)) delete form.selections[k]

  if (form.kind === 'ready') {
    form.name = db.products.find((p) => p.id === form.productId)?.name || ''
  } else {
    const size = db.optionGroups.find((g) => g.key === 'size')
    const s = size?.options.find((o) => o.id === form.selections[size.id])
    form.name = `เค้กสั่งทำ ${s?.name || ''}`.trim()
  }
  emit('save', { ...JSON.parse(JSON.stringify(toRaw(form))), unitPrice: unitPrice.value })
}

const step = (d) => { form.qty = Math.max(1, (Number(form.qty) || 1) + d) }
</script>

<template>
  <AppModal :title="item ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" wide @close="emit('close')">
    <!-- ประเภท -->
    <div class="mb-4 grid grid-cols-2 gap-1 rounded-2xl bg-stone-100 p-1">
      <button
        v-for="k in [{ v: 'ready', t: 'เค้กสำเร็จ' }, { v: 'custom', t: 'สั่งทำ' }]"
        :key="k.v"
        type="button"
        class="h-10 rounded-xl text-sm font-semibold transition"
        :class="form.kind === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
        @click="setKind(k.v)"
      >
        {{ k.t }}
      </button>
    </div>

    <!-- เค้กสำเร็จ -->
    <div v-if="form.kind === 'ready'" class="mb-3 rounded-2xl border bg-white p-3.5" :class="errors.product ? 'border-rose-300 ring-4 ring-rose-50' : 'border-stone-200/70'">
      <div class="mb-2.5 flex items-baseline gap-2">
        <span class="text-sm font-semibold text-stone-800">เลือกเค้ก</span>
        <span class="text-xs font-medium text-rose-500">จำเป็น</span>
      </div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="p in products"
          :key="p.id"
          type="button"
          class="flex items-center gap-3 rounded-xl border p-3 text-left transition active:scale-[0.99]"
          :class="form.productId === p.id ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500' : 'border-stone-200 hover:border-brand-300'"
          @click="form.productId = p.id"
        >
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg" :class="form.productId === p.id ? 'bg-brand-600 text-white' : 'bg-brand-50 text-brand-600'">
            <AppIcon :name="form.productId === p.id ? 'check' : 'cake'" :size="20" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ p.name }}</span>
            <span class="block text-xs text-stone-500">{{ p.pounds }} ปอนด์</span>
          </span>
          <span class="shrink-0 font-semibold text-stone-900">{{ money(p.price) }}</span>
        </button>
      </div>
      <p v-if="errors.product" class="mt-2 text-sm text-rose-600">{{ errors.product }}</p>
    </div>

    <OptionPicker v-model="form.selections" :groups="groups" :errors="errors" />

    <!-- รูป + หมายเหตุ -->
    <div class="mt-3 rounded-2xl border border-stone-200/70 bg-white p-3.5">
      <div class="mb-2.5 text-sm font-semibold text-stone-800">รูปตัวอย่าง</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="(src, i) in form.images" :key="src" class="relative">
          <img :src="src" class="h-20 w-20 rounded-xl object-cover" />
          <button type="button" class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-900 text-white shadow" aria-label="ลบรูป" @click="form.images.splice(i, 1)">
            <AppIcon name="x" :size="14" />
          </button>
        </div>
        <label class="flex h-20 w-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-stone-200 text-xs text-stone-400 hover:border-brand-300 hover:text-brand-600">
          <AppIcon name="image" :size="20" />
          เพิ่มรูป
          <input type="file" accept="image/*" multiple class="hidden" @change="onImages" />
        </label>
      </div>
      <div class="mt-4">
        <div class="label">หมายเหตุ</div>
        <textarea v-model="form.note" rows="2" class="input" placeholder="รายละเอียดเพิ่มเติม" />
      </div>
    </div>

    <template #footer>
      <div class="flex w-full flex-wrap items-center gap-3">
        <!-- จำนวน -->
        <div class="flex h-11 items-center rounded-xl border border-stone-200">
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="ลด" @click="step(-1)">−</button>
          <input v-model.number="form.qty" type="number" min="1" class="h-full w-10 border-0 bg-transparent text-center text-base font-semibold outline-none" aria-label="จำนวน" />
          <button type="button" class="h-full w-10 text-lg text-stone-600" aria-label="เพิ่ม" @click="step(1)">+</button>
        </div>
        <div class="min-w-0 flex-1 text-right leading-tight">
          <div class="text-xs text-stone-500">{{ form.qty > 1 ? `${money(unitPrice)} × ${form.qty}` : 'ราคา' }}</div>
          <div class="text-lg font-bold text-stone-900">{{ money(unitPrice * (form.qty || 0)) }}</div>
        </div>
        <button class="btn-primary w-full sm:w-auto" @click="save">
          <AppIcon name="check" :size="18" /> บันทึกสินค้า
        </button>
      </div>
      <p v-if="errors.qty || Object.keys(errors).length" class="w-full text-sm text-rose-600">กรอกข้อมูลที่จำเป็นให้ครบ</p>
    </template>
  </AppModal>
</template>
