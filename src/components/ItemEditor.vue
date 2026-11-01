<script setup>
import { computed, reactive, ref, toRaw } from 'vue'
import { db } from '../data/store'
import { calcUnitPrice } from '../lib/pricing'
import { money } from '../lib/format'
import AppModal from './AppModal.vue'
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
</script>

<template>
  <AppModal :title="item ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" wide @close="emit('close')">
    <div class="mb-4 grid grid-cols-2 gap-2 rounded-xl bg-stone-100 p-1">
      <button
        v-for="k in [{ v: 'ready', t: 'เค้กสำเร็จ' }, { v: 'custom', t: 'สั่งทำ' }]"
        :key="k.v"
        type="button"
        class="rounded-lg py-2 text-sm font-medium"
        :class="form.kind === k.v ? 'bg-white shadow-sm' : 'text-stone-500'"
        @click="setKind(k.v)"
      >
        {{ k.t }}
      </button>
    </div>

    <div v-if="form.kind === 'ready'" class="mb-4">
      <div class="label">เลือกเค้ก <span class="text-rose-500">*</span></div>
      <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <button
          v-for="p in products"
          :key="p.id"
          type="button"
          class="flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm"
          :class="form.productId === p.id ? 'border-rose-400 bg-rose-50' : 'border-stone-300 hover:bg-stone-50'"
          @click="form.productId = p.id"
        >
          <span>{{ p.name }} <span class="text-stone-400">· {{ p.pounds }} ปอนด์</span></span>
          <span class="font-medium">{{ money(p.price) }}</span>
        </button>
      </div>
      <p v-if="errors.product" class="mt-1 text-sm text-rose-600">{{ errors.product }}</p>
    </div>

    <OptionPicker v-model="form.selections" :groups="groups" :errors="errors" />

    <div class="mt-4">
      <div class="label">รูปตัวอย่าง</div>
      <div class="flex flex-wrap gap-2">
        <div v-for="(src, i) in form.images" :key="src" class="relative">
          <img :src="src" class="h-20 w-20 rounded-lg object-cover" />
          <button type="button" class="absolute -right-2 -top-2 h-6 w-6 rounded-full bg-stone-800 text-xs text-white" @click="form.images.splice(i, 1)">×</button>
        </div>
        <label class="flex h-20 w-20 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-stone-300 text-2xl text-stone-400 hover:bg-stone-50">
          +
          <input type="file" accept="image/*" multiple class="hidden" @change="onImages" />
        </label>
      </div>
    </div>

    <div class="mt-4">
      <div class="label">หมายเหตุ</div>
      <textarea v-model="form.note" rows="2" class="input" placeholder="รายละเอียดเพิ่มเติม" />
    </div>

    <div class="mt-4 w-32">
      <div class="label">จำนวน</div>
      <input v-model.number="form.qty" type="number" min="1" class="input" />
      <p v-if="errors.qty" class="mt-1 text-sm text-rose-600">{{ errors.qty }}</p>
    </div>

    <template #footer>
      <div class="mr-auto self-center text-sm">
        ราคา/ชิ้น <b class="text-base">{{ money(unitPrice) }}</b>
        <span v-if="form.qty > 1" class="text-stone-500"> · รวม {{ money(unitPrice * form.qty) }}</span>
      </div>
      <button class="btn-outline" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary" @click="save">บันทึก</button>
    </template>
  </AppModal>
</template>
