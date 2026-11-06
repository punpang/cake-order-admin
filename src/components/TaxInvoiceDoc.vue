<script setup>
import { computed } from 'vue'
import { dateOnly, money } from '../lib/format'
import { branchLabel } from '../lib/acct/taxid'

// เอกสารใบกำกับภาษีเต็มรูป / ใบลดหนี้ (A4) · พิมพ์ผ่าน .a4-print-root ใน style.css
const props = defineProps({ invoice: { type: Object, required: true }, label: { type: String, default: 'ต้นฉบับ' } })
const credit = computed(() => props.invoice.type === 'credit')
const sign = computed(() => (credit.value ? -1 : 1))
const m = (n) => money(sign.value * n)
</script>

<template>
  <div class="bg-white p-4 text-[13px] leading-relaxed text-black sm:p-6">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-lg font-bold break-words">{{ invoice.seller.name }}</div>
        <div class="break-words whitespace-pre-line">{{ invoice.seller.address }}</div>
        <div>เลขประจำตัวผู้เสียภาษี {{ invoice.seller.taxId }} · {{ branchLabel(invoice.seller.branch) }}</div>
      </div>
      <div class="shrink-0 text-right">
        <div class="text-lg font-bold">{{ credit ? 'ใบลดหนี้ / ใบกำกับภาษี' : 'ใบกำกับภาษี' }}</div>
        <div class="text-xs">({{ label }})</div>
        <div>เลขที่ <b>{{ invoice.no }}</b></div>
        <div>วันที่ {{ dateOnly(invoice.date) }}</div>
        <div v-if="credit" class="text-xs">อ้างถึงใบกำกับภาษีเลขที่ {{ invoice.refNo }}</div>
      </div>
    </div>
    <div class="my-3 rounded border border-stone-400 p-2">
      <div class="text-xs text-stone-600">ผู้ซื้อ</div>
      <div class="font-semibold break-words">{{ invoice.buyer.name }}</div>
      <div class="break-words whitespace-pre-line">{{ invoice.buyer.address }}</div>
      <div>เลขประจำตัวผู้เสียภาษี {{ invoice.buyer.taxId }} · {{ branchLabel(invoice.buyer.branch) }}</div>
      <div class="text-xs text-stone-600">อ้างอิงออร์เดอร์ {{ invoice.orderCode }}<template v-if="credit"> · เหตุผล: {{ invoice.reason }}</template></div>
    </div>
    <table class="w-full border-collapse text-[13px]">
      <thead><tr class="border-y border-black"><th class="py-1 text-left">รายการ</th><th class="w-12 py-1 text-right">จำนวน</th><th class="w-24 py-1 text-right">ราคา/หน่วย</th><th class="w-24 py-1 text-right">จำนวนเงิน</th></tr></thead>
      <tbody>
        <tr v-for="(l, i) in invoice.lines" :key="i" class="align-top"><td class="py-0.5 break-words">{{ l.name }}</td><td class="py-0.5 text-right">{{ l.qty }}</td><td class="py-0.5 text-right">{{ m(l.unitPrice) }}</td><td class="py-0.5 text-right">{{ m(l.amount) }}</td></tr>
        <tr v-for="(d, i) in invoice.discounts" :key="'d' + i" class="align-top text-stone-700"><td colspan="3" class="py-0.5 break-words">ส่วนลด: {{ d.label }}</td><td class="py-0.5 text-right">{{ m(-d.amount) }}</td></tr>
      </tbody>
    </table>
    <div class="mt-2 ml-auto w-full max-w-xs border-t border-black pt-1">
      <div class="flex justify-between"><span>มูลค่าก่อนภาษีมูลค่าเพิ่ม</span><span>{{ m(invoice.beforeVat) }}</span></div>
      <div class="flex justify-between"><span>ภาษีมูลค่าเพิ่ม {{ invoice.rate }}%</span><span>{{ m(invoice.vat) }}</span></div>
      <div class="flex justify-between border-t border-black font-bold"><span>{{ credit ? 'ยอดลดหนี้รวมภาษี' : 'รวมทั้งสิ้น' }}</span><span>{{ m(invoice.total) }}</span></div>
      <div class="text-xs text-stone-600">({{ invoice.mode === 'exclusive' ? 'ราคาไม่รวมภาษี บวกภาษีท้ายยอด' : 'ราคารวมภาษีมูลค่าเพิ่มแล้ว' }})</div>
    </div>
    <div class="mt-2 text-sm">ตัวอักษร: <b>{{ credit ? 'ลบ' : '' }}{{ invoice.totalText }}</b></div>
    <div class="mt-8 grid grid-cols-2 gap-6 text-center text-xs"><div class="border-t border-stone-500 pt-1">ผู้รับสินค้า/บริการ</div><div class="border-t border-stone-500 pt-1">ผู้มีอำนาจลงนาม</div></div>
  </div>
</template>
