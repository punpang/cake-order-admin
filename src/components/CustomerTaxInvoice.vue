<script setup>
import { computed, nextTick, reactive, ref, onBeforeUnmount } from 'vue'
import { customerInvoiceDocs, myAddressChoices, myInvoiceState, myTaxProfile, requestMyTaxInvoice, editMyTaxInvoice, MAX_CUSTOMER_REVISIONS } from '../data/acct'
import { dateOnly } from '../lib/format'
import AppIcon from './AppIcon.vue'
import A4Print from './A4Print.vue'
import TaxInvoiceDoc from './TaxInvoiceDoc.vue'
import TaxAddressField from './TaxAddressField.vue'

// ลูกค้าขอ/แก้ใบกำกับภาษีเต็มรูปเอง (เฉพาะหน้าที่ล็อกอิน) · ภายใน 5 วันหลังชำระครบ และไม่เกินวันที่ 5 เดือนถัดไป · จดจำข้อมูลผู้ซื้อได้ชุดเดียว
// ล็อกอิน: ส่ง orderId (ขอ/แก้/ดาวน์โหลดได้) · ลิงก์ออร์เดอร์: ส่ง token (ดูและดาวน์โหลดอย่างเดียว ขอ/แก้ไม่ได้) · ดาวน์โหลด = หน้าพิมพ์ A4 เลือก "บันทึกเป็น PDF"
const props = defineProps({ orderId: { type: String, default: '' }, token: { type: String, default: '' }, cancelled: { type: Boolean, default: false } })
const readonly = computed(() => !props.orderId)
const ctx = computed(() => (props.orderId ? { orderId: props.orderId } : { token: props.token }))
const docs = computed(() => customerInvoiceDocs(ctx.value))
const st = computed(() => (props.orderId ? myInvoiceState(props.orderId) : null))
const others = computed(() => docs.value.filter((d) => d.id !== st.value?.invoice?.id && !(readonly.value && d.type === 'invoice' && !d.voidedBy)))
const current = ref(null)
const savedTitle = ref('')
const kind = (d) => (d.type === 'credit' ? 'ใบลดหนี้' : 'ใบกำกับภาษี')
async function download(d) {
  current.value = d
  await nextTick()
  savedTitle.value = document.title
  document.title = d.no
  const restore = () => { document.title = savedTitle.value || document.title; window.removeEventListener('afterprint', restore) }
  window.addEventListener('afterprint', restore)
  printer.value?.print()
}
onBeforeUnmount(() => { if (savedTitle.value) document.title = savedTitle.value })
const f = reactive({ name: '', taxId: '', branch: '00000', address: '', remember: true })
const err = ref('')
const editing = ref(false)
const printer = ref(null)
const doc = computed(() => (props.orderId ? st.value?.invoice : docs.value.find((d) => d.type === 'invoice' && !d.voidedBy)) || null)
function fill(src) { Object.assign(f, { name: src?.name || '', taxId: src?.taxId || '', branch: src?.branch || '00000', address: src?.address || '' }); err.value = '' }
fill(myTaxProfile())
function startEdit() { fill(doc.value?.buyer); editing.value = true }
function submit() {
  err.value = ''
  const r = editing.value ? editMyTaxInvoice(props.orderId, f, f.remember) : requestMyTaxInvoice(props.orderId, f, f.remember)
  if (r.error) return (err.value = r.error)
  editing.value = false
}
</script>

