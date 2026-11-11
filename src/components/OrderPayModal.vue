<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findCustomer, depositOf, reportPayment, confirmPayment, receivePaymentNow, updatePaymentRequest } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { toastSaved } from '../lib/syncStatus'
import { QUICK_DUE, quickDue, dueBeforePickup, dueDaysBefore, isHHmm } from '../lib/payDue'
import { PAYMENT_METHODS } from '../lib/constants'
import { askConfirm } from '../lib/confirm'
import { money, dateTime } from '../lib/format'
import { PAY_MSG, notBeforeOrder, thaiMinute } from '../lib/payFields'
import { resizeImage, imageErrorMessage } from '../lib/imageResize'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SecureImg from './SecureImg.vue'
import SmsTick from './SmsTick.vue'

// โมดัลแจ้งยอดชำระ / แก้ยอดที่แจ้ง / ยืนยันยอดจริง / รับชำระทันที (ใช้ร่วมกันที่หน้ารายละเอียดออร์เดอร์และหน้าชำระเงิน)
// mode = new | edit | confirm | direct · target = งวดที่แก้/ยืนยัน (new/direct ไม่ต้องส่ง) · เปิดด้วย v-if ใหม่ทุกครั้ง
const props = defineProps({ order: { type: Object, required: true }, mode: { type: String, default: 'new' }, target: { type: Object, default: null } })
const emit = defineEmits(['close'])
const customer = computed(() => findCustomer(props.order.customerId))
const t = computed(() => orderTotals(props.order))
const paidMin = computed(() => thaiMinute(props.order.createdAt))
const nowLocal = () => {
  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
}

