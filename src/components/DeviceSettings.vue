<script setup>
// ตั้งค่าเครื่องพิมพ์ใบเสร็จและจอลูกค้า (เฉพาะแอป Android) · ค่าเก็บในเครื่องนี้
import { onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import { getDeviceConfig, setDeviceConfig, listPrinters, displayCount, showDisplay, hideDisplay } from '../lib/nativeDevices'
import { printTestPage } from '../lib/receiptRaster'

const emit = defineEmits(['close'])
const cfg = ref(getDeviceConfig())
const printers = ref([])
const displays = ref(0)
const msg = ref('')
const busy = ref(false)

const errText = (e, fallback) => (e && (e.message || e.errorMessage)) || fallback

async function refresh() {
  msg.value = ''
  try {
    printers.value = await listPrinters()
  } catch (e) {
    msg.value = errText(e, 'อ่านรายการเครื่องพิมพ์ไม่ได้')
  }
  try {
    displays.value = await displayCount()
  } catch {
    displays.value = 0
  }
}

function pick(p) {
  cfg.value = { ...cfg.value, printer: { name: p.name || '', address: p.address } }
  setDeviceConfig({ printer: cfg.value.printer })
}
function setWidth(w) {
  cfg.value = { ...cfg.value, widthMm: w }
  setDeviceConfig({ widthMm: w })
}
async function testPrint() {
  msg.value = ''
  busy.value = true
  try {
    await printTestPage()
    msg.value = 'ส่งใบทดสอบไปที่เครื่องพิมพ์แล้ว'
  } catch (e) {
    msg.value = errText(e, 'พิมพ์ทดสอบไม่สำเร็จ')
  } finally {
    busy.value = false
  }
}
async function openDisplay() {
  msg.value = ''
  try {
    await showDisplay()
    msg.value = 'เปิดจอลูกค้าแล้ว'
  } catch (e) {
    msg.value = errText(e, 'เปิดจอลูกค้าไม่สำเร็จ')
  }
}
async function closeDisplay() {
  msg.value = ''
  try {
    await hideDisplay()
    msg.value = 'ปิดจอลูกค้าแล้ว'
  } catch (e) {
    msg.value = errText(e, 'ปิดจอลูกค้าไม่สำเร็จ')
  }
}

onMounted(refresh)
</script>

<template>
  <AppModal title="เครื่องพิมพ์และจอลูกค้า" @close="emit('close')">
    <div class="space-y-6">
      <section class="space-y-3">
        <div class="flex items-center justify-between gap-2">
          <h3 class="font-semibold text-stone-800">เครื่องพิมพ์ใบเสร็จ (Bluetooth)</h3>
          <button type="button" class="btn-soft h-9 px-3 text-sm" @click="refresh">รีเฟรช</button>
        </div>
        <p class="text-xs text-stone-500">จับคู่เครื่องพิมพ์ในการตั้งค่า Bluetooth ของ Android ก่อน แล้วเลือกจากรายการนี้</p>
        <div v-if="!printers.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ยังไม่พบเครื่องพิมพ์ที่จับคู่ไว้</div>
        <button
          v-for="p in printers"
          :key="p.address"
          type="button"
          class="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border-2 p-3 text-left"
          :class="cfg.printer?.address === p.address ? 'border-brand-500 bg-brand-50' : 'border-stone-200 bg-white'"
          :aria-pressed="cfg.printer?.address === p.address"
          @click="pick(p)"
        >
          <span class="font-medium text-stone-800">{{ p.name || 'ไม่ระบุชื่อ' }}</span>
          <span class="text-xs text-stone-500">{{ p.address }}</span>
        </button>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="w in [58, 80]"
            :key="w"
            type="button"
            class="chip h-11"
            :class="cfg.widthMm === w ? 'chip-on' : 'chip-off'"
            :aria-pressed="cfg.widthMm === w"
            @click="setWidth(w)"
          >กระดาษ {{ w }} มม.</button>
        </div>
        <button type="button" class="btn-primary h-12 w-full" :disabled="busy || !cfg.printer" @click="testPrint">พิมพ์ใบทดสอบ</button>
      </section>

      <section class="space-y-3">
        <h3 class="font-semibold text-stone-800">จอแสดงให้ลูกค้า</h3>
        <p class="text-sm text-stone-600">{{ displays ? `พบจอที่สองที่ต่ออยู่ ${displays} จอ` : 'ยังไม่พบจอที่สองที่ต่ออยู่' }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn-primary h-12" :disabled="!displays" @click="openDisplay">เปิดจอลูกค้า</button>
          <button type="button" class="btn-outline h-12" @click="closeDisplay">ปิดจอลูกค้า</button>
        </div>
      </section>

      <p v-if="msg" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">{{ msg }}</p>
    </div>
  </AppModal>
</template>