<template>
  <section v-if="(st || docs.length) && !(cancelled && !docs.length)" class="card space-y-3" aria-label="ใบกำกับภาษี">
    <div class="card-title"><AppIcon name="list" :size="16" /> ใบกำกับภาษีเต็มรูป</div>
    <template v-if="doc && !editing">
      <div class="rounded-xl bg-emerald-50 p-3 text-emerald-800">ออกใบแล้ว <b>{{ doc.no }}</b> · {{ dateOnly(doc.date) }}<div class="text-xs">ผู้ซื้อ {{ doc.buyer.name }}</div></div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-primary" aria-label="ดาวน์โหลดใบกำกับภาษี PDF" @click="download(doc)"><AppIcon name="printer" :size="16" /> ดาวน์โหลด PDF</button>
        <button v-if="st && st.eligible && st.canEdit" class="btn-outline" @click="startEdit">แก้ไขข้อมูล</button>
      </div>
      <p class="text-xs text-stone-500">กด "ดาวน์โหลด PDF" แล้วเลือก "บันทึกเป็น PDF" ในหน้าพิมพ์</p>
      <p v-if="readonly" class="text-xs text-amber-700" role="note">ในใบมีเลขผู้เสียภาษีและที่อยู่ผู้ซื้อ — ใครมีลิงก์นี้ดาวน์โหลดได้ อย่าส่งต่อลิงก์ · ขอ/แก้ใบกำกับภาษีต้องเข้าสู่ระบบ</p>
      <template v-else-if="st">
        <p v-if="st.eligible" class="text-xs text-stone-500">แก้ไขได้ภายใน {{ dateOnly(st.deadline) }} · เหลืออีก {{ st.revisionsLeft }}/{{ MAX_CUSTOMER_REVISIONS }} ครั้ง (แก้แล้วระบบออกใบลดหนี้ใบเดิมและออกใบใหม่ให้)</p>
        <p v-else class="text-xs text-stone-500">{{ st.reason }}</p>
      </template>
      <div class="overflow-x-auto rounded-2xl border border-stone-200"><TaxInvoiceDoc :invoice="doc" /></div>
    </template>
    <template v-else-if="st && (st.eligible || editing)">
      <p class="text-xs text-stone-500">ขอ/แก้ได้ภายใน <b>{{ dateOnly(st.deadline) }}</b> (5 วันหลังชำระ ไม่เกินวันที่ 5 เดือนถัดไป)</p>
      <div><label class="label">ชื่อผู้ซื้อ (บุคคล/นิติบุคคล)</label><input v-model="f.name" class="input" maxlength="120" aria-label="ชื่อผู้ซื้อ" /></div>
      <div class="grid grid-cols-3 gap-3"><div class="col-span-2"><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="f.taxId" inputmode="numeric" maxlength="13" class="input" aria-label="เลขผู้เสียภาษี" /></div><div><label class="label">สาขา (5 หลัก)</label><input v-model="f.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขา" /></div></div>
      <div><label class="label">ที่อยู่ตามใบกำกับ</label><TaxAddressField v-model="f.address" label="ที่อยู่ใบกำกับ" :suggestions="myAddressChoices(orderId)" /></div>
      <label class="flex items-center gap-2 text-stone-600"><input v-model="f.remember" type="checkbox" class="h-4 w-4" /> จดจำข้อมูลนี้ไว้ใช้ครั้งหน้า (เก็บได้ชุดเดียว ทับของเดิม)</label>
      <p v-if="err" class="text-rose-600" role="alert">{{ err }}</p>
      <div class="flex gap-2"><button v-if="editing" class="btn-outline flex-1" @click="editing = false">ยกเลิก</button><button class="btn-primary flex-1" @click="submit">{{ editing ? 'บันทึกการแก้ไข' : 'ขอใบกำกับภาษี' }}</button></div>
    </template>
    <p v-else-if="st && !others.length" class="text-stone-500">{{ st.reason }}</p>
    <div v-if="others.length && !editing" aria-label="ประวัติใบกำกับภาษีและใบลดหนี้">
      <div class="mb-1 text-xs font-semibold text-stone-600">ประวัติเอกสาร</div>
      <ul class="space-y-1.5">
        <li v-for="d in others" :key="d.id" class="flex items-center justify-between gap-2 rounded-xl border border-stone-200 p-2.5 text-sm">
          <span class="min-w-0"><span class="block truncate font-medium">{{ d.no }} <span class="text-xs font-normal text-stone-500">{{ kind(d) }}</span></span><span class="block text-xs text-stone-500">{{ dateOnly(d.date) }}<template v-if="d.voidedBy"> · ยกเลิกแล้ว (ออกใบลดหนี้)</template></span></span>
          <button class="btn-soft h-9 shrink-0 px-3" :aria-label="`ดาวน์โหลด ${d.no}`" @click="download(d)">ดาวน์โหลด PDF</button>
        </li>
      </ul>
    </div>
    <div class="hidden" aria-hidden="true"><A4Print v-if="current" ref="printer"><TaxInvoiceDoc :invoice="current" :label="current.type === 'credit' || current.id === doc?.id ? 'ต้นฉบับ' : 'สำเนา'" /></A4Print></div>
  </section>
</template>
