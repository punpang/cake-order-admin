<script setup>
// ตั้งค่าเครื่องพิมพ์ของหนึ่งส่วน (แอป Android) · ค่าเก็บในเครื่องนี้ · ใช้ทั้งหน้า POS (เครื่องพิมพ์/จอ) และหน้าตั้งค่าการพิมพ์
import { computed, onMounted, ref } from 'vue'
import AppSwitch from './AppSwitch.vue'
import { getDevice, updateDevice, listPrinters } from '../lib/nativeDevices'
import { printTestPage } from '../lib/receiptRaster'
import { WIDTHS, RECEIPT_KEYS, printerFor, autoPrintFor } from '../lib/printConfig'

const props = defineProps({ section: { type: String, required: true } })
const inherit = computed(() => props.section === 'taxInvoice') // ใบกำกับตั้งเป็น "ตามใบเสร็จขาย" ได้
const isReceipt = computed(() => RECEIPT_KEYS.includes(props.section))
const errText = (e, fallback) => (e && (e.message || e.errorMessage)) || fallback

const dev = ref(getDevice())
const printers = ref([])
const msg = ref('')
const busy = ref(false)

const chosen = computed(() => dev.value.printers[props.section]?.address || '') // '' = ตามใบเสร็จขาย (ใบกำกับเท่านั้น)
const effective = computed(() => printerFor(dev.value, props.section))
const widthChosen = computed(() => dev.value.widthMm[props.section]) // null = ตามใบเสร็จขาย (ใบกำกับเท่านั้น)
const autoOn = computed({
  get: () => autoPrintFor(dev.value, props.section),
  set: (v) => save((d) => { d.autoPrint[props.section] = v }),
})

function save(fn) {
  dev.value = updateDevice(fn)
}
function pickPrinter(p) {
  save((d) => { d.printers[props.section] = p ? { name: p.name || '', address: p.address } : null })
}
function setWidth(w) {
  save((d) => { d.widthMm[props.section] = w })
}
async function refresh() {
  msg.value = ''
  try {
    printers.value = await listPrinters()
  } catch (e) {
    msg.value = errText(e, 'อ่านรายการเครื่องพิมพ์ไม่ได้')
  }
}
async function testPrint() {
  msg.value = ''
  busy.value = true
  try {
    await printTestPage(props.section)
    msg.value = 'ส่งใบทดสอบไปที่เครื่องพิมพ์แล้ว'
  } catch (e) {
    msg.value = errText(e, 'พิมพ์ทดสอบไม่สำเร็จ')
  } finally {
    busy.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="space-y-3">
    <div class="flex items-center justify-between gap-2">
      <span class="text-sm font-medium text-stone-700">เครื่องพิมพ์</span>
      <button type="button" class="btn-soft h-9 px-3 text-sm" @click="refresh">รีเฟรช</button>
    </div>
    <div class="grid gap-2 sm:grid-cols-2">
      <button
        v-if="inherit"
        type="button"
        class="flex min-h-12 items-center rounded-xl border-2 p-3 text-left text-sm font-medium text-stone-800"
        :class="!chosen ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white'"
        :aria-pressed="!chosen"
        @click="pickPrinter(null)"
      >ใช้เครื่องเดียวกับใบเสร็จขาย</button>
      <button
        v-for="p in printers"
        :key="p.address"
        type="button"
        class="flex min-h-12 items-center justify-between gap-3 rounded-xl border-2 p-3 text-left"
        :class="chosen === p.address ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white'"
        :aria-pressed="chosen === p.address"
        @click="pickPrinter(p)"
      >
        <span class="font-medium text-stone-800">{{ p.name || 'ไม่ระบุชื่อ' }}</span>
        <span class="text-xs text-stone-500">{{ p.address }}</span>
      </button>
    </div>
    <p v-if="!printers.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ยังไม่พบเครื่องพิมพ์ที่จับคู่ไว้ (จับคู่ในการตั้งค่า Bluetooth ของ Android ก่อน)</p>
    <p v-if="inherit && !chosen" class="text-xs text-stone-500">ตอนนี้ใช้: {{ effective ? effective.name || effective.address : 'ยังไม่ได้เลือกเครื่องพิมพ์ใบเสร็จขาย' }}</p>

    <div class="grid gap-2" :class="inherit ? 'grid-cols-3' : 'grid-cols-2'">
      <button
        v-if="inherit"
        type="button"
        class="chip h-11 whitespace-nowrap px-2"
        :class="widthChosen == null ? 'chip-on' : 'chip-off'"
        :aria-pressed="widthChosen == null"
        @click="setWidth(null)"
      >ตามใบเสร็จ</button>
      <button
        v-for="w in WIDTHS"
        :key="w"
        type="button"
        class="chip h-11 whitespace-nowrap px-2"
        :class="widthChosen === w ? 'chip-on' : 'chip-off'"
        :aria-pressed="widthChosen === w"
        @click="setWidth(w)"
      >{{ inherit ? `${w} มม.` : `กระดาษ ${w} มม.` }}</button>
    </div>
    <AppSwitch v-if="isReceipt" v-model="autoOn" label="พิมพ์อัตโนมัติหลังรับเงิน" />

    <button type="button" class="btn-primary h-12 w-full" :disabled="busy || !effective" @click="testPrint">พิมพ์ใบทดสอบ</button>
    <p v-if="msg" class="rounded-xl bg-warning-50 p-3 text-sm text-amber-900" role="status">{{ msg }}</p>
  </div>
</template>