const payMode = props.mode // new | edit | confirm | direct (รับชำระทันที ไม่ต้องแจ้งยอด) · เปิดใหม่ทุกครั้ง (v-if) จึงไม่ต้องเป็น ref
const payTarget = props.target
const pay = reactive({ amount: 0, method: PAYMENT_METHODS[0], paidAt: '', slip: '', note: '', dueAt: '', notify: true, sms: true })
const payError = ref('')
// กำหนดชำระตามเวลานัด: ก่อนนัด N ชม. / ล่วงหน้า N วัน ก่อน HH:mm (ผ่านไปแล้ว = ปิดปุ่ม + เหตุผล)
const HOURS_BEFORE = [1, 3, 6, 12, 24]
const DAYS_BEFORE = [1, 2, 3]
const dueHours = ref(db.shop.payDueRule.hoursBefore)
const dueDays = ref(db.shop.payDueRule.daysBefore)
const dueTime = ref(db.shop.payDueRule.atTime)
const beforeOpts = computed(() => HOURS_BEFORE.map((h) => ({ h, ...dueBeforePickup(props.order.pickupAt, h) })))
const beforeCustom = computed(() => dueBeforePickup(props.order.pickupAt, dueHours.value))
const daysOpts = computed(() => DAYS_BEFORE.map((d) => ({ d, ...dueDaysBefore(props.order.pickupAt, d, isHHmm(dueTime.value) ? dueTime.value : '12:00') })))
const daysCustom = computed(() => dueDaysBefore(props.order.pickupAt, dueDays.value, dueTime.value))
const dueReasons = computed(() => [...beforeOpts.value.filter((x) => x.disabled).map((x) => `ก่อนนัด ${x.h} ชม.: ${x.reason}`), ...daysOpts.value.filter((x) => x.disabled).map((x) => `ล่วงหน้า ${x.d} วัน ก่อน ${dueTime.value}: ${x.reason}`)])
const PAY_TITLE = { new: 'แจ้งยอดชำระ', edit: 'แก้ยอดที่แจ้ง', confirm: 'ยืนยันยอดชำระ', direct: 'รับชำระทันที' }
// มัดจำ: แจ้งยอดงวดแรก (ยังไม่มีงวดที่แจ้ง/ยืนยัน) เติมยอดมัดจำให้ แก้ได้
const fullAmount = computed(() => Math.max(t.value.balance - t.value.reported, 0))
const depositAmount = computed(() => Math.min(depositOf(t.value.total), fullAmount.value))
const showDeposit = computed(() =>
  payMode === 'new' && db.shop.depositPercent > 0 && !props.order.payments.some((x) => x.status !== 'cancelled') && depositAmount.value < fullAmount.value,
)
// ค่าเริ่มต้นของฟอร์มตามโหมด
{
  const mode = payMode
  const p = payTarget
  Object.assign(pay, p
    ? { amount: mode === 'confirm' && p.customerSubmitted ? p.amount : (p.requested ?? p.amount), method: p.method, paidAt: p.paidAt, slip: p.slip, note: p.note, dueAt: p.dueAt || '' }
    : { amount: mode === 'direct' ? Math.max(t.value.balance, 0) : fullAmount.value, method: PAYMENT_METHODS[0], paidAt: nowLocal(), slip: '', note: '', dueAt: db.shop.payDueMin > 0 ? quickDue(db.shop.payDueMin) : '' })
  if (showDeposit.value) pay.amount = depositAmount.value
  dueHours.value = db.shop.payDueRule.hoursBefore
  dueDays.value = db.shop.payDueRule.daysBefore
  dueTime.value = db.shop.payDueRule.atTime
  pay.notify = true
  pay.sms = true
  payError.value = ''
}
// วันเวลาที่ชำระ: แสดงเป็นข้อความ (ค่าเริ่มต้นคือ "ตอนนี้") · กดเปลี่ยนจึงเปิดช่องเลือกวันเวลา (กันวงล้อของ iOS บังปุ่มยืนยัน)
const editPaidAt = ref(false)
const paidInitial = pay.paidAt
const paidText = computed(() => {
  if (!pay.paidAt) return '-'
  const label = dateTime(pay.paidAt) + ' น.'
  return !payTarget && pay.paidAt === paidInitial ? `ตอนนี้ · ${label}` : label
})
const amountMatchesBalance = computed(() => Number(pay.amount) === Number(t.value.balance))
const saveLabel = computed(() => (payMode === 'direct' ? 'ยืนยันรับชำระ' : payMode === 'confirm' ? 'ยืนยัน' : 'บันทึก'))
async function onSlip(e) {
  const f = e.target.files[0]
  e.target.value = ''
  if (!f) return
  payError.value = ''
  try {
    pay.slip = URL.createObjectURL((await resizeImage(f)).blob)
  } catch (err) {
    payError.value = imageErrorMessage(err)
  }
}
let saving = false
async function savePay() {
  if (saving) return
  if (!(pay.amount > 0)) return (payError.value = 'กรอกยอดเงิน')
  // วัน-เวลาชำระห้ามน้อยกว่าวัน-เวลาสร้างออร์เดอร์ (ตรวจเฉพาะค่าที่แก้ — ข้อมูลเดิมที่ไม่ได้แก้ไม่ถูกบล็อก)
  if (pay.paidAt !== paidInitial && !notBeforeOrder(pay.paidAt, props.order.createdAt)) return (payError.value = PAY_MSG.beforeOrder)
  if (payMode === 'direct') {
    if (!(await askConfirm({ title: 'รับชำระทันที', message: `ได้รับ ${money(pay.amount)} (${pay.method}) · บันทึกเป็นยอดที่ยืนยันแล้วเลย`, okText: 'ยืนยัน' }))) return
    const r = receivePaymentNow(props.order, { ...pay })
    if (r.error) return (payError.value = r.error)
    toastSaved(`รับชำระ ${money(pay.amount)} แล้ว · ${props.order.code}`)
    emit('close')
    return
  }
  if (payMode !== 'confirm' && !pay.dueAt) return (payError.value = 'ต้องกำหนดชำระ เลือกเวลาก่อน')
  if (payMode !== 'confirm' && new Date(pay.dueAt).getTime() <= Date.now()) return (payError.value = 'กำหนดชำระต้องเป็นเวลาในอนาคต')
  if (payMode === 'confirm' && !(await askConfirm({ title: 'ยืนยันยอดชำระ', message: `ได้รับจริง ${money(pay.amount)}`, okText: 'ยืนยัน' }))) return
  if (saving) return // กันกดซ้ำระหว่างรอยืนยัน
  saving = true
  let r
  try {
    if (payMode === 'confirm') r = confirmPayment(props.order, payTarget.id, { ...pay })
    else if (payMode === 'edit') r = updatePaymentRequest(props.order, payTarget.id, { ...pay })
    else r = reportPayment(props.order, { ...pay })
  } finally { saving = false }
  if (r?.error) return (payError.value = r.error)
  toastSaved(payMode === 'confirm' ? `ยืนยันยอดชำระ ${money(pay.amount)} แล้ว · ${props.order.code}` : payMode === 'edit' ? `แก้ยอดที่แจ้งแล้ว · ${props.order.code}` : `แจ้งยอดชำระ ${money(pay.amount)} แล้ว · ${props.order.code}`)
  emit('close')
}
</script>

