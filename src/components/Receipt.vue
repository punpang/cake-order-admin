<script setup>
import { orderNo } from '../lib/format'
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { db, findCustomer, customerPoints } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime } from '../lib/format'

// ใบเสร็จหน้าร้าน (พิมพ์ 80mm ด้วย window.print — ดู .receipt-print ใน style.css)
const props = defineProps({ order: { type: Object, required: true }, luckyUrl: { type: String, default: '' } })
// QR ลุ้นโชคท้ายบิล (ถ้ามี) แสดงเป็นรูปในใบเสร็จ
const luckyQr = ref('')
watch(() => props.luckyUrl, async (u) => { luckyQr.value = u ? await QRCode.toDataURL(u, { margin: 1, width: 200 }) : '' }, { immediate: true })
const t = computed(() => orderTotals(props.order))
// รายการรับชำระทั้งหมดที่ยืนยันแล้ว (ใบเสร็จต้องแสดงทุกวิธี ไม่ใช่แค่รายการแรก)
const payments = computed(() => (props.order.payments || []).filter((p) => p.status === 'confirmed'))
const paidTotal = computed(() => Math.round(payments.value.reduce((s, p) => s + (Number(p.amount) || 0), 0) * 100) / 100)
const balance = computed(() => Math.round((t.value.total - paidTotal.value) * 100) / 100)
const customer = computed(() => findCustomer(props.order.customerId))
</script>

<template>
  <div class="receipt-print mx-auto w-full max-w-[80mm] bg-white p-3 font-mono text-[13px] leading-snug text-black">
    <div class="text-center">
      <div class="text-base font-bold">{{ db.shop.name }}</div>
      <div>ใบเสร็จรับเงิน</div>
      <div class="text-xs">{{ orderNo(order.code) }} · {{ dateTime(order.createdAt) }}</div>
      <div v-if="t.vatMode && db.shop.vat.legalName" class="text-xs">{{ db.shop.vat.legalName }}</div>
      <div v-if="t.vatMode && db.shop.vat.taxId" class="text-xs">เลขประจำตัวผู้เสียภาษี {{ db.shop.vat.taxId }}</div>
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
    <div v-if="t.vatMode === 'exclusive'" class="flex justify-between"><span>VAT {{ t.vatRate }}% (บวกเพิ่ม)</span><span>{{ money(t.vat) }}</span></div>
    <div class="mt-1 flex justify-between text-base font-bold"><span>ยอดสุทธิ</span><span>{{ money(t.total) }}</span></div>
    <template v-if="t.vatMode === 'inclusive'">
      <div class="flex justify-between text-xs"><span>ราคาก่อน VAT</span><span>{{ money(t.beforeVat) }}</span></div>
      <div class="flex justify-between text-xs"><span>VAT {{ t.vatRate }}% (รวมในราคาแล้ว)</span><span>{{ money(t.vat) }}</span></div>
    </template>
    <div class="my-2 border-t border-dashed border-black" />
    <template v-for="p in payments" :key="p.id || p.code">
      <div class="flex justify-between gap-2"><span class="min-w-0 break-words">{{ p.method }}</span><span class="shrink-0">{{ money(p.amount) }}</span></div>
      <div v-if="p.change" class="flex justify-between text-xs"><span>รับเงินมา {{ money(p.received) }}</span><span>เงินทอน {{ money(p.change) }}</span></div>
    </template>
    <div v-if="payments.length > 1" class="flex justify-between font-bold"><span>รวมรับชำระ</span><span>{{ money(paidTotal) }}</span></div>
    <div v-if="balance > 0" class="flex justify-between font-bold"><span>ยังค้างชำระ</span><span>{{ money(balance) }}</span></div>
    <template v-if="customer">
      <div class="my-2 border-t border-dashed border-black" />
      <div>สมาชิก: {{ customer.name }}</div>
      <div v-if="order.loyalty?.points">ได้รับ {{ order.loyalty.points }} คะแนน<template v-if="order.loyalty.bonus"> (โบนัสโปร +{{ order.loyalty.bonus }})</template></div>
      <div v-if="order.status !== 'cancelled'">คะแนนคงเหลือ {{ customerPoints(customer) }}</div>
    </template>
    <div class="mt-3 text-center text-xs">ขอบคุณที่อุดหนุนค่ะ</div>
    <div v-if="luckyQr" class="mt-3 flex flex-col items-center gap-1 text-center text-xs">
      <div class="font-semibold">ลุ้นโชคท้ายบิล</div>
      <img :src="luckyQr" alt="QR ลุ้นโชคท้ายบิล" class="h-40 w-40" />
      <div>สแกน QR เพื่อลุ้นโชค</div>
    </div>
  </div>
</template>
