<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { customerPay, customerRequestExtension } from '../data/store'
import { promptPayPayload } from '../lib/promptpay'
import { money, dateOnly, dateTime, formatPhone } from '../lib/format'
import { STATUS } from '../lib/constants'
import StatusBadge from './StatusBadge.vue'
import PayDueBadge from './PayDueBadge.vue'
import AppIcon from './AppIcon.vue'
import CustomerTaxInvoice from './CustomerTaxInvoice.vue'

// หน้าออร์เดอร์ของลูกค้า (ใช้ร่วมกันทั้งลิงก์ #/o/:token และหน้าบัญชีที่ล็อกอิน)
// order = มุมมองจาก customerOrderView/myOrder · ctx = { token } | { orderId } · emits: refresh (หลังทำรายการ) · review
const props = defineProps({ order: { type: Object, required: true }, ctx: { type: Object, required: true }, canReview: { type: Boolean, default: false } })
const emit = defineEmits(['refresh', 'review'])
const o = computed(() => props.order)

// ---------- แถบขั้นตอน ----------
const SHIP = computed(() => o.value.fulfillment === 'delivery')
const STEPS = computed(() => SHIP.value ? ['รอชำระ', 'ยืนยันแล้ว', 'กำลังเตรียม', 'เตรียมแล้ว', 'พร้อมจัดส่ง', 'กำลังจัดส่ง', 'ส่งมอบแล้ว'] : ['รอชำระ', 'ยืนยันแล้ว', 'กำลังเตรียม', 'พร้อมรับ', 'ส่งมอบแล้ว'])
const STEP_OF = computed(() => SHIP.value
  ? { draft: 0, awaiting_payment: 0, payment_reported: 0, payment_confirmed: 1, order_confirmed: 1, preparing: 2, prepared: 3, ready_to_ship: 4, shipping: 5, delivered: 6 }
  : { draft: 0, awaiting_payment: 0, payment_reported: 0, payment_confirmed: 1, order_confirmed: 1, preparing: 2, prepared: 3, delivered: 4 })
const step = computed(() => STEP_OF.value[o.value.status] ?? 0)
const cancelled = computed(() => o.value.status === 'cancelled')

