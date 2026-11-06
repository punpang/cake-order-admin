<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { openOrderLink } from '../../data/store'
import { LINK_ERROR } from '../../lib/orderLink'
import { STATUS } from '../../lib/constants'
import { money, dateOnly, dateTime } from '../../lib/format'
import StatusBadge from '../../components/StatusBadge.vue'
import AppIcon from '../../components/AppIcon.vue'

// หน้าดูออร์เดอร์ด้วยลิงก์ (สาธารณะ ดูอย่างเดียว) · ไม่ส่ง referrer, ห้ามดัชนี
const route = useRoute()
const res = ref(null)
const metas = []
function meta(name, content) {
  const m = document.createElement('meta')
  m.name = name
  m.content = content
  document.head.appendChild(m)
  metas.push(m)
}
onMounted(() => {
  meta('referrer', 'no-referrer')
  meta('robots', 'noindex, nofollow')
  res.value = openOrderLink(String(route.params.token || ''))
})
onBeforeUnmount(() => metas.forEach((m) => m.remove()))
const o = computed(() => res.value?.order)
</script>

<template>
  <div class="mx-auto max-w-xl px-4 py-6">
    <div v-if="!res" class="py-16 text-center text-stone-400">กำลังโหลด…</div>
    <div v-else-if="res.error" class="card py-12 text-center">
      <AppIcon name="alert" :size="28" class="mx-auto text-stone-300" />
      <p class="mt-3 font-medium text-stone-700">{{ res.error || LINK_ERROR }}</p>
      <p class="mt-1 text-sm text-stone-500">ขอลิงก์ใหม่ได้จากร้าน</p>
    </div>
    <template v-else>
      <div class="mb-3 flex items-start justify-between gap-3">
        <div>
          <div class="text-xs text-stone-500">ออร์เดอร์</div>
          <h1 class="text-xl font-bold text-stone-900">{{ o.code }}</h1>
          <div v-if="o.customer" class="text-sm text-stone-500">{{ o.customer.name }}<span v-if="o.customer.phone"> · {{ o.customer.phone }}</span></div>
        </div>
        <StatusBadge :status="o.status" />
      </div>

      <div class="card mb-3 text-sm">
        <div class="text-xs text-stone-500">นัด{{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
        <div class="font-semibold text-stone-900">{{ dateTime(o.pickupAt) }}</div>
        <div class="mt-1 text-xs text-stone-400">สร้างเมื่อ {{ dateOnly(o.createdAt) }}</div>
      </div>

      <div class="card mb-3 space-y-2 text-sm">
        <div v-for="(it, i) in o.items" :key="i">
          <div class="flex justify-between gap-3"><span class="font-medium text-stone-800">{{ it.name }} × {{ it.qty }}</span><span class="shrink-0">{{ money(it.unitPrice * it.qty) }}</span></div>
          <div v-for="(d, j) in it.lines" :key="j" class="text-xs text-stone-500">{{ d.group }}: {{ d.value }}</div>
        </div>
      </div>

      <div class="card space-y-1 text-sm">
        <div v-if="o.discountTotal" class="flex justify-between text-stone-500"><span>ส่วนลดรวม</span><span>-{{ money(o.discountTotal) }}</span></div>
        <div class="flex justify-between"><span>ยอดรวม</span><b>{{ money(o.total) }}</b></div>
        <div v-if="o.vatMode" class="flex justify-between text-xs text-stone-500"><span>{{ o.vatMode === 'exclusive' ? `รวม VAT ${o.vatRate}% (บวกเพิ่ม)` : `รวม VAT ${o.vatRate}% แล้ว` }}</span><span>{{ money(o.vat) }}</span></div>
        <div v-for="(r, i) in o.refunds" :key="'rf' + i" class="flex justify-between text-xs text-rose-600"><span>คืนเงิน · {{ r.label }}</span><span>{{ money(r.amount) }}</span></div>
        <div class="flex justify-between"><span>ชำระแล้ว</span><span>{{ money(o.paid) }}</span></div>
        <div v-if="o.status !== 'cancelled'" class="flex justify-between" :class="o.balance > 0 ? 'text-amber-700' : 'text-emerald-700'"><span>คงค้าง</span><b>{{ money(o.balance) }}</b></div>
      </div>
      <p class="mt-4 text-center text-xs text-stone-400">หน้านี้ดูอย่างเดียว · ลิงก์จะหมดอายุเมื่อไม่ได้เปิดดูเกินกำหนด</p>
    </template>
  </div>
</template>
