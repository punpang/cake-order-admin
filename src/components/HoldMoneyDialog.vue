<script setup>
// แก้เงินพัก (ซ่อนเงิน/ดึงเงิน) ของออร์เดอร์ที่ยังไม่ส่งมอบ · ถ้าเงินพักลดแล้วชำระเกินต้องคืนส่วนเกินเงินสด/โอนให้พอดี
// กติกาทั้งหมดอยู่ใน store.setHoldMoney (ใช้ร่วมกับเซิร์ฟเวอร์) · หน้านี้แค่คำนวณยอดให้เห็นก่อนกดยืนยัน
import { computed, reactive, ref } from 'vue'
import { db, setHoldMoney } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { NOTE_VALUES, HOLD_KINDS, holdAmountOf, holdCountOf, holdErrors } from '../lib/holdMoney'
import { CASH_LABEL } from '../lib/cashService'
import { money } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import RefundEditor from './RefundEditor.vue'

const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])

const t = computed(() => orderTotals(props.order))
const maxNotes = Number(db.shop.cashService?.maxNotes) || 0
const cur = props.order.holdMoney
const f = reactive({
  kind: cur?.kind || 'hide',
  notes: Object.fromEntries(NOTE_VALUES.map((v) => [v, Number(cur?.notes?.[v]) || 0])),
  reason: '',
  refunds: [],
})
const error = ref('')

const hm = computed(() => ({ kind: f.kind, notes: { ...f.notes }, amount: holdAmountOf(f.notes) }))
const count = computed(() => holdCountOf(f.notes))
const bad = computed(() => holdErrors(hm.value, { maxNotes }))
const newPayable = computed(() => Math.round((t.value.total + hm.value.amount) * 100) / 100)
// ยอดที่ชำระไปแล้วเกินยอดที่ต้องชำระใหม่ = ต้องคืนส่วนเกิน (ไม่ติดลบ)
const excess = computed(() => Math.max(0, Math.round((t.value.paidNet - newPayable.value) * 100) / 100))

const setNote = (v, n) => { f.notes = { ...f.notes, [v]: Math.max(0, Math.floor(Number(n) || 0)) } }

function save() {
  error.value = ''
  if (bad.value) return (error.value = bad.value)
  if (!f.reason.trim()) return (error.value = 'ระบุเหตุผลการแก้เงินพัก')
  const r = setHoldMoney(props.order, hm.value, { refunds: f.refunds.map((x) => ({ method: x.method, amount: Number(x.amount) })), reason: f.reason, maxNotes })
  if (r.error) return (error.value = r.error)
  emit('done')
  emit('close')
}
</script>

<template>
  <AppModal title="แก้เงินพัก" @close="emit('close')">
    <div class="space-y-4">
      <div>
        <div class="label">ประเภท</div>
        <div class="flex flex-wrap gap-1.5" role="radiogroup" aria-label="ประเภทเงินพัก">
          <button v-for="k in HOLD_KINDS" :key="k" type="button" class="chip" :class="f.kind === k ? 'chip-on' : 'chip-off'" role="radio" :aria-checked="f.kind === k" @click="f.kind = k">{{ CASH_LABEL[k] }}</button>
        </div>
      </div>
      <div>
        <div class="label">ธนบัตร</div>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <div v-for="v in NOTE_VALUES" :key="v" class="rounded-xl border border-stone-200 p-2 text-center">
            <div class="text-xs text-stone-500">{{ v }} บาท</div>
            <div class="mt-1 flex items-center justify-between gap-1">
              <button type="button" class="btn-outline h-8 w-8 px-0" :aria-label="`ลดธนบัตร ${v} บาท`" @click="setNote(v, f.notes[v] - 1)">−</button>
              <input type="number" min="0" inputmode="numeric" class="input h-8 w-12 px-1 text-center" :value="f.notes[v]" :aria-label="`จำนวนธนบัตร ${v} บาท`" @input="setNote(v, $event.target.value)" />
              <button type="button" class="btn-outline h-8 w-8 px-0" :aria-label="`เพิ่มธนบัตร ${v} บาท`" @click="setNote(v, f.notes[v] + 1)">+</button>
            </div>
          </div>
        </div>
        <p class="mt-2 text-sm text-stone-600">เงินพักใหม่ <b class="text-stone-900">{{ money(hm.amount) }}</b> · {{ count }} ใบ<span v-if="maxNotes"> (สูงสุด {{ maxNotes }})</span></p>
      </div>

      <div class="space-y-1.5 rounded-xl bg-stone-50 p-3 text-sm">
        <div class="flex justify-between"><span class="text-stone-600">ชำระแล้ว (สุทธิ)</span><b>{{ money(t.paidNet) }}</b></div>
        <div class="flex justify-between"><span class="text-stone-600">ต้องชำระใหม่ (สินค้า+ค่าบริการ+เงินพัก)</span><b>{{ money(newPayable) }}</b></div>
        <div v-if="excess > 0" class="flex justify-between text-danger-700"><span>ต้องคืนส่วนเกิน</span><b>{{ money(excess) }}</b></div>
      </div>

      <div v-if="excess > 0">
        <div class="label">คืนส่วนเกิน (เงินสด/โอนเท่านั้น)</div>
        <RefundEditor v-model="f.refunds" :paid="excess" :can-credit="false" />
      </div>

      <div>
        <label class="label" for="hm-reason">เหตุผล <span class="text-rose-600">*</span></label>
        <input id="hm-reason" v-model="f.reason" class="input" maxlength="200" />
      </div>
      <p v-if="bad" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ bad }}</p>
      <p v-if="error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" :disabled="!!bad" @click="save">บันทึกเงินพัก</button>
    </template>
  </AppModal>
</template>
