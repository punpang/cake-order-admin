<script setup>
import MoneyInput from './MoneyInput.vue'
import { computed, watch } from 'vue'
import { db, findCustomer, suggestShipping } from '../data/store'
import { checkMapUrl, LIMITS } from '../lib/delivery'
import { money } from '../lib/format'
import AppIcon from './AppIcon.vue'

// ช่องข้อมูลจัดส่ง: ชื่อสถานที่ · ที่อยู่ · url แผนที่ · รายละเอียด · ระยะทาง · ค่าส่ง (ลูกค้าออก) + ชิปสถานที่ที่ลูกค้าเคยใช้
// form = object ที่มี placeName, address, mapUrl, detail, distanceKm, shippingFee, feeManual (แก้ค่าในนี้โดยตรง)
const props = defineProps({ form: { type: Object, required: true }, customerId: { type: String, default: null } })

const places = computed(() => findCustomer(props.customerId)?.places || [])
const cfg = computed(() => db.shop.delivery)
const url = computed(() => checkMapUrl(props.form.mapUrl))
const suggested = computed(() => (props.form.distanceKm === '' || props.form.distanceKm == null ? null : suggestShipping(props.form.distanceKm)))

function usePlace(p) {
  Object.assign(props.form, { placeName: p.name || '', address: p.address, mapUrl: p.mapUrl || '', detail: p.detail || '', distanceKm: p.distanceKm ?? '', feeManual: false })
  applyAuto()
}
// ค่าส่งอัตโนมัติจากระยะทาง (เมื่อพนักงานยังไม่แก้ค่าส่งเอง)
function applyAuto() {
  if (!props.form.feeManual && suggested.value != null) props.form.shippingFee = suggested.value
}
watch(() => props.form.distanceKm, applyAuto)
function calc() {
  if (suggested.value == null) return
  props.form.shippingFee = suggested.value
  props.form.feeManual = false
}
const onFee = () => (props.form.feeManual = true)
</script>

<template>
  <div class="space-y-3">
    <div v-if="places.length">
      <div class="label">สถานที่ที่เคยส่ง</div>
      <div class="flex flex-wrap gap-2">
        <button v-for="p in places" :key="p.id" type="button" class="chip chip-off max-w-full" :aria-label="`ใช้สถานที่ ${p.name || p.address}`" @click="usePlace(p)">
          <AppIcon name="pin" :size="14" /> <span class="truncate">{{ p.name || p.address }}</span>
        </button>
      </div>
    </div>
    <div><label class="label">ชื่อสถานที่ <span class="font-normal text-stone-400">(เช่น บ้าน / ที่ทำงาน)</span></label><input v-model="form.placeName" class="input" :maxlength="LIMITS.placeName" /></div>
    <div><label class="label">ที่อยู่จัดส่ง <span class="text-danger-700">*</span></label><textarea v-model="form.address" rows="2" class="input" :maxlength="LIMITS.address" /></div>
    <div>
      <label class="label">url แผนที่ <span class="font-normal text-stone-400">(ไม่บังคับ · https เท่านั้น)</span></label>
      <input v-model="form.mapUrl" type="url" inputmode="url" class="input" placeholder="https://maps.app.goo.gl/…" :maxlength="LIMITS.url" />
      <p v-if="url.error" class="mt-1 text-xs text-danger-700">{{ url.error }}</p>
      <p v-else-if="url.host" class="mt-1 text-xs text-stone-500">ลิงก์ไปยัง {{ url.host }}</p>
    </div>
    <div><label class="label">รายละเอียด <span class="font-normal text-stone-400">(ทางเข้า / ฝากไว้ / เบอร์ผู้รับ)</span></label><textarea v-model="form.detail" rows="2" class="input" :maxlength="LIMITS.detail" /></div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">ระยะทาง (กม.)</label><MoneyInput v-model.number="form.distanceKm" min="0" class="input" aria-label="ระยะทาง กิโลเมตร" /></div>
      <div><label class="label">ค่าส่ง (ลูกค้าออก) บาท</label><MoneyInput v-model.number="form.shippingFee" min="0" class="input" aria-label="ค่าส่ง" @input="onFee" /></div>
    </div>
    <div v-if="cfg.enabled" class="flex flex-wrap items-center gap-2 text-xs text-stone-500">
      <span>เรต: ฟรี {{ cfg.freeKm }} กม. แล้ว {{ cfg.perKm }} บาท/กม.<template v-if="cfg.minFee"> ขั้นต่ำ {{ money(cfg.minFee) }}</template></span>
      <button v-if="suggested != null" type="button" class="chip chip-off" @click="calc">คิดค่าส่งจากระยะทาง = {{ money(suggested) }}</button>
      <span v-if="form.feeManual" class="rounded-full bg-warning-50 px-2 py-0.5 text-warning-700">แก้ค่าส่งเอง</span>
    </div>
  </div>
</template>
