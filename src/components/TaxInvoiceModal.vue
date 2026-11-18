<script setup>
import { computed, reactive, ref } from 'vue'
import { db, can, findCustomer, saveCustomer } from '../data/store'
import { taxInvoices, invoiceOfOrder, invoiceBlock, buyerOf, issueTaxInvoice, voidTaxInvoice, markInvoiceCopy } from '../data/acct'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import TaxInvoiceDoc from './TaxInvoiceDoc.vue'
import { printTaxInvoice } from '../lib/receiptRaster'
import TaxAddressField from './TaxAddressField.vue'
import { addressChoices } from '../lib/thaiAddress'

// ออกใบกำกับภาษีเต็มรูปจากออร์เดอร์ · ดู/พิมพ์/ทำสำเนา · ยกเลิกด้วยใบลดหนี้
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close'])
const buyer = reactive({ ...buyerOf(props.order), save: true })
const addrChoices = computed(() => addressChoices(findCustomer(props.order.customerId)?.places || [], props.order.fulfillment === 'delivery' ? props.order.address : ''))
const error = ref('')
const reason = ref('')
const voiding = ref(false)
const viewId = ref('')
const docs = computed(() => taxInvoices().filter((i) => i.orderId === props.order.id))
const current = computed(() => invoiceOfOrder(props.order.id))
const shown = computed(() => docs.value.find((d) => d.id === viewId.value) || current.value || docs.value.at(-1) || null)
const block = computed(() => (current.value ? '' : invoiceBlock(props.order, buyer)))
const copyLabel = ref('ต้นฉบับ')
const pick = ref(null) // null = ยังไม่เลือกขนาด · true/false = กำลังเลือกขนาด (สำเนา/ต้นฉบับ)
function issue() {
  error.value = ''
  const r = issueTaxInvoice(props.order.id, buyer)
  if (r.error) return (error.value = r.error)
  const c = findCustomer(props.order.customerId)
  if (buyer.save && c && !c.deleted) saveCustomer({ ...c, tax: { name: buyer.name, taxId: buyer.taxId, branch: buyer.branch, address: buyer.address } })
  viewId.value = r.invoice.id
}
function doVoid() {
  error.value = ''
  const r = voidTaxInvoice(current.value.id, reason.value)
  if (r.error) return (error.value = r.error)
  voiding.value = false
  reason.value = ''
  viewId.value = r.creditNote.id
}
function startPrint(copy) {
  error.value = ''
  pick.value = copy
}
async function printAs(size) {
  const copy = pick.value
  pick.value = null
  if (!shown.value) return
  copyLabel.value = copy ? 'สำเนา' : 'ต้นฉบับ'
  if (copy) markInvoiceCopy(shown.value.id)
  if (size === 'A4') return printA4()
  try {
    await printTaxInvoice(shown.value, size, copyLabel.value)
  } catch (e) {
    error.value = `พิมพ์ไม่สำเร็จ: ${e.message || e}`
  }
}
function printA4() {
  document.body.classList.add('print-a4')
  const done = () => { document.body.classList.remove('print-a4'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
</script>

<template>
  <AppModal title="ใบกำกับภาษีเต็มรูป" wide @close="emit('close')">
    <div class="space-y-3">
      <div v-if="docs.length" class="flex flex-wrap gap-1.5">
        <button v-for="d in docs" :key="d.id" type="button" class="chip" :class="shown?.id === d.id ? 'chip-on' : 'chip-off'" @click="viewId = d.id">{{ d.no }}<span v-if="d.voidedBy"> (ยกเลิก)</span></button>
      </div>
      <template v-if="!current">
        <div class="space-y-3 rounded-2xl border border-stone-200 p-3">
          <div class="text-sm font-semibold text-stone-800">ข้อมูลผู้ซื้อ (ใช้ออกใบนี้)</div>
          <div><label class="label">ชื่อผู้ซื้อ (บุคคล/นิติบุคคล)</label><input v-model="buyer.name" class="input" maxlength="120" aria-label="ชื่อผู้ซื้อ" /></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2"><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="buyer.taxId" inputmode="numeric" maxlength="13" class="input" aria-label="เลขผู้เสียภาษีผู้ซื้อ" /></div>
            <div><label class="label">สาขา (5 หลัก)</label><input v-model="buyer.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขาผู้ซื้อ" /></div>
          </div>
          <div><label class="label">ที่อยู่ตามใบกำกับ</label><TaxAddressField v-model="buyer.address" label="ที่อยู่ผู้ซื้อ" :suggestions="addrChoices" /></div>
          <label v-if="findCustomer(order.customerId)" class="flex items-center gap-2 text-sm text-stone-600"><input v-model="buyer.save" type="checkbox" class="h-4 w-4" /> บันทึกข้อมูลนี้ไว้กับลูกค้า</label>
        </div>
        <p v-if="block" class="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" /> {{ block }}</p>
        <p class="text-xs text-stone-500">ออกแล้วแก้ไขไม่ได้ · ยกเลิกได้ด้วยใบลดหนี้ (ใบเดิมยังเก็บไว้) · ใบเสร็จย่อของระบบยังไม่ใช่ใบกำกับภาษี</p>
      </template>
      <p v-if="shown?.pending" class="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AppIcon name="alert" :size="16" /> กำลังรับเลขที่จากฐานข้อมูล (รอสักครู่ แล้วเปิดใหม่) · ยังพิมพ์ไม่ได้</p>
      <div v-if="shown" class="overflow-x-auto rounded-2xl border border-stone-200"><TaxInvoiceDoc :invoice="shown" :label="copyLabel" /></div>
      <div v-if="pick !== null" class="space-y-2 rounded-2xl border border-stone-200 p-3">
        <div class="text-sm font-semibold text-stone-800">เลือกขนาดกระดาษ{{ pick ? ' (สำเนา)' : '' }}</div>
        <div class="grid grid-cols-3 gap-2">
          <button type="button" class="btn-soft" @click="printAs('A4')">A4</button>
          <button type="button" class="btn-soft" @click="printAs(58)">58 มม. (เครื่องพิมพ์ความร้อน)</button>
          <button type="button" class="btn-soft" @click="printAs(88)">88 มม. (เครื่องพิมพ์ความร้อน)</button>
        </div>
        <p class="text-xs text-stone-500">58 / 88 มม. ส่งไปเครื่องพิมพ์ Bluetooth ที่ตั้งไว้ · A4 ใช้เครื่องพิมพ์ของเบราว์เซอร์</p>
        <button type="button" class="btn-outline w-full" @click="pick = null">ยกเลิก</button>
      </div>
      <div v-if="voiding" class="space-y-2 rounded-2xl border border-rose-200 bg-rose-50 p-3">
        <label class="label">เหตุผลที่ยกเลิก (ออกใบลดหนี้เต็มจำนวน)</label>
        <input v-model="reason" class="input" maxlength="200" aria-label="เหตุผลยกเลิกใบกำกับ" />
        <div class="flex gap-2"><button class="btn-outline flex-1" @click="voiding = false">ไม่ยกเลิก</button><button class="btn-primary flex-1" @click="doVoid">ออกใบลดหนี้</button></div>
      </div>
      <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <template v-if="shown">
        <button class="btn-soft flex-1 sm:flex-none" :disabled="!!shown.pending || pick !== null" @click="startPrint(false)"><AppIcon name="printer" :size="16" /> พิมพ์</button>
        <button class="btn-soft flex-1 sm:flex-none" :disabled="!!shown.pending || pick !== null" @click="startPrint(true)">พิมพ์สำเนา</button>
        <button v-if="current && shown.id === current.id && can('taxInvoice') && !voiding" class="btn-outline flex-1 text-rose-700 sm:flex-none" @click="voiding = true">ยกเลิกใบ</button>
      </template>
      <button v-if="!current && can('taxInvoice')" class="btn-primary flex-1 sm:flex-none" :disabled="!!block" @click="issue">ออกใบกำกับภาษี</button>
    </template>
  </AppModal>
  <Teleport to="body">
    <div v-if="shown" class="a4-print-root hidden"><TaxInvoiceDoc :invoice="shown" :label="copyLabel" /></div>
  </Teleport>
</template>
