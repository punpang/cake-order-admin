<script setup>
import { computed, reactive, ref } from 'vue'
import { myInvoiceState, myTaxProfile, requestMyTaxInvoice, editMyTaxInvoice, MAX_CUSTOMER_REVISIONS } from '../data/acct'
import { dateOnly } from '../lib/format'
import AppIcon from './AppIcon.vue'
import A4Print from './A4Print.vue'
import TaxInvoiceDoc from './TaxInvoiceDoc.vue'

// ลูกค้าขอ/แก้ใบกำกับภาษีเต็มรูปเอง (เฉพาะหน้าที่ล็อกอิน) · ภายใน 5 วันหลังชำระครบ และไม่เกินวันที่ 5 เดือนถัดไป · จดจำข้อมูลผู้ซื้อได้ชุดเดียว
const props = defineProps({ orderId: { type: String, required: true } })
const st = computed(() => myInvoiceState(props.orderId))
const f = reactive({ name: '', taxId: '', branch: '00000', address: '', remember: true })
const err = ref('')
const editing = ref(false)
const showDoc = ref(false)
const printer = ref(null)
const doc = computed(() => st.value?.invoice || null)
function fill(src) { Object.assign(f, { name: src?.name || '', taxId: src?.taxId || '', branch: src?.branch || '00000', address: src?.address || '' }); err.value = '' }
fill(myTaxProfile())
function startEdit() { fill(doc.value?.buyer); editing.value = true }
function submit() {
  err.value = ''
  const r = editing.value ? editMyTaxInvoice(props.orderId, f, f.remember) : requestMyTaxInvoice(props.orderId, f, f.remember)
  if (r.error) return (err.value = r.error)
  editing.value = false
  showDoc.value = true
}
</script>

<template>
  <section v-if="st" class="card space-y-3" aria-label="ใบกำกับภาษี">
    <div class="card-title"><AppIcon name="list" :size="16" /> ใบกำกับภาษีเต็มรูป</div>
    <template v-if="doc && !editing">
      <div class="rounded-xl bg-emerald-50 p-3 text-emerald-800">ออกใบแล้ว <b>{{ doc.no }}</b> · {{ dateOnly(doc.date) }}<div class="text-xs">ผู้ซื้อ {{ doc.buyer.name }}</div></div>
      <div class="flex flex-wrap gap-2">
        <button class="btn-soft" @click="showDoc = !showDoc">{{ showDoc ? 'ซ่อนใบกำกับภาษี' : 'ดู/พิมพ์ใบกำกับภาษี' }}</button>
        <button v-if="st.eligible && st.canEdit" class="btn-outline" @click="startEdit">แก้ไขข้อมูล</button>
      </div>
      <p v-if="st.eligible" class="text-xs text-stone-500">แก้ไขได้ภายใน {{ dateOnly(st.deadline) }} · เหลืออีก {{ st.revisionsLeft }}/{{ MAX_CUSTOMER_REVISIONS }} ครั้ง (แก้แล้วระบบออกใบลดหนี้ใบเดิมและออกใบใหม่ให้)</p>
      <p v-else class="text-xs text-stone-500">{{ st.reason }}</p>
    </template>
    <template v-else-if="st.eligible || editing">
      <p class="text-xs text-stone-500">ขอ/แก้ได้ภายใน <b>{{ dateOnly(st.deadline) }}</b> (5 วันหลังชำระ ไม่เกินวันที่ 5 เดือนถัดไป)</p>
      <div><label class="label">ชื่อผู้ซื้อ (บุคคล/นิติบุคคล)</label><input v-model="f.name" class="input" maxlength="120" aria-label="ชื่อผู้ซื้อ" /></div>
      <div class="grid grid-cols-3 gap-3"><div class="col-span-2"><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="f.taxId" inputmode="numeric" maxlength="13" class="input" aria-label="เลขผู้เสียภาษี" /></div><div><label class="label">สาขา (5 หลัก)</label><input v-model="f.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขา" /></div></div>
      <div><label class="label">ที่อยู่ตามใบกำกับ</label><textarea v-model="f.address" rows="2" maxlength="300" class="input" aria-label="ที่อยู่ใบกำกับ" /></div>
      <label class="flex items-center gap-2 text-stone-600"><input v-model="f.remember" type="checkbox" class="h-4 w-4" /> จดจำข้อมูลนี้ไว้ใช้ครั้งหน้า (เก็บได้ชุดเดียว ทับของเดิม)</label>
      <p v-if="err" class="text-rose-600" role="alert">{{ err }}</p>
      <div class="flex gap-2"><button v-if="editing" class="btn-outline flex-1" @click="editing = false">ยกเลิก</button><button class="btn-primary flex-1" @click="submit">{{ editing ? 'บันทึกการแก้ไข' : 'ขอใบกำกับภาษี' }}</button></div>
    </template>
    <p v-else class="text-stone-500">{{ st.reason }}</p>
    <div v-if="doc && showDoc && !editing">
      <div class="mb-2 flex gap-2"><button class="btn-soft" @click="printer?.print()"><AppIcon name="printer" :size="16" /> พิมพ์ A4</button></div>
      <div class="overflow-x-auto rounded-2xl border border-stone-200"><A4Print ref="printer"><TaxInvoiceDoc :invoice="doc" /></A4Print></div>
    </div>
  </section>
</template>