<template>
<AppModal :title="PAY_TITLE[payMode]" @close="emit('close')">
  <div class="space-y-4">
    <div v-if="payMode === 'confirm'" class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
      ยอดที่แจ้งไป <b>{{ money(payTarget.requested ?? payTarget.amount) }}</b> · ใส่ยอดที่ได้รับจริง
    </div>
    <div v-else class="rounded-xl p-3 text-sm" :class="payMode === 'direct' ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'">
      <template v-if="payMode === 'direct'">ลูกค้าชำระแล้ว ไม่ต้องแจ้งยอด/กำหนดชำระ · </template>คงค้าง <b>{{ money(t.balance) }}</b><span v-if="t.reported"> · แจ้งยอดแล้ว {{ money(t.reported) }}</span>
    </div>
    <div v-if="payMode === 'confirm' && (payTarget.ref || payTarget.bankName)" class="rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-700">
      <div class="text-xs text-stone-500">ข้อมูลรายการที่ลูกค้าแจ้ง (ตรวจกับสลิป)</div>
      <div>วันเวลาโอน <b class="text-stone-900">{{ payTarget.paidAt ? dateTime(payTarget.paidAt) : '-' }}</b></div>
      <div>ธนาคาร <b class="text-stone-900">{{ payTarget.bankName || payTarget.bankCode || '-' }}</b></div>
      <div>เลขอ้างอิง <b class="break-all text-stone-900">{{ payTarget.ref || '-' }}</b><span v-if="payTarget.refSource === 'qr'" class="ml-1 text-xs text-emerald-700">(อ่านจาก QR)</span></div>
    </div>
    <div>
      <label class="label" for="pay-amount">{{ payMode === 'confirm' || payMode === 'direct' ? 'ยอดที่ได้รับจริง' : 'ยอดที่แจ้งลูกค้า' }}</label>
      <div class="relative">
        <input id="pay-amount" v-model.number="pay.amount" type="text" v-num.dec min="0" enterkeyhint="done" class="input pr-12 text-lg font-semibold" />
        <span class="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm text-stone-400">บาท</span>
      </div>
      <div v-if="payMode === 'direct' && t.balance > 0" class="mt-2 flex flex-wrap gap-2">
        <button type="button" class="chip" :class="amountMatchesBalance ? 'chip-on' : 'chip-off'" @click="pay.amount = t.balance">ชำระครบ · {{ money(t.balance) }}</button>
      </div>
    </div>
    <div v-if="showDeposit" class="flex flex-wrap gap-2">
      <button type="button" class="chip" :class="pay.amount === depositAmount ? 'chip-on' : 'chip-off'" @click="pay.amount = depositAmount">มัดจำ {{ db.shop.depositPercent }}% · {{ money(depositAmount) }}</button>
      <button type="button" class="chip" :class="pay.amount === fullAmount ? 'chip-on' : 'chip-off'" @click="pay.amount = fullAmount">เต็มจำนวน · {{ money(fullAmount) }}</button>
    </div>
    <div>
      <div class="label">ช่องทาง</div>
      <div class="flex flex-wrap gap-2">
        <button v-for="m in PAYMENT_METHODS" :key="m" type="button" class="chip" :class="pay.method === m ? 'chip-on' : 'chip-off'" @click="pay.method = m">{{ m }}</button>
      </div>
    </div>
    <div v-if="customer && order.channel !== 'pos' && payMode !== 'edit'" class="space-y-2 rounded-xl border border-stone-200 bg-white p-3">
      <label class="flex items-center gap-2 text-sm text-stone-700"><input v-model="pay.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> {{ payMode === 'new' ? 'แจ้งยอดชำระให้ลูกค้าทราบ' : 'แจ้งลูกค้าว่าได้รับชำระแล้ว' }}</label>
      <SmsTick v-model="pay.sms" :customer="customer" :order="order" :show="pay.notify" />
    </div>
    <div v-if="payMode === 'new' || payMode === 'edit'">
      <div class="label">ต้องชำระก่อน</div>
      <div class="mb-2 flex flex-wrap gap-2">
        <button v-for="q in QUICK_DUE" :key="q.m" type="button" class="chip chip-off" @click="pay.dueAt = quickDue(q.m)">{{ q.label }}</button>
      </div>
      <div class="mb-1 text-xs text-stone-500">ก่อนเวลานัด</div>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <button v-for="o in beforeOpts" :key="o.h" type="button" class="chip" :class="[o.disabled ? 'chip-off cursor-not-allowed opacity-40' : 'chip-off']" :disabled="o.disabled" :aria-label="`ก่อนนัด ${o.h} ชั่วโมง`" @click="pay.dueAt = o.dueAt">{{ o.h }} ชม.</button>
        <span class="flex items-center gap-1">
          <input v-model.number="dueHours" type="text" v-num min="1" max="720" class="input h-9 w-16 px-2 text-center" aria-label="ชั่วโมงก่อนนัด" />
          <button type="button" class="chip chip-off" :class="beforeCustom.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="beforeCustom.disabled" @click="pay.dueAt = beforeCustom.dueAt">ชม. ก่อนนัด</button>
        </span>
      </div>
      <div class="mb-1 text-xs text-stone-500">ล่วงหน้า ก่อนเวลา</div>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <button v-for="o in daysOpts" :key="o.d" type="button" class="chip chip-off" :class="o.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="o.disabled" :aria-label="`ล่วงหน้า ${o.d} วัน ก่อน ${dueTime}`" @click="pay.dueAt = o.dueAt">{{ o.d }} วัน ก่อน {{ dueTime }}</button>
        <span class="flex items-center gap-1">
          <input v-model.number="dueDays" type="text" v-num min="0" max="30" class="input h-9 w-14 px-2 text-center" aria-label="จำนวนวันล่วงหน้า" />
          <span class="text-xs text-stone-500">วัน ก่อน</span>
          <input v-model="dueTime" type="time" class="input h-9 w-28 px-2" aria-label="เวลาก่อน" />
          <button type="button" class="chip chip-off" :class="daysCustom.disabled ? 'cursor-not-allowed opacity-40' : ''" :disabled="daysCustom.disabled" @click="pay.dueAt = daysCustom.dueAt">ตั้ง</button>
        </span>
      </div>
      <p v-for="(r, i) in dueReasons" :key="i" class="mb-1 text-xs text-rose-600">{{ r }}</p>
      <input v-model="pay.dueAt" type="datetime-local" class="input" aria-label="กำหนดชำระ" />
    </div>
    <div>
      <div class="label">วันเวลาที่ชำระ</div>
      <div v-if="!editPaidAt" class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
        <span class="min-w-0 truncate text-stone-800">{{ paidText }}</span>
        <button type="button" class="shrink-0 font-medium text-brand-700 hover:underline" @click="editPaidAt = true">เปลี่ยน</button>
      </div>
      <input v-else v-model="pay.paidAt" type="datetime-local" class="input" aria-label="วันเวลาที่ชำระ" :min="paidMin" />
    </div>
    <div>
      <div class="label">สลิป <span class="font-normal text-stone-400">(ไม่บังคับ)</span></div>
      <label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-200 p-3 text-sm text-stone-500 hover:border-brand-300">
        <SecureImg v-if="pay.slip" :src="pay.slip" alt="สลิป" class="h-14 w-14 rounded-lg object-cover" />
        <AppIcon v-else name="image" :size="22" />
        <span>{{ pay.slip ? 'เปลี่ยนรูปสลิป' : 'แนบรูปสลิป' }}</span>
        <input type="file" accept="image/*" class="hidden" @change="onSlip" />
      </label>
    </div>
    <div><label class="label">หมายเหตุ</label><input v-model="pay.note" class="input" /></div>
    <p v-if="payError" class="text-sm text-rose-600">{{ payError }}</p>
  </div>
  <template #footer>
    <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
    <button class="btn-primary flex-1 sm:flex-none" @click="savePay">{{ saveLabel }}</button>
  </template>
</AppModal>
</template>
