<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { db, findCustomer, depositOf, reportPayment, confirmPayment, receivePaymentNow, updatePaymentRequest, receiveChatSlip } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { toastSaved } from '../lib/syncStatus'
import { QUICK_DUE, quickDue, dueBeforePickup, dueDaysBefore, isHHmm } from '../lib/payDue'
import { PAYMENT_METHODS } from '../lib/constants'
import { askConfirm } from '../lib/confirm'
import { cleanNum } from '../lib/numInput'
import { money, dateTime } from '../lib/format'
import { PAY_MSG, notBeforeOrder, thaiMinute } from '../lib/payFields'
import { slipRoom, pendingCustomerTotal, slipMatchChecks } from '../lib/slipBind'
import OrderQrPay from './OrderQrPay.vue'
import { resizeImage, imageErrorMessage } from '../lib/imageResize'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SecureImg from './SecureImg.vue'
import SmsTick from './SmsTick.vue'

// โมดัลแจ้งยอดชำระ / แก้ยอดที่แจ้ง / ยืนยันยอดจริง / รับชำระทันที (ใช้ร่วมกันที่หน้ารายละเอียดออร์เดอร์และหน้าชำระเงิน)
// mode = new | edit | confirm | direct | slip · target = งวดที่แก้/ยืนยัน (new/direct ไม่ต้องส่ง) · slip = สลิปที่รอผูกในแชท { chatId, msgId, at, slip, bankCode, bankName, ref } · เปิดด้วย v-if ใหม่ทุกครั้ง
const props = defineProps({ order: { type: Object, required: true }, mode: { type: String, default: 'new' }, target: { type: Object, default: null } })
const emit = defineEmits(['close'])
const customer = computed(() => findCustomer(props.order.customerId))
const t = computed(() => orderTotals(props.order))
// โหมดสลิป: ยอดที่ผูกได้ = คงค้างหักยอดที่ลูกค้าแจ้งรอตรวจอยู่แล้ว
const slipMax = computed(() => slipRoom(t.value.balance, props.order.payments))
const slipOwn = computed(() => pendingCustomerTotal(props.order.payments))
const slipChecks = computed(() => (payMode === 'slip' ? slipMatchChecks({ amount: pay.amount, paidAt: pay.paidAt, payments: props.order.payments }) : []))
const paidMin = computed(() => thaiMinute(props.order.createdAt))
const nowLocal = () => {
  const d = new Date()
  const p2 = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`
}

// เวลาเริ่มต้นของสลิปในแชท = เวลาที่ลูกค้าส่งข้อความสลิป (เวลาไทย) · ก่อนวันสร้างออร์เดอร์หรือไม่ทราบเวลา → เวลาตอนนี้ (ตรงกับฝั่งเซิร์ฟเวอร์)
const slipPaidAt = (p, order) => { const m = thaiMinute(p?.at); return m && notBeforeOrder(m, order.createdAt) ? m : nowLocal() }
const payMode = props.mode // new | edit | confirm | direct | slip (รับชำระทันที ไม่ต้องแจ้งยอด) · เปิดใหม่ทุกครั้ง (v-if) จึงไม่ต้องเป็น ref
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
// ปุ่มเวลาชำระที่เลือกล่าสุด (ไฮไลต์ให้เห็นว่ากดแล้ว) · พิมพ์/เลือกวัน-เวลาเองจะล้างการเลือก
const dueSel = ref('')
const pickDue = (key, at) => { dueSel.value = key; pay.dueAt = at }
const dueReasons = computed(() => [...beforeOpts.value.filter((x) => x.disabled).map((x) => `ก่อนนัด ${x.h} ชม.: ${x.reason}`), ...daysOpts.value.filter((x) => x.disabled).map((x) => `ล่วงหน้า ${x.d} วัน ก่อน ${dueTime.value}: ${x.reason}`)])
const PAY_TITLE = { new: 'แจ้งยอดชำระ', edit: 'แก้ยอดที่แจ้ง', confirm: 'ยืนยันยอดชำระ', direct: 'รับชำระทันที', slip: 'รับชำระจากสลิป' }
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
  // สลิปจากแชท: ใช้ยอด/วันเวลาที่อ่านจากภาพสลิป (ถ้ามี) เป็นค่าเริ่มต้น พนักงานแก้ได้ก่อนผูก
  if (mode === 'slip') Object.assign(pay, { amount: p.ocrAmount ?? slipMax.value, method: PAYMENT_METHODS[0], paidAt: p.ocrPaidAt || slipPaidAt(p, props.order), slip: p.slip, note: '', dueAt: '' })
  else Object.assign(pay, p
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
// ช่องยอดเงิน: ขณะพิมพ์แสดงตัวเลขดิบ · เมื่อออกจากช่องแสดงรูปแบบ x,xxx.xx
const amtFmt = (v) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const amtFocused = ref(false)
const amtText = ref(amtFmt(pay.amount))
watch(() => pay.amount, (v) => { if (!amtFocused.value) amtText.value = amtFmt(v) })
function onAmtInput(e) {
  const c = cleanNum(e.target.value, true)
  amtText.value = c
  pay.amount = c === '' || c === '.' ? 0 : Number(c)
}
function onAmtBlur() { amtFocused.value = false; amtText.value = amtFmt(pay.amount) }
function onAmtFocus() { amtFocused.value = true }
const paidText = computed(() => {
  if (!pay.paidAt) return '-'
  const label = dateTime(pay.paidAt) + ' น.'
  return !payTarget && pay.paidAt === paidInitial ? `ตอนนี้ · ${label}` : label
})
const amountMatchesBalance = computed(() => Number(pay.amount) === Number(t.value.balance))
// รับชำระโอนหน้าร้าน: แสดง QR แบบ POS (ตรวจรายการแม่มณีอัตโนมัติ) แทนปุ่มบันทึกทั่วไป
const qrMode = computed(() => payMode === 'direct' && pay.method === 'โอนเงิน' && t.value.balance > 0)
const saveLabel = computed(() => (payMode === 'direct' ? 'ยืนยันรับชำระ' : payMode === 'confirm' ? 'ยืนยัน' : payMode === 'slip' ? 'รับชำระ' : 'บันทึก'))
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
  if (payMode === 'slip') { // รับชำระจากสลิปในแชท: ขั้นตอนเดียวกับรับชำระทันที · กติกาทั้งหมดอยู่ใน receiveChatSlip (ชุดเดียวกับ slipBindError)
    if (!(await askConfirm({ title: 'รับชำระจากสลิป', message: `ยอด ${money(pay.amount)} (${pay.method}) · บันทึกเป็นยอดที่ยืนยันแล้วเลย`, okText: 'รับชำระ' }))) return
    if (saving) return
    saving = true
    let r
    try { r = receiveChatSlip(payTarget.chatId, payTarget.msgId, props.order.id, { ...pay }) } finally { saving = false }
    if (r?.error) return (payError.value = r.error)
    toastSaved(`รับชำระ ${money(pay.amount)} แล้ว · ${props.order.code}`)
    emit('close')
    return
  }
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
    <div v-else-if="payMode === 'slip'" class="rounded-xl bg-sky-50 p-3 text-sm text-sky-800">
      สลิปจากแชท · คงค้าง <b>{{ money(t.balance) }}</b> · รับได้สูงสุด <b>{{ money(slipMax) }}</b><span v-if="slipOwn > 0"> (หักยอดที่ลูกค้าแจ้งรอตรวจ {{ money(slipOwn) }})</span>
    </div>
    <ul v-if="payMode === 'slip' && slipChecks.length" class="space-y-1 rounded-xl border border-stone-200 bg-white p-3 text-sm" aria-label="ผลตรวจสลิปกับออร์เดอร์">
      <li v-for="(c, k) in slipChecks" :key="k" class="flex items-start gap-2" :class="c.ok ? 'text-emerald-700' : 'text-rose-700'"><span aria-hidden="true" class="font-bold">{{ c.ok ? '✓' : '✗' }}</span><span>{{ c.text }}</span></li>
    </ul>
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
      <label class="label" for="pay-amount">{{ payMode === 'slip' ? 'ยอดตามสลิป' : payMode === 'confirm' || payMode === 'direct' ? 'ยอดที่ได้รับจริง' : 'ยอดที่แจ้งลูกค้า' }}</label>
      <div class="relative">
        <input id="pay-amount" :value="amtText" @input="onAmtInput" @focus="onAmtFocus" @blur="onAmtBlur" type="text" inputmode="decimal" enterkeyhint="done" autocomplete="off" class="input pr-12 text-lg font-semibold" />
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
    <OrderQrPay v-if="qrMode" :order="order" :amount="pay.amount" @done="emit('close')" />
    <div v-if="customer && order.channel !== 'pos'" class="space-y-2 rounded-xl border border-stone-200 bg-white p-3">
      <label class="flex items-center gap-2 text-sm text-stone-700"><input v-model="pay.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> {{ payMode === 'new' ? 'แจ้งยอดชำระให้ลูกค้าทราบ' : payMode === 'edit' ? 'แจ้งลูกค้าว่ายอดที่แจ้งเปลี่ยนแล้ว' : 'แจ้งลูกค้าว่าได้รับชำระแล้ว' }}</label>
      <SmsTick v-model="pay.sms" :customer="customer" :order="order" :show="pay.notify" />
    </div>
    <div v-if="payMode === 'new' || payMode === 'edit'">
      <div class="label">ต้องชำระก่อน</div>
      <div class="mb-2 flex flex-wrap gap-2">
        <button v-for="q in QUICK_DUE" :key="q.m" type="button" class="chip" :class="dueSel === 'q' + q.m ? 'chip-on' : 'chip-off'" @click="pickDue('q' + q.m, quickDue(q.m))">{{ q.label }}</button>
      </div>
      <div class="mb-1 text-xs text-stone-500">ก่อนเวลานัด</div>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <button v-for="o in beforeOpts" :key="o.h" type="button" class="chip" :class="o.disabled ? 'chip-off cursor-not-allowed opacity-40' : dueSel === 'h' + o.h ? 'chip-on' : 'chip-off'" :disabled="o.disabled" :aria-label="`ก่อนนัด ${o.h} ชั่วโมง`" @click="pickDue('h' + o.h, o.dueAt)">{{ o.h }} ชม.</button>
        <span class="flex items-center gap-1">
          <input v-model.number="dueHours" type="text" v-num min="1" max="720" class="input h-9 w-16 px-2 text-center" aria-label="ชั่วโมงก่อนนัด" />
          <button type="button" class="chip" :class="beforeCustom.disabled ? 'chip-off cursor-not-allowed opacity-40' : dueSel === 'hc' ? 'chip-on' : 'chip-off'" :disabled="beforeCustom.disabled" @click="pickDue('hc', beforeCustom.dueAt)">ชม. ก่อนนัด</button>
        </span>
      </div>
      <div class="mb-1 text-xs text-stone-500">ล่วงหน้า ก่อนเวลา</div>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <button v-for="o in daysOpts" :key="o.d" type="button" class="chip" :class="o.disabled ? 'chip-off cursor-not-allowed opacity-40' : dueSel === 'd' + o.d ? 'chip-on' : 'chip-off'" :disabled="o.disabled" :aria-label="`ล่วงหน้า ${o.d} วัน ก่อน ${dueTime}`" @click="pickDue('d' + o.d, o.dueAt)">{{ o.d }} วัน ก่อน {{ dueTime }}</button>
        <span class="flex items-center gap-1">
          <input v-model.number="dueDays" type="text" v-num min="0" max="30" class="input h-9 w-14 px-2 text-center" aria-label="จำนวนวันล่วงหน้า" />
          <span class="text-xs text-stone-500">วัน ก่อน</span>
          <input v-model="dueTime" type="time" class="input h-9 w-28 px-2" aria-label="เวลาก่อน" />
          <button type="button" class="chip" :class="daysCustom.disabled ? 'chip-off cursor-not-allowed opacity-40' : dueSel === 'dc' ? 'chip-on' : 'chip-off'" :disabled="daysCustom.disabled" @click="pickDue('dc', daysCustom.dueAt)">ตั้ง</button>
        </span>
      </div>
      <p v-for="(r, i) in dueReasons" :key="i" class="mb-1 text-xs text-rose-700">{{ r }}</p>
      <input v-model="pay.dueAt" type="datetime-local" class="input" aria-label="กำหนดชำระ" @input="dueSel = ''" />
    </div>
    <div>
      <div class="label">วันเวลาที่ชำระ</div>
      <div v-if="!editPaidAt" class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm">
        <span class="min-w-0 truncate text-stone-800">{{ paidText }}</span>
        <button type="button" class="shrink-0 font-medium text-brand-700 hover:underline" @click="editPaidAt = true">เปลี่ยน</button>
      </div>
      <input v-else v-model="pay.paidAt" type="datetime-local" class="input" aria-label="วันเวลาที่ชำระ" :min="paidMin" />
    </div>
    <div v-if="payMode === 'slip'" class="rounded-xl border border-stone-200 bg-white p-3 text-sm text-stone-700">
      <div class="text-xs text-stone-500">สลิปจากแชท · อ่านจาก QR (ยังไม่ได้ตรวจยอดกับธนาคาร)</div>
      <div class="mt-2 flex items-start gap-3">
        <SecureImg v-if="pay.slip" :src="pay.slip" alt="สลิปจากแชท" class="h-20 w-20 shrink-0 rounded-lg object-cover" />
        <div class="min-w-0 space-y-0.5">
          <div>ธนาคารผู้โอน <b class="text-stone-900">{{ payTarget.bankName || payTarget.bankCode || '-' }}</b></div>
          <div>เลขอ้างอิง <b class="break-all text-stone-900">{{ payTarget.ref || '-' }}</b></div>
        </div>
      </div>
    </div>
    <div v-else>
      <div class="label">สลิป <span class="font-normal text-stone-400">(ไม่บังคับ)</span></div>
      <label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-200 p-3 text-sm text-stone-500 hover:border-brand-300">
        <SecureImg v-if="pay.slip" :src="pay.slip" alt="สลิป" class="h-14 w-14 rounded-lg object-cover" />
        <AppIcon v-else name="image" :size="22" />
        <span>{{ pay.slip ? 'เปลี่ยนรูปสลิป' : 'แนบรูปสลิป' }}</span>
        <input type="file" accept="image/*" class="hidden" @change="onSlip" />
      </label>
    </div>
    <div><label class="label">หมายเหตุ</label><input v-model="pay.note" class="input" /></div>
    <p v-if="payError" class="text-sm text-rose-700">{{ payError }}</p>
  </div>
  <template #footer>
    <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
    <button v-if="!qrMode" class="btn-primary flex-1 sm:flex-none" @click="savePay">{{ saveLabel }}</button>
  </template>
</AppModal>
</template>
