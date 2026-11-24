<script setup>
import { computed, reactive, ref } from 'vue'
import { db, can, findCustomer, saveCustomer } from '../data/store'
import { taxInvoices, invoiceOfOrder, invoiceBlock, buyerOf, issueTaxInvoice, voidTaxInvoice, reviseTaxInvoice, markInvoiceCopy, ensureOrderInvoices } from '../data/acct'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import TaxInvoiceDoc from './TaxInvoiceDoc.vue'
import { printTaxInvoice } from '../lib/receiptRaster'
import { isNative } from '../lib/nativeDevices'
import A4Print from './A4Print.vue'
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
const editing = ref(false)
const viewId = ref('')
const docs = computed(() => taxInvoices().filter((i) => i.orderId === props.order.id))
const current = computed(() => invoiceOfOrder(props.order.id))
const shown = computed(() => docs.value.find((d) => d.id === viewId.value) || current.value || docs.value.at(-1) || null)
const block = computed(() => (current.value ? '' : invoiceBlock(props.order, buyer)))
const copyLabel = ref('ต้นฉบับ')
const a4 = ref(null) // เครื่องพิมพ์ A4 ของเบราว์เซอร์ (ใช้บนเว็บ)
// ใบของออร์เดอร์นี้ที่ออกไว้นาน (เกินช่วงที่โหลด) → ดึงก่อน ทั้งเพื่อแสดง และกันออกใบซ้ำ
const invLoaded = ensureOrderInvoices(props.order.id)
async function issue() {
  error.value = ''
  if (!(await invLoaded)) return (error.value = 'โหลดใบกำกับภาษีของออร์เดอร์นี้ไม่สำเร็จ ลองใหม่อีกครั้ง')
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
// แก้ไข: เติมฟอร์มจากข้อมูลผู้ซื้อของใบปัจจุบัน (ไม่ต้องกรอกใหม่) · บันทึก = ระบบออกใบลดหนี้ใบเดิม + ออกใบใหม่ให้เอง
function startEdit() {
  error.value = ''
  Object.assign(buyer, { name: '', taxId: '', branch: '00000', address: '' }, current.value.buyer || {})
  editing.value = true
}
function saveRevise() {
  error.value = ''
  const r = reviseTaxInvoice(current.value.id, buyer)
  if (r.error) return (error.value = r.error)
  const c = findCustomer(props.order.customerId)
  if (buyer.save && c && !c.deleted) saveCustomer({ ...c, tax: { name: buyer.name, taxId: buyer.taxId, branch: buyer.branch, address: buyer.address } })
  editing.value = false
  viewId.value = r.invoice.id
}
// พิมพ์ใบกำกับ: แอป = เครื่องพิมพ์ความร้อนของส่วนใบกำกับ (ความกว้างตามหน้าตั้งค่า) · เว็บ = A4 ผ่านกล่องพิมพ์ของเบราว์เซอร์
async function printAs(copy) {
  error.value = ''
  if (!shown.value || shown.value.pending) return
  copyLabel.value = copy ? 'สำเนา' : 'ต้นฉบับ'
  if (copy) markInvoiceCopy(shown.value.id)
  if (!isNative()) return a4.value?.print()
  try {
    await printTaxInvoice(shown.value, copyLabel.value)
  } catch (e) {
    error.value = `พิมพ์ไม่สำเร็จ: ${e.message || e}`
  }
}
</script>

<template>
  <AppModal title="ใบกำกับภาษีเต็มรูป" wide @close="emit('close')">
    <div class="space-y-3">
      <div v-if="docs.length" class="flex flex-wrap gap-1.5">
        <button v-for="d in docs" :key="d.id" type="button" class="chip" :class="shown?.id === d.id ? 'chip-on' : 'chip-off'" @click="viewId = d.id">{{ d.no }}<span v-if="d.voidedBy"> (ยกเลิก)</span></button>
      </div>
      <template v-if="!current || editing">
        <div class="space-y-3 rounded-2xl border border-stone-200 p-3">
          <div class="text-sm font-semibold text-stone-800">{{ current ? 'แก้ไขข้อมูลผู้ซื้อ (ระบบจะออกใบลดหนี้ใบเดิมและใบใหม่ให้)' : 'ข้อมูลผู้ซื้อ (ใช้ออกใบนี้)' }}</div>
          <div><label class="label">ชื่อผู้ซื้อ (บุคคล/นิติบุคคล)</label><input v-model="buyer.name" class="input" maxlength="120" aria-label="ชื่อผู้ซื้อ" /></div>
          <div class="grid grid-cols-3 gap-3">
            <div class="col-span-2"><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="buyer.taxId" inputmode="numeric" maxlength="13" class="input" aria-label="เลขผู้เสียภาษีผู้ซื้อ" /></div>
            <div><label class="label">สาขา (5 หลัก)</label><input v-model="buyer.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขาผู้ซื้อ" /></div>
          </div>
          <div><label class="label">ที่อยู่ตามใบกำกับ</label><TaxAddressField v-model="buyer.address" label="ที่อยู่ผู้ซื้อ" :suggestions="addrChoices" /></div>
          <label v-if="findCustomer(order.customerId)" class="flex items-center gap-2 text-sm text-stone-600"><input v-model="buyer.save" type="checkbox" class="h-4 w-4" /> บันทึกข้อมูลนี้ไว้กับลูกค้า</label>
        </div>
        <p v-if="block" class="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" /> {{ block }}</p>
        <p class="text-xs text-stone-500">{{ current ? 'ใบเดิมยังเก็บไว้ในระบบ ใบลดหนี้และใบใหม่ออกให้อัตโนมัติ' : 'ออกแล้วแก้ไขได้จากหน้านี้ · ใบเดิมยังเก็บไว้ทุกครั้ง · ใบเสร็จย่อของระบบยังไม่ใช่ใบกำกับภาษี' }}</p>
      </template>
      <p v-if="shown?.pending" class="flex items-center gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800"><AppIcon name="alert" :size="16" /> กำลังรับเลขที่จากฐานข้อมูล (รอสักครู่ แล้วเปิดใหม่) · ยังพิมพ์ไม่ได้</p>
      <div v-if="shown" class="overflow-x-auto rounded-2xl border border-stone-200"><TaxInvoiceDoc :invoice="shown" :label="copyLabel" /></div>
      <p v-if="shown" class="text-xs text-stone-500">บนแอปพิมพ์ไปเครื่องพิมพ์ความร้อนที่ตั้งไว้ · บนเว็บพิมพ์ A4 ผ่านกล่องพิมพ์ของเบราว์เซอร์</p>
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
        <button class="btn-soft flex-1 sm:flex-none" :disabled="!!shown.pending" @click="printAs(false)"><AppIcon name="printer" :size="16" /> พิมพ์</button>
        <button class="btn-soft flex-1 sm:flex-none" :disabled="!!shown.pending" @click="printAs(true)">พิมพ์สำเนา</button>
        <button v-if="current && shown.id === current.id && can('taxInvoice') && !voiding && !editing" class="btn-outline flex-1 sm:flex-none" @click="startEdit">แก้ไข</button>
        <button v-if="current && shown.id === current.id && can('taxInvoice') && !voiding && !editing" class="btn-outline flex-1 text-rose-700 sm:flex-none" @click="voiding = true">ยกเลิกใบ</button>
      </template>
      <button v-if="current && editing" class="btn-outline flex-1 sm:flex-none" @click="editing = false">ไม่แก้ไข</button>
      <button v-if="current && editing" class="btn-primary flex-1 sm:flex-none" @click="saveRevise">บันทึกการแก้ไข</button>
      <button v-if="!current && can('taxInvoice')" class="btn-primary flex-1 sm:flex-none" :disabled="!!block" @click="issue">ออกใบกำกับภาษี</button>
    </template>
  </AppModal>
  <div class="hidden" aria-hidden="true"><A4Print v-if="shown" ref="a4"><TaxInvoiceDoc :invoice="shown" :label="copyLabel" /></A4Print></div>
</template>