// ---------- ชำระเงิน ----------
const info = computed(() => o.value.pay.info)
const hasInfo = computed(() => !!(info.value.promptpayId || info.value.accountNo))
const requests = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.shopRequested && !p.submitted))
const f = reactive({ mode: 'all', custom: '', paymentId: null, slip: '', slipName: '', note: '', error: '', ok: '', busy: false })
const open = ref(false)
const room = computed(() => o.value.pay.room)
const amount = computed(() => {
  if (f.mode === 'all') return room.value
  if (f.mode === 'req') return Math.min(requests.value.find((p) => p.id === f.paymentId)?.amount ?? 0, room.value)
  return Number(f.custom) || 0
})
function pick(mode, p = null) {
  f.mode = mode
  f.paymentId = p?.id || null
}
const qr = ref('')
const payload = computed(() => (amount.value > 0 ? promptPayPayload(info.value.promptpayId, amount.value) : null))
watch(
  [payload, open],
  async () => {
    qr.value = ''
    if (!open.value || !payload.value) return
    try {
      const QR = await import('qrcode')
      qr.value = await (QR.default || QR).toDataURL(payload.value, { margin: 1, width: 240, errorCorrectionLevel: 'M' })
    } catch {
      qr.value = ''
    }
  },
  { immediate: true },
)
const copied = ref('')
async function copy(text, key) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => (copied.value = ''), 1500)
  } catch {
    copied.value = ''
  }
}
function onSlip(e) {
  f.error = ''
  const file = e.target.files?.[0]
  if (!file) return
  if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) return (f.error = 'แนบสลิปเป็นรูปภาพ (PNG / JPG / WEBP)')
  if (file.size > 5 * 1024 * 1024) return (f.error = 'ไฟล์ใหญ่เกิน 5 MB')
  const r = new FileReader()
  r.onload = () => { f.slip = String(r.result); f.slipName = file.name }
  r.readAsDataURL(file)
}
function submit() {
  f.error = f.ok = ''
  if (!(amount.value > 0)) return (f.error = 'กรอกยอดที่โอน')
  if (!f.slip) return (f.error = 'แนบสลิปก่อนกดส่ง')
  f.busy = true
  const r = customerPay(props.ctx, { amount: amount.value, slip: f.slip, note: f.note, paymentId: f.mode === 'req' ? f.paymentId : null })
  f.busy = false
  if (r.error) return (f.error = r.error)
  f.ok = 'ส่งสลิปแล้ว ร้านจะตรวจสอบและยืนยันให้'
  Object.assign(f, { slip: '', slipName: '', note: '', custom: '', mode: 'all', paymentId: null })
  open.value = false
  emit('refresh')
}
const extNote = ref('')
const extMsg = ref('')
function askExtension(p) {
  extMsg.value = ''
  const r = customerRequestExtension(props.ctx, p.id, extNote.value)
  if (r.error) return (extMsg.value = r.error)
  extNote.value = ''
  emit('refresh')
}
const overdue = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.due === 'overdue'))
const submitted = computed(() => o.value.payments.filter((p) => p.status === 'reported' && p.submitted))
const PAY_LABEL = (p) => (p.status === 'confirmed' ? ['ชำระแล้ว', 'bg-emerald-50 text-emerald-700'] : p.submitted ? ['รอร้านตรวจสอบสลิป', 'bg-sky-50 text-sky-700'] : p.due === 'overdue' ? ['เกินกำหนด', 'bg-rose-50 text-rose-600'] : ['รอชำระ', 'bg-amber-50 text-amber-700'])
const canPayUi = computed(() => !cancelled.value && o.value.status !== 'draft' && o.value.balance > 0)
</script>

