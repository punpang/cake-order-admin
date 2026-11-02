<script setup>
import { computed } from 'vue'
import { db, findCustomer } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime } from '../lib/format'

// ใบเสร็จหน้าร้าน (พิมพ์ 80mm ด้วย window.print — ดู .receipt-print ใน style.css)
const props = defineProps({ order: { type: Object, required: true } })
const t = computed(() => orderTotals(props.order))
const pay = computed(() => props.order.payments.find((p) => p.status === 'confirmed'))
const customer = computed(() => findCustomer(props.order.customerId))
</script>

<template>
  <div class="receipt-print mx-auto w-full max-w-[80mm] bg-white p-3 font-mono text-[13px] leading-snug text-black">
    <div class="text-center">
      <div class="text-base font-bold">{{ db.shop.name }}</div>
      <div>ใบเสร็จรับเงิน</div>
      <div class="text-xs">{{ order.code }} · {{ dateTime(order.createdAt) }}</div>
      <div v-if="order.status === 'cancelled'" class="mt-1 font-bold">** ยกเลิกแล้ว **</div>
    </div>
    <div class="my-2 border-t border-dashed border-black" />
    <div v-for="it in order.items" :key="it.id" class="flex justify-between gap-2">
      <span class="min-w-0 break-words">{{ it.qty }} × {{ it.name }}<span v-if="it.mods?.length" class="block pl-4 text-xs">{{ it.mods.map((m) => m.name + (m.price ? ` +${m.price}` : '')).join(' · ') }}</span></span>
      <span class="shrink-0">{{ money((it.fullPrice ?? it.unitPrice) * it.qty) }}</span>
    </div>
    <div class="my-2 border-t border-dashed border-black" />
    <div class="flex justify-between"><span>รวม</span><span>{{ money(t.full) }}</span></div>
    <div v-for="l in t.discountLines" :key="l.label" class="flex justify-between gap-2"><span class="min-w-0 break-words">{{ l.label }}</span><span class="shrink-0">−{{ money(l.amount) }}</span></div>
    <div class="mt-1 flex justify-between text-base font-bold"><span>ยอดสุทธิ</span><span>{{ money(t.total) }}</span></div>
    <template v-if="pay">
      <div class="flex justify-between"><span>{{ pay.method }}</span><span>{{ money(pay.received ?? pay.amount) }}</span></div>
      <div v-if="pay.change" class="flex justify-between"><span>เงินทอน</span><span>{{ money(pay.change) }}</span></div>
    </template>
    <template v-if="customer">
      <div class="my-2 border-t border-dashed border-black" />
      <div>สมาชิก: {{ customer.name }}</div>
      <div v-if="order.loyalty?.points">ได้รับ {{ order.loyalty.points }} คะแนน</div>
    </template>
    <div class="mt-3 text-center text-xs">ขอบคุณที่อุดหนุนค่ะ</div>
  </div>
</template>
