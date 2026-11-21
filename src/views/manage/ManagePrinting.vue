<script setup>
// การพิมพ์แยกตามส่วน · แอป = เครื่องพิมพ์ Bluetooth ของเครื่องนี้ · เว็บ = กล่องพิมพ์ของเบราว์เซอร์ · จำนวนชุดเป็นค่าของร้าน
import { computed, nextTick, ref } from 'vue'
import { db } from '../../data/store'
import { isNative, getDevice, updateDevice } from '../../lib/nativeDevices'
import { SECTION_KEYS, SECTION_LABEL, RECEIPT_KEYS, WIDTHS, webWidthFor, normalizePrinting } from '../../lib/printConfig'
import ManageShell from '../../components/ManageShell.vue'
import SectionTabs from '../../components/SectionTabs.vue'
import PrintSectionDevice from '../../components/PrintSectionDevice.vue'
import AppIcon from '../../components/AppIcon.vue'

const native = isNative()
const TAB_LABEL = { posReceipt: 'ใบเสร็จ POS', orderReceipt: 'ใบเสร็จออเดอร์', taxInvoice: 'ใบกำกับภาษี' }
const tab = ref('posReceipt')
const tabs = SECTION_KEYS.map((key) => ({ key, label: TAB_LABEL[key] }))
const isReceipt = (s) => RECEIPT_KEYS.includes(s)

const dev = ref(getDevice())
const copies = computed(() => normalizePrinting(db.printing).copies)
function setCopies(s, n) {
  db.printing.copies = { ...copies.value, [s]: n }
}
function setWebWidth(s, w) {
  dev.value = updateDevice((d) => { d.webWidth[s] = w })
}

// ทดสอบพิมพ์บนเว็บ: เปิดกล่องพิมพ์ด้วยแผ่นทดสอบ (.print-test-sheet) ตามกระดาษของส่วนนั้น
const testKey = ref('posReceipt')
const sheetClass = computed(() => (testKey.value === 'taxInvoice' ? 'sheet-a4' : `paper-${webWidthFor(dev.value, testKey.value)}`))
const sheetPaperText = computed(() => {
  if (testKey.value === 'taxInvoice') return 'กระดาษ A4'
  const w = webWidthFor(dev.value, testKey.value)
  return w === 'auto' ? 'กระดาษตามไดรเวอร์' : `กระดาษ ${w} มม.`
})
function webTest(s) {
  testKey.value = s
  nextTick(() => {
    document.body.classList.add('print-test')
    const done = () => { document.body.classList.remove('print-test'); window.removeEventListener('afterprint', done) }
    window.addEventListener('afterprint', done)
    setTimeout(() => window.print(), 50)
  })
}
</script>

<template>
  <ManageShell narrow guard title="การพิมพ์" subtitle="เครื่องพิมพ์และกระดาษแยกตามส่วน" :toolbar="false">
    <div class="mb-3 flex gap-2 rounded-2xl bg-sky-50 p-3 text-sm text-sky-900">
      <AppIcon name="printer" :size="18" class="mt-0.5 shrink-0" />
      <p>{{ native ? 'ตอนนี้เป็นแอป: เครื่องพิมพ์และความกว้างกระดาษที่ตั้งด้านล่างเก็บในเครื่องนี้' : 'ตอนนี้เป็นเว็บ: ความกว้างสลิปที่ตั้งด้านล่างเก็บในเบราว์เซอร์ของเครื่องนี้ · เลือกเครื่องพิมพ์ในกล่องพิมพ์ทุกครั้ง' }} จำนวนชุดเป็นค่าของร้านทุกเครื่อง</p>
    </div>

    <SectionTabs v-model="tab" :tabs="tabs" label="ส่วนการพิมพ์" />

    <template v-for="s in SECTION_KEYS" :key="s">
      <section v-show="tab === s" class="card space-y-4">
        <div class="card-title">{{ SECTION_LABEL[s] }}</div>

        <PrintSectionDevice v-if="native" :section="s" />
        <div v-else-if="isReceipt(s)" class="space-y-3">
          <div class="text-sm font-medium text-stone-700">ความกว้างสลิป (เครื่องนี้)</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="w in ['auto', ...WIDTHS]"
              :key="String(w)"
              type="button"
              class="chip h-11 whitespace-nowrap px-2"
              :class="webWidthFor(dev, s) === w ? 'chip-on' : 'chip-off'"
              :aria-pressed="webWidthFor(dev, s) === w"
              @click="setWebWidth(s, w)"
            >{{ w === 'auto' ? 'ตามไดรเวอร์' : `${w} มม.` }}</button>
          </div>
          <button type="button" class="btn-primary h-12 w-full" @click="webTest(s)">พิมพ์ใบทดสอบ</button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-stone-600">ใบกำกับพิมพ์ A4 ผ่านกล่องพิมพ์ของเบราว์เซอร์ (ไม่มีตัวเลือกขนาดในหน้านี้)</p>
          <button type="button" class="btn-primary h-12 w-full" @click="webTest(s)">พิมพ์ใบทดสอบ A4</button>
        </div>

        <div v-if="isReceipt(s)" class="space-y-2 border-t border-stone-200 pt-4">
          <div class="text-sm font-medium text-stone-700">จำนวนชุดต่อครั้ง (ทั้งร้าน)</div>
          <div class="grid grid-cols-3 gap-2">
            <button
              v-for="n in [1, 2, 3]"
              :key="n"
              type="button"
              class="chip h-11"
              :class="copies[s] === n ? 'chip-on' : 'chip-off'"
              :aria-pressed="copies[s] === n"
              @click="setCopies(s, n)"
            >{{ n }} ชุด</button>
          </div>
          <p class="text-xs text-stone-500">ชุดที่ 2 ขึ้นไปไม่พิมพ์ QR ลุ้นโชค · ใช้กับการพิมพ์ผ่าน Bluetooth ของแอป (บนเว็บใช้จำนวนสำเนาในกล่องพิมพ์)</p>
        </div>
      </section>
    </template>

    <p class="mt-4 text-xs text-stone-500">ใบกำกับที่ลูกค้าพิมพ์เองจากหน้าลูกค้า และรายงานบัญชี/ภาษีประจำปี พิมพ์ผ่านกล่องพิมพ์ของเบราว์เซอร์ จึงไม่มีตัวเลือกในหน้านี้</p>

    <Teleport to="body">
      <div class="print-test-sheet hidden text-black" :class="sheetClass" aria-hidden="true">
        <div class="text-center text-base font-bold">ทดสอบเครื่องพิมพ์</div>
        <div class="text-center">{{ SECTION_LABEL[testKey] }}</div>
        <div class="text-center text-xs">{{ sheetPaperText }}</div>
      </div>
    </Teleport>
  </ManageShell>
</template>
