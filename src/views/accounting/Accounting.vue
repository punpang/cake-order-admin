<script setup>
import { computed, ref } from 'vue'
import { can } from '../../data/store'
import AppIcon from '../../components/AppIcon.vue'
import AcctOverview from './AcctOverview.vue'
import AcctRecord from './AcctRecord.vue'
import AcctJournal from './AcctJournal.vue'
import AcctChart from './AcctChart.vue'
import AcctReports from './AcctReports.vue'
import AcctSettings from './AcctSettings.vue'
import AcctTax from './AcctTax.vue'
import AcctPlan from './AcctPlan.vue'
import AcctAssets from './AcctAssets.vue'
import AcctTaxYear from './AcctTaxYear.vue'

// ระบบบัญชี (หลังบ้าน): ฐานสิทธิ ลงบัญชีคู่ · ข้อมูลรายได้ดึงจากออร์เดอร์/POS อัตโนมัติ + บันทึกเอง
const TABS = [
  { v: 'overview', l: 'ภาพรวม' }, { v: 'record', l: 'บันทึก' }, { v: 'journal', l: 'สมุดรายวัน' }, { v: 'reports', l: 'รายงาน' }, { v: 'tax', l: 'ภาษี' }, { v: 'taxyear', l: 'ภาษีประจำปี' }, { v: 'plan', l: 'ประจำ/ล่วงหน้า/ผ่อน' }, { v: 'assets', l: 'สินทรัพย์' }, { v: 'chart', l: 'ผังบัญชี' }, { v: 'settings', l: 'ปิดงวด/ตั้งค่า' },
]
const tab = ref('overview')
const comp = computed(() => ({ overview: AcctOverview, record: AcctRecord, journal: AcctJournal, reports: AcctReports, tax: AcctTax, taxyear: AcctTaxYear, plan: AcctPlan, assets: AcctAssets, chart: AcctChart, settings: AcctSettings }[tab.value]))
</script>

<template>
  <div v-if="!can('acctView')" class="mx-auto max-w-md pt-10">
    <div class="card flex flex-col items-center gap-3 py-12 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="shield" :size="28" /></span>
      <div class="font-semibold text-stone-800">ไม่มีสิทธิ์เข้าระบบบัญชี</div>
      <RouterLink to="/admin/orders" class="btn-soft">กลับ</RouterLink>
    </div>
  </div>
  <div v-else class="mx-auto max-w-4xl pb-6">
    <div class="mb-3 flex items-center gap-2">
      <RouterLink to="/admin/manage" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-stone-200 bg-white text-stone-700 hover:bg-stone-50" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
      <div class="min-w-0 flex-1"><h1 class="truncate text-xl font-semibold tracking-tight text-stone-900">บัญชี</h1><p class="truncate text-sm text-stone-500">ฐานสิทธิ · ลงบัญชีคู่ · รายได้ดึงจากออร์เดอร์/POS อัตโนมัติ</p></div>
    </div>
    <div class="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none]" role="tablist">
      <button v-for="t in TABS" :key="t.v" type="button" role="tab" :aria-selected="tab === t.v" class="chip whitespace-nowrap" :class="tab === t.v ? 'chip-on' : 'chip-off'" @click="tab = t.v">{{ t.l }}</button>
    </div>
    <component :is="comp" @go="(t) => (tab = t)" />
  </div>
</template>