<template>
  <div class="space-y-3 text-sm">
    <!-- สรุป + ขั้นตอน -->
    <section class="card">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-xs text-stone-500">ออร์เดอร์</div>
          <h1 class="text-2xl font-bold tracking-tight text-stone-900">{{ o.code }}</h1>
          <div v-if="o.customer" class="truncate text-stone-500">{{ o.customer.name }}<span v-if="o.customer.phone"> · {{ o.customer.phone.startsWith('xxx') ? o.customer.phone : formatPhone(o.customer.phone) }}</span></div>
        </div>
        <div class="flex shrink-0 flex-col items-end gap-1.5"><StatusBadge :status="o.status" /><PayDueBadge :due="o.payDue" /></div>
      </div>
      <ol v-if="!cancelled" class="mt-4 grid gap-1" :style="{ gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))` }" aria-label="ขั้นตอนออร์เดอร์">
        <li v-for="(label, i) in STEPS" :key="label" class="flex flex-col items-center gap-1 text-center" :aria-current="i === step ? 'step' : undefined">
          <span class="flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold" :class="i < step ? 'bg-brand-600 text-white' : i === step ? 'bg-brand-100 text-brand-800 ring-2 ring-brand-500' : 'bg-stone-100 text-stone-400'">
            <AppIcon v-if="i < step" name="check" :size="14" /><template v-else>{{ i + 1 }}</template>
          </span>
          <span class="text-[11px] leading-tight" :class="i === step ? 'font-semibold text-stone-900' : 'text-stone-500'">{{ label }}</span>
        </li>
      </ol>
      <p v-else class="mt-3 rounded-xl bg-rose-50 p-3 text-rose-700">ออร์เดอร์นี้ถูกยกเลิกแล้ว · หากมีข้อสงสัยติดต่อร้านได้เลย</p>
    </section>

    <!-- แจ้งสถานะสำคัญ -->
    <section v-if="overdue.length" class="rounded-2xl border border-rose-200 bg-rose-50 p-4 text-rose-800" role="alert">
      <div class="flex items-center gap-2 font-semibold"><AppIcon name="alert" :size="18" /> เกินกำหนดชำระ</div>
      <p class="mt-1">ยอด {{ money(overdue[0].amount) }} ต้องชำระก่อน {{ dateTime(overdue[0].dueAt) }} · ตอนนี้แจ้งชำระเองไม่ได้ หากต้องการเวลาเพิ่มกดขอขยายเวลา</p>
      <template v-for="p in overdue" :key="p.id">
        <p v-if="p.extension === 'pending'" class="mt-2 rounded-lg bg-white/70 p-2 text-sm">ส่งคำขอขยายเวลาแล้ว รอร้านตอบกลับ</p>
        <p v-else-if="p.extension === 'denied'" class="mt-2 rounded-lg bg-white/70 p-2 text-sm">ร้านไม่อนุมัติการขยายเวลา กรุณาติดต่อร้าน</p>
        <div v-else class="mt-2 space-y-2">
          <input v-model="extNote" class="input bg-white" maxlength="200" placeholder="เหตุผล (ไม่บังคับ)" aria-label="เหตุผลที่ขอขยายเวลา" />
          <button class="btn-primary w-full" @click="askExtension(p)">ขอขยายเวลาชำระ</button>
        </div>
      </template>
      <p v-if="extMsg" class="mt-2 text-sm text-rose-700">{{ extMsg }}</p>
    </section>
    <section v-if="submitted.length" class="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sky-800">ส่งสลิป {{ money(submitted.reduce((s, p) => s + p.amount, 0)) }} แล้ว · รอร้านตรวจสอบและยืนยัน</section>
    <section v-if="o.unpaidApproved" class="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-indigo-800">ร้านยืนยันการสั่งซื้อแล้ว · ชำระยอดคงค้างได้ตอนรับสินค้า</section>
    <p v-if="f.ok" class="rounded-2xl bg-emerald-50 p-3 text-emerald-700" role="status">{{ f.ok }}</p>

    <!-- นัดรับ/ส่ง -->
    <section class="card">
      <div class="flex items-center gap-2 text-xs text-stone-500"><AppIcon :name="o.fulfillment === 'delivery' ? 'truck' : 'store'" :size="16" /> นัด{{ o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
      <div class="mt-0.5 text-base font-semibold text-stone-900">{{ dateTime(o.pickupAt) }}</div>
      <div v-if="o.delivery" class="mt-2 space-y-0.5 text-stone-600">
        <div v-if="o.delivery.placeName" class="font-medium text-stone-800">{{ o.delivery.placeName }}</div>
        <div v-if="o.delivery.address" class="break-words">{{ o.delivery.address }}</div>
        <div v-if="o.delivery.detail" class="break-words text-stone-500">{{ o.delivery.detail }}</div>
        <div v-if="o.delivery.distanceKm != null" class="text-stone-500">ระยะทาง {{ o.delivery.distanceKm }} กม.</div>
        <a v-if="o.delivery.mapUrl" :href="o.delivery.mapUrl" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1 text-brand-700 underline"><AppIcon name="pin" :size="14" /> เปิดแผนที่</a>
      </div>
      <div v-if="o.birthday" class="mt-2 text-stone-500">วันเกิด {{ o.birthday.name }}</div>
    </section>

    <!-- รายการ -->
    <section class="card space-y-3">
      <div v-for="it in o.items" :key="it.id" class="min-w-0">
        <div class="flex justify-between gap-3"><span class="font-medium text-stone-900">{{ it.name }} × {{ it.qty }}</span><span class="shrink-0 font-medium">{{ money(it.unitPrice * it.qty) }}</span></div>
        <div v-for="(d, j) in it.lines" :key="j" class="text-xs text-stone-500">{{ d.group }}: {{ d.value }}</div>
        <div v-if="it.note" class="text-xs break-words text-stone-500">หมายเหตุ: {{ it.note }}</div>
      </div>
    </section>

    <!-- ยอด -->
    <section class="card space-y-1.5">
      <div v-if="o.discountTotal" class="flex justify-between text-stone-500"><span>ส่วนลดรวม</span><span>-{{ money(o.discountTotal) }}</span></div>
      <div v-if="o.delivery && o.delivery.shippingFee" class="flex justify-between text-stone-500"><span>ค่าจัดส่ง</span><span>{{ money(o.delivery.shippingFee) }}</span></div>
      <div class="flex justify-between text-base"><span class="font-medium">ยอดรวม</span><b class="text-stone-900">{{ money(o.total) }}</b></div>
      <div v-if="o.vatMode" class="flex justify-between text-xs text-stone-500"><span>{{ o.vatMode === 'exclusive' ? `รวม VAT ${o.vatRate}% (บวกเพิ่ม)` : `รวม VAT ${o.vatRate}% แล้ว` }}</span><span>{{ money(o.vat) }}</span></div>
      <div v-for="(r, i) in o.refunds" :key="'rf' + i" class="flex justify-between text-xs text-rose-600"><span>คืนเงิน · {{ r.label }}<template v-if="r.points != null"> ({{ r.points }} คะแนน)</template></span><span>{{ money(r.amount) }}</span></div>
      <div class="flex justify-between"><span>ชำระแล้ว</span><span>{{ money(o.paid) }}</span></div>
      <div v-if="!cancelled" class="flex justify-between text-base" :class="o.balance > 0 ? 'text-amber-700' : 'text-emerald-700'"><span class="font-medium">คงค้าง</span><b>{{ money(o.balance) }}</b></div>
    </section>

    <!-- การชำระเงิน -->
    <section v-if="!cancelled && o.status !== 'draft'" class="card">
      <div class="mb-2 flex items-center gap-2 text-[15px] font-semibold text-stone-900"><AppIcon name="wallet" class="text-brand-600" /> การชำระเงิน</div>
      <ul v-if="o.payments.length" class="mb-3 space-y-2">
        <li v-for="p in o.payments" :key="p.id" class="flex items-start justify-between gap-2 rounded-xl border border-stone-200/70 p-3">
          <span class="min-w-0">
            <b class="text-stone-900">{{ money(p.amount) }}</b>
            <span class="block text-xs text-stone-500"><template v-if="p.status === 'confirmed'">{{ p.method }} · {{ dateOnly(p.paidAt) }}</template><template v-else-if="p.dueAt">ชำระก่อน {{ dateTime(p.dueAt) }}</template><template v-else>{{ dateOnly(p.paidAt) }}</template></span>
          </span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="PAY_LABEL(p)[1]">{{ PAY_LABEL(p)[0] }}</span>
        </li>
      </ul>
      <p v-else class="mb-3 rounded-xl bg-stone-50 p-3 text-center text-stone-500">ยังไม่มีการชำระ</p>

      <template v-if="canPayUi">
        <p v-if="o.pay.block" class="rounded-xl bg-stone-50 p-3 text-stone-600">{{ o.pay.block }}</p>
        <button v-else-if="!open" class="btn-primary w-full" @click="open = true"><AppIcon name="wallet" :size="18" /> ชำระเงิน</button>
        <div v-else class="space-y-3">
          <div>
            <div class="label">ยอดที่จะโอน</div>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="chip" :class="f.mode === 'all' ? 'chip-on' : 'chip-off'" @click="pick('all')">ค้างทั้งหมด {{ money(room) }}</button>
              <button v-for="p in requests" :key="p.id" type="button" class="chip" :class="f.mode === 'req' && f.paymentId === p.id ? 'chip-on' : 'chip-off'" @click="pick('req', p)">ตามที่ร้านแจ้ง {{ money(p.amount) }}</button>
              <button type="button" class="chip" :class="f.mode === 'custom' ? 'chip-on' : 'chip-off'" @click="pick('custom')">ระบุเอง</button>
            </div>
            <input v-if="f.mode === 'custom'" v-model="f.custom" type="text" inputmode="decimal" class="input mt-2" placeholder="ยอดที่โอน (บาท)" aria-label="ยอดที่โอน" />
            <p v-if="f.mode === 'custom' && Number(f.custom) > room" class="mt-1 text-xs text-rose-600">เกินคงค้าง (ไม่เกิน {{ money(room) }})</p>
          </div>

          <div v-if="hasInfo" class="rounded-2xl border border-stone-200 bg-white p-3 text-center">
            <img v-if="qr" :src="qr" alt="QR พร้อมเพย์" class="mx-auto h-48 w-48" />
            <p v-else-if="info.promptpayId && amount > 0" class="py-8 text-stone-400">กำลังสร้าง QR…</p>
            <p v-if="amount > 0" class="text-base font-semibold text-stone-900">{{ money(amount) }}</p>
            <div class="mt-2 space-y-1 text-left text-stone-600">
              <div v-if="info.accountName">ชื่อบัญชี: <b class="text-stone-900">{{ info.accountName }}</b></div>
              <div v-if="info.bank || info.accountNo" class="flex flex-wrap items-center gap-2">{{ info.bank }} <b class="text-stone-900">{{ info.accountNo }}</b><button v-if="info.accountNo" type="button" class="chip chip-off h-7 px-2 text-xs" @click="copy(info.accountNo, 'acc')">{{ copied === 'acc' ? 'คัดลอกแล้ว' : 'คัดลอกเลขบัญชี' }}</button></div>
              <div v-if="info.promptpayId" class="flex flex-wrap items-center gap-2">พร้อมเพย์ <b class="text-stone-900">{{ info.promptpayId }}</b><button type="button" class="chip chip-off h-7 px-2 text-xs" @click="copy(info.promptpayId, 'pp')">{{ copied === 'pp' ? 'คัดลอกแล้ว' : 'คัดลอก' }}</button></div>
              <div v-if="info.note" class="text-xs text-stone-500">{{ info.note }}</div>
            </div>
          </div>
          <p v-else class="rounded-xl bg-amber-50 p-3 text-amber-800">ร้านยังไม่ได้ตั้งช่องทางรับชำระ กรุณาสอบถามร้าน</p>

          <div>
            <div class="label">สลิปการโอน <span class="text-rose-500">*</span></div>
            <label class="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-stone-200 p-3 text-stone-500 hover:border-brand-300">
              <img v-if="f.slip" :src="f.slip" alt="สลิป" class="h-14 w-14 rounded-lg object-cover" />
              <AppIcon v-else name="image" :size="22" />
              <span class="min-w-0 truncate">{{ f.slip ? f.slipName || 'เปลี่ยนรูปสลิป' : 'แนบรูปสลิป (ไม่เกิน 5 MB)' }}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" aria-label="แนบสลิป" @change="onSlip" />
            </label>
          </div>
          <div><label class="label">หมายเหตุ <span class="font-normal text-stone-400">(ไม่บังคับ)</span></label><input v-model="f.note" class="input" maxlength="200" /></div>
          <p v-if="f.error" class="text-rose-600" role="alert">{{ f.error }}</p>
          <div class="flex gap-2">
            <button class="btn-outline flex-1" @click="open = false">ยกเลิก</button>
            <button class="btn-primary flex-1" :disabled="f.busy || !(amount > 0)" @click="submit">ส่งสลิปแจ้งชำระ</button>
          </div>
          <p class="text-xs text-stone-400">ร้านจะตรวจสลิปแล้วยืนยันยอดให้ (ยังไม่ตัดเงินอัตโนมัติ)</p>
        </div>
      </template>
    </section>

    <CustomerTaxInvoice v-if="ctx.orderId && o.vatRate > 0 && !cancelled" :order-id="ctx.orderId" />

    <section v-if="canReview || o.review" class="card">
      <p v-if="o.review" class="text-stone-500">รีวิวของคุณ: {{ '★'.repeat(o.review.rating) }}</p>
      <button v-else class="btn-soft h-10" @click="emit('review', o)"><AppIcon name="star" :size="16" /> เขียนรีวิว</button>
    </section>
  </div>
</template>
