<script setup>
import { orderNo, money, dateTime } from '../lib/format'
import { computed, ref, watch } from 'vue'
import QRCode from 'qrcode'
import { db, findCustomer, customerPoints } from '../data/store'
import { receiptFacts } from '../lib/receiptFacts'

// ใบเสร็จหน้าร้าน (พิมพ์ด้วย window.print ผ่าน .receipt-print ใน style.css · เครื่องพิมพ์ความร้อนใช้ข้อมูลชุดเดียวกันจาก receiptFacts)
const props = defineProps({ order: { type: Object, required: true }, luckyUrl: { type: String, default: '' } })
// QR ลุ้นโชคท้ายบิล (ถ้ามี) แสดงเป็นรูปในใบเสร็จ
const luckyQr = ref('')
watch(() => props.luckyUrl, async (u) => { luckyQr.value = u ? await QRCode.toDataURL(u, { margin: 1, width: 200 }) : '' }, { immediate: true })
const f = computed(() => {
  const customer = findCustomer(props.order.customerId)
  return receiptFacts(props.order, { shop: db.shop, legal: db.legal, storefront: db.storefront, customer, points: customer ? customerPoints(customer) : null })
})
</script>

<template>
  <div class="receipt-print mx-auto w-full max-w-[80mm] bg-white p-3 font-mono text-[13px] leading-snug text-black">
    <div class="text-center">
      <div class="text-base font-bold">{{ f.shopName }}</div>
      <div v-if="f.shopAddress" class="break-words text-xs">{{ f.shopAddress }}</div>
      <div v-if="f.shopPhone" class="text-xs">โทร {{ f.shopPhone }}</div>
      <div>ใบเสร็จรับเงิน</div>
      <div class="text-xs">{{ orderNo(order.code) }} · {{ dateTime(order.createdAt) }}</div>
      <div v-if="f.vatLegalName" class="text-xs">{{ f.vatLegalName }}</div>
      <div v-if="f.vatTaxId" class="text-xs">เลขประจำตัวผู้เสียภาษี {{ f.vatTaxId }}</div>
      <div v-if="f.cancelled" class="mt-1 font-bold">** ยกเลิกแล้ว **</div>
    </div>
    <div class="my-2 border-t border-dashed border-black" />
    <div v-for="it in order.items" :key="it.id" class="flex justify-between gap-2">
      <span class="min-w-0 break-words">{{ it.qty }} × {{ it.name }}<span v-if="it.mods?.length" class="block pl-4 text-xs">{{ it.mods.map((m) => m.name + (m.price ? ` +${m.price}` : '')).join(' · ') }}</span></span>
      <span class="shrink-0">{{ money((it.fullPrice ?? it.unitPrice) * it.qty) }}</span>
    </div>
    <div class="my-2 border-t border-dashed border-black" />
    <div class="flex justify-between"><span>รวม</span><span>{{ money(f.full) }}</span></div>
    <div v-for="l in f.discountLines" :key="l.label" class="flex justify-between gap-2"><span class="min-w-0 break-words">{{ l.label }}</span><span class="shrink-0">−{{ money(l.amount) }}</span></div>
    <div v-if="f.vatMode === 'exclusive'" class="flex justify-between"><span>VAT {{ f.vatRate }}% (บวกเพิ่ม)</span><span>{{ money(f.vat) }}</span></div>
    <div class="mt-1 flex justify-between text-base font-bold"><span>ยอดสุทธิ</span><span>{{ money(f.total) }}</span></div>
    <template v-if="f.vatMode === 'inclusive'">
      <div class="flex justify-between text-xs"><span>ราคาก่อน VAT</span><span>{{ money(f.beforeVat) }}</span></div>
      <div class="flex justify-between text-xs"><span>VAT {{ f.vatRate }}% (รวมในราคาแล้ว)</span><span>{{ money(f.vat) }}</span></div>
    </template>
    <div class="my-2 border-t border-dashed border-black" />
    <template v-for="(p, i) in f.payments" :key="i">
      <div class="flex justify-between gap-2"><span class="min-w-0 break-words">{{ p.method }}</span><span class="shrink-0">{{ money(p.amount) }}</span></div>
      <div v-if="p.change" class="flex justify-between text-xs"><span>รับเงินมา {{ money(p.received) }}</span><span>เงินทอน {{ money(p.change) }}</span></div>
      <div v-if="p.qrRef" class="break-all text-xs">Ref2 {{ p.qrRef }}</div>
    </template>
    <div v-if="f.payments.length > 1" class="flex justify-between font-bold"><span>รวมรับชำระ</span><span>{{ money(f.paidTotal) }}</span></div>
    <div v-if="f.balance > 0" class="flex justify-between font-bold"><span>ยังค้างชำระ</span><span>{{ money(f.balance) }}</span></div>
    <div v-if="f.nextDue" class="text-xs">ชำระก่อน {{ f.nextDue.at }} · {{ f.nextDue.amount }}</div>
    <template v-if="f.fulfillment">
      <div class="my-2 border-t border-dashed border-black" />
      <div class="font-bold">{{ f.fulfillment.label }}<span v-if="f.fulfillment.at"> · {{ f.fulfillment.at }}</span></div>
      <div v-if="f.fulfillment.address" class="break-words text-xs">{{ f.fulfillment.address }}</div>
    </template>
    <template v-if="f.customer">
      <div class="my-2 border-t border-dashed border-black" />
      <div class="break-words">{{ f.customer.label }}: {{ f.customer.name }}</div>
      <div v-if="f.customer.phone">โทร {{ f.customer.phone }}</div>
      <div v-if="f.customer.earned">ได้รับ {{ f.customer.earned }} คะแนน<template v-if="f.customer.bonus"> (โบนัสโปร +{{ f.customer.bonus }})</template></div>
      <div v-if="f.customer.pointsLeft != null">คะแนนคงเหลือ {{ f.customer.pointsLeft }}</div>
    </template>
    <div class="mt-3 text-center text-xs">ขอบคุณที่อุดหนุนค่ะ</div>
    <div v-if="luckyQr" class="mt-3 flex flex-col items-center gap-1 text-center text-xs">
      <div class="font-semibold">ลุ้นโชคท้ายบิล</div>
      <img :src="luckyQr" alt="QR ลุ้นโชคท้ายบิล" class="h-40 w-40" />
      <div>สแกน QR เพื่อลุ้นโชค</div>
    </div>
  </div>
</template>
