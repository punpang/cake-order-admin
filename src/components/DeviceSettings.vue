<script setup>
// เครื่องพิมพ์และจอลูกค้า (เฉพาะแอป Android) · ค่าเครื่องพิมพ์เก็บในเครื่องนี้ แยกตามส่วนการพิมพ์
import { onMounted, ref } from 'vue'
import AppModal from './AppModal.vue'
import PrintSectionDevice from './PrintSectionDevice.vue'
import { can } from '../data/store'
import { displayCount, showDisplay, hideDisplay } from '../lib/nativeDevices'
import { SECTION_KEYS, SECTION_LABEL } from '../lib/printConfig'

const emit = defineEmits(['close'])
const displays = ref(0)
const msg = ref('')

const errText = (e, fallback) => (e && (e.message || e.errorMessage)) || fallback

async function refresh() {
  try {
    displays.value = await displayCount()
  } catch {
    displays.value = 0
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
      <p class="text-xs text-stone-500">จับคู่เครื่องพิมพ์ในการตั้งค่า Bluetooth ของ Android ก่อน แล้วเลือกจากรายการ · ค่าทั้งหมดเก็บในเครื่องนี้</p>

      <section v-for="s in SECTION_KEYS" :key="s" class="space-y-3">
        <h3 class="font-semibold text-stone-800">{{ SECTION_LABEL[s] }}</h3>
        <PrintSectionDevice :section="s" />
      </section>

      <section class="space-y-3">
        <h3 class="font-semibold text-stone-800">จอแสดงให้ลูกค้า</h3>
        <p class="text-sm text-stone-600">{{ displays ? `พบจอที่สองที่ต่ออยู่ ${displays} จอ` : 'ยังไม่พบจอที่สองที่ต่ออยู่' }}</p>
        <div class="grid grid-cols-2 gap-2">
          <button type="button" class="btn-primary h-12" :disabled="!displays" @click="openDisplay">เปิดจอลูกค้า</button>
          <button type="button" class="btn-outline h-12" @click="closeDisplay">ปิดจอลูกค้า</button>
        </div>
        <RouterLink v-if="can('manage')" to="/admin/settings/storefront?tab=display" class="inline-flex min-h-10 items-center text-sm text-brand-700 underline" @click="emit('close')">ตั้งค่าสื่อโฆษณาบนจอลูกค้า (รูป/วิดีโอตอนว่าง)</RouterLink>
      </section>

      <p v-if="msg" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" role="status">{{ msg }}</p>
    </div>
  </AppModal>
</template>
