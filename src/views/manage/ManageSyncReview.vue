<script setup>
// คิวรอตรวจของผู้จัดการ: ออร์เดอร์ใหม่ที่ระบบไม่รับ (เก็บจากเครื่องพนักงานก่อนเอาออก)
// ส่งซ้ำ (บิลหน้าร้าน) · แก้การชำระแล้วส่ง · ปิดพร้อมเหตุผล (คืนคูปองที่จองไว้) · ทุกการทำงานตรวจและบันทึกโดยฐานข้อมูล
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { db } from '../../data/store'
import { dateTime, money } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import { getSupabase, supabaseEnabled } from '../../lib/supabase.js'
import { fetchReview, resendReview, saveEditedReview, closeReview, paymentsOf, withPayments, paymentsError, resendBlockers, reviewExtras, needsConfirm } from '../../lib/syncReview'
import { reasonText, ageText, balanceText, itemsText, billSummary, customerNames, activePays } from '../../lib/reviewView.js'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'

const FILTERS = [
  { v: 'open', l: 'รอตรวจ' },
  { v: 'resent', l: 'ส่งซ้ำแล้ว' },
  { v: 'closed', l: 'ปิดแล้ว' },
]
const STATUS = {
  open: ['รอตรวจ', 'bg-warning-50 text-warning-700'],
  resent: ['ส่งซ้ำแล้ว', 'bg-success-50 text-success-700'],
  closed: ['ปิดแล้ว', 'bg-stone-100 text-stone-600'],
}
const filter = ref('open')
const rows = ref([])
const names = ref(new Map()) // รหัสลูกค้า → ชื่อ (ว่าง = อ่านไม่ได้ตามสิทธิ์ ให้แสดงรหัสแทน)
const loading = ref(false)
const err = ref('')
const msg = ref('')
const acting = ref('') // รายการที่กำลังดำเนินการ (กันกดซ้ำระหว่างรอฐานข้อมูล)
const confirmed = reactive({}) // ผู้จัดการติ๊กว่าตรวจคูปอง/ส่วนลดของรายการนี้แล้ว (รายการ id → true)
const edit = reactive({ row: null, payments: [], off: {}, error: '' }) // off = การชำระที่ขีดฆ่าไว้ (index → true)
const shut = reactive({ row: null, note: '', error: '' })

const staffName = (id) => (id ? db.users.find((u) => u.id === id)?.name || 'พนักงาน' : '-')
const channelName = (c) => (c === 'pos' ? 'หน้าร้าน' : c || '-')
const customerOf = (r) => names.value.get(r.payload?.customerId) || r.payload?.customerId || '-'
const reasonOf = (r) => reasonText(r.reason_message)
const itemsOf = (r) => itemsText(r.edited_payload || r.payload)
const sumOf = (r) => billSummary(r.edited_payload || r.payload)
const balanceOf = (r) => balanceText(sumOf(r))
const payOf = (r) => (r.edited_payload || r.payload)?.payments || []
const blockersOf = (r) => resendBlockers(r.edited_payload || r.payload)
const extrasOf = (r) => reviewExtras(r.edited_payload || r.payload)
const confirmNeeded = (r) => needsConfirm(r.edited_payload || r.payload)
const canResend = (r) => r.channel === 'pos' && !blockersOf(r).length && (!confirmNeeded(r) || !!confirmed[r.id])
// ข้อความใต้ปุ่มเมื่อปุ่มส่งซ้ำยังกดไม่ได้เพราะยังไม่ได้ติ๊กยืนยัน (เหตุอื่นมีข้อความของตัวเองอยู่แล้ว)
const sendHint = (r) => (r.status === 'open' && r.channel === 'pos' && !blockersOf(r).length && confirmNeeded(r) && !confirmed[r.id]
  ? 'ติ๊กช่อง "ตรวจคูปองและส่วนลดของรายการนี้แล้ว" ก่อน จึงส่งซ้ำได้'
  : '')

async function load() {
  loading.value = true
  err.value = ''
  try {
    if (!supabaseEnabled) { rows.value = []; err.value = 'ต้องเชื่อมต่อฐานข้อมูลจึงจะดูคิวนี้ได้'; return }
    const client = await getSupabase()
    const r = await fetchReview(client, filter.value)
    if (r.error) { err.value = r.error; return }
    rows.value = r.items
    names.value = await customerNames(client, r.items.map((x) => x.payload?.customerId))
  } finally { loading.value = false }
}
watch(filter, load)
onMounted(load)

// ทำงานกับรายการหนึ่ง: สำเร็จ → โหลดคิวใหม่ · ไม่สำเร็จ → แสดงเหตุผลจากฐานข้อมูล (รายการยังอยู่ในคิว ทำซ้ำได้)
async function run(row, job) {
  acting.value = row.id
  msg.value = err.value = ''
  try {
    const res = await job(await getSupabase())
    if (res.error) { err.value = res.error; return false }
    msg.value = 'บันทึกแล้ว'
    await load()
    return true
  } catch (e) {
    err.value = e.message || 'ทำรายการไม่สำเร็จ'
    return false
  } finally { acting.value = '' }
}

async function resend(row) {
  const ok = await askConfirm({
    title: 'ส่งซ้ำออร์เดอร์',
    message: `ส่ง ${row.order_code || row.order_id} เข้าระบบอีกครั้งตามข้อมูลที่เก็บไว้ · ฐานข้อมูลตรวจกติกาทั้งหมดอีกครั้ง ถ้าไม่ผ่านจะแจ้งเหตุผลให้`,
    okText: 'ส่งซ้ำ',
  })
  if (ok) await run(row, (c) => resendReview(c, row, !!confirmed[row.id]))
}

function openEdit(row) {
  Object.assign(edit, { row, payments: paymentsOf(row.edited_payload || row.payload), off: {}, error: '' })
}
// ยอดบิลและส่วนต่างแบบสด: คำนวณจากการชำระที่ยังไม่ถูกขีดฆ่า (ค่าเดียวกับที่จะบันทึก)
const editSummary = computed(() => (edit.row ? billSummary(withPayments(edit.row.edited_payload || edit.row.payload, activePays(edit.payments, edit.off))) : null))
const editBalance = computed(() => balanceText(editSummary.value))
async function saveEdit() {
  const row = edit.row
  const active = activePays(edit.payments, edit.off)
  const bad = paymentsError(active)
  if (bad) return (edit.error = bad)
  const next = withPayments(row.edited_payload || row.payload, active)
  const ok = await run(row, async (c) => {
    const s = await saveEditedReview(c, row, next)
    return s.error ? s : resendReview(c, row, !!confirmed[row.id])
  })
  if (ok) edit.row = null
  else edit.error = err.value
}

function openClose(row) {
  Object.assign(shut, { row, note: '', error: '' })
}
async function doClose() {
  const note = shut.note.trim()
  if (!note) return (shut.error = 'กรุณาระบุเหตุผลการปิดรายการ')
  const row = shut.row
  const ok = await run(row, (c) => closeReview(c, row, note))
  if (ok) shut.row = null
  else shut.error = err.value
}
</script>

<template>
  <ManageShell title="คิวรอตรวจออร์เดอร์" :subtitle="`${rows.length} รายการ`" :toolbar="false">
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button v-for="f in FILTERS" :key="f.v" type="button" class="chip min-h-11" :class="filter === f.v ? 'chip-on' : 'chip-off'" :aria-pressed="filter === f.v" @click="filter = f.v">{{ f.l }}</button>
    </div>
    <p class="mb-3 rounded-xl bg-stone-50 p-3 text-sm text-stone-600">ออร์เดอร์เหล่านี้ระบบไม่รับ จึงเก็บไว้ที่นี่ก่อนเอาออกจากเครื่องพนักงาน · ตรวจก่อนส่งซ้ำหรือปิดพร้อมเหตุผล</p>
    <p v-if="msg" class="mb-3 rounded-xl bg-success-50 p-3 text-sm text-success-800" role="status">{{ msg }}</p>
    <p v-if="err" class="mb-3 flex items-center gap-2 rounded-xl bg-danger-50 p-3 text-sm text-danger-700" role="alert"><AppIcon name="alert" :size="16" /> {{ err }}</p>
    <p v-if="!loading && !rows.length && !err" class="card py-10 text-center text-stone-500">ไม่มีรายการ</p>

    <div class="grid gap-3 lg:grid-cols-2 lg:items-start">
      <article v-for="r in rows" :key="r.id" class="card space-y-3">
        <div class="flex items-center gap-2">
          <b class="min-w-0 flex-1 truncate text-stone-900">{{ r.order_code || r.order_id }}</b>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS[r.status][1]">{{ STATUS[r.status][0] }}</span>
        </div>
        <p class="text-xs text-stone-500">{{ channelName(r.channel) }} · ลูกค้า {{ customerOf(r) }} · เข้าคิว {{ ageText(r.created_at) }} · โดย {{ staffName(r.created_by) }}</p>
        <div class="rounded-xl bg-danger-50 p-2.5 text-sm text-danger-800">
          <p class="font-medium">{{ reasonOf(r).label }}</p>
          <p v-if="reasonOf(r).detail" class="mt-0.5 break-words text-xs">{{ reasonOf(r).detail }}</p>
        </div>
        <p v-if="itemsOf(r)" class="text-sm text-stone-600">{{ itemsOf(r) }}</p>
        <ul class="space-y-1 text-sm text-stone-700">
          <li v-for="(p, i) in payOf(r)" :key="'p' + i" class="flex justify-between gap-2">
            <span>{{ p.posMethod || 'ชำระ' }}<template v-if="p.cardConfirmed"> · ยืนยันบัตรแล้ว</template></span>
            <b>{{ money(p.amount) }}</b>
          </li>
          <li v-if="!payOf(r).length" class="text-stone-500">ไม่มีรายการชำระเงิน</li>
        </ul>
        <ul v-if="extrasOf(r).coupons.length || extrasOf(r).adjustment" class="space-y-1 rounded-xl bg-stone-50 p-2.5 text-sm text-stone-700">
          <li v-for="(u, i) in extrasOf(r).coupons" :key="'c' + i" class="flex justify-between gap-2">
            <span>คูปอง {{ u.name }}</span><b class="text-danger-700">−{{ money(u.amount) }}</b>
          </li>
          <li v-if="extrasOf(r).adjustment" class="flex justify-between gap-2">
            <span>ปรับราคาเอง</span><b>{{ money(extrasOf(r).adjustment) }}</b>
          </li>
        </ul>
        <div v-if="balanceOf(r)" class="space-y-1 border-t border-stone-100 pt-2 text-sm">
          <p class="flex justify-between gap-2"><span class="text-stone-500">ยอดบิลหลังส่วนลด</span><b>{{ money(sumOf(r).total) }}</b></p>
          <p class="flex justify-between gap-2"><span class="text-stone-500">ชำระแล้ว</span><b>{{ money(sumOf(r).paid) }}</b></p>
          <p class="text-right text-sm font-semibold" :class="balanceOf(r).tone">{{ balanceOf(r).text }}</p>
        </div>
        <p v-if="blockersOf(r).length && r.status === 'open'" class="rounded-xl bg-warning-50 p-2.5 text-sm text-warning-800">ส่งซ้ำจากคิวไม่ได้: {{ blockersOf(r).join(' · ') }} · ให้ปิดพร้อมเหตุผลแล้วบันทึกใหม่</p>
        <p v-if="r.edited_payload && r.status === 'open'" class="text-xs text-warning-700">แก้การชำระไว้แล้ว ยังไม่ส่ง</p>

        <template v-if="r.status === 'open'">
          <p v-if="r.channel !== 'pos'" class="text-xs text-stone-500">ช่องทางนี้ส่งซ้ำจากหน้านี้ไม่ได้ · ปิดพร้อมเหตุผลแล้วสร้างใหม่ในระบบ</p>
          <label v-if="confirmNeeded(r)" class="flex min-h-11 items-center gap-2 text-sm text-stone-700">
            <input v-model="confirmed[r.id]" type="checkbox" class="h-5 w-5" /> ตรวจคูปองและส่วนลดของรายการนี้แล้ว
          </label>
          <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <button type="button" class="btn-primary" :disabled="!!acting || !canResend(r)" @click="resend(r)">{{ acting === r.id ? 'กำลังทำ…' : 'ส่งซ้ำ' }}</button>
            <button type="button" class="btn-outline" :disabled="!!acting || r.channel !== 'pos' || blockersOf(r).length > 0" @click="openEdit(r)">แก้การชำระแล้วส่ง</button>
            <button type="button" class="btn-outline" :disabled="!!acting" @click="openClose(r)">ปิดพร้อมเหตุผล</button>
          </div>
          <p v-if="sendHint(r)" class="text-xs text-stone-600">{{ sendHint(r) }}</p>
        </template>
        <p v-else class="text-xs text-stone-500">
          <template v-if="r.status === 'resent'">ส่งซ้ำเมื่อ {{ dateTime(r.resolved_at) }} โดย {{ staffName(r.resolved_by) }}</template>
          <template v-else>ปิดเมื่อ {{ dateTime(r.resolved_at) }} โดย {{ staffName(r.resolved_by) }} · เหตุผล: {{ r.resolution_note }}</template>
        </p>
      </article>
    </div>

    <AppModal v-if="edit.row" title="แก้การชำระแล้วส่ง" @close="edit.row = null">
      <div class="space-y-3">
        <p class="text-sm text-stone-600">แก้ได้เฉพาะยอดและการยืนยันบัตร · ขีดฆ่ารายการที่ไม่ควรนับได้ (กดเลิกทำได้) · ส่วนอื่น (แต้ม คูปอง ลูกค้า) แก้ที่นี่ไม่ได้ ถ้าปัญหาอยู่ตรงนั้นให้ปิดพร้อมเหตุผล</p>
        <p v-if="!edit.payments.length" class="text-sm text-stone-500">ไม่มีรายการชำระเงิน</p>
        <div v-for="(p, i) in edit.payments" :key="i" class="space-y-2 rounded-xl border border-stone-200 p-3" :class="edit.off[i] ? 'bg-stone-50' : ''">
          <div class="flex items-center gap-2">
            <span class="min-w-0 flex-1 text-sm text-stone-700" :class="edit.off[i] ? 'text-stone-400 line-through' : ''">{{ p.posMethod || 'ชำระ' }}</span>
            <input v-model.number="p.amount" :disabled="!!edit.off[i]" type="number" inputmode="decimal" min="0" step="any" class="input w-32 text-right" :aria-label="`ยอดรายการที่ ${i + 1}`" />
            <span class="text-sm text-stone-500">฿</span>
            <button type="button" class="btn-outline h-11 px-3" :class="edit.off[i] ? 'text-success-700' : 'text-danger-700'" :aria-pressed="!!edit.off[i]" @click="edit.off[i] = !edit.off[i]">{{ edit.off[i] ? 'เลิกทำ' : 'ขีดฆ่า' }}</button>
          </div>
          <label v-if="p.posMethod === 'card' && !edit.off[i]" class="flex min-h-11 items-center gap-2 text-sm text-stone-700">
            <input v-model="p.cardConfirmed" type="checkbox" class="h-5 w-5" /> ตรวจสลิปบัตรแล้ว ยืนยันว่ารับเงินบัตรจริง
          </label>
        </div>
        <div v-if="editSummary" class="space-y-1 border-t border-stone-100 pt-2 text-sm">
          <p class="flex justify-between gap-2"><span class="text-stone-500">ยอดบิลหลังส่วนลด</span><b>{{ money(editSummary.total) }}</b></p>
          <p class="flex justify-between gap-2"><span class="text-stone-500">ชำระแล้ว (หลังแก้)</span><b>{{ money(editSummary.paid) }}</b></p>
          <p class="text-right font-semibold" :class="editBalance?.tone">{{ editBalance?.text }}</p>
        </div>
        <p v-if="edit.error" class="flex items-center gap-2 text-sm text-danger-700" role="alert"><AppIcon name="alert" :size="16" /> {{ edit.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="edit.row = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!!acting" @click="saveEdit">บันทึกและส่งซ้ำ</button>
      </template>
    </AppModal>

    <AppModal v-if="shut.row" title="ปิดรายการพร้อมเหตุผล" @close="shut.row = null">
      <div class="space-y-3">
        <p class="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">ระบบจะไม่บันทึกออร์เดอร์นี้ ถ้ามีการรับเงินไว้แล้ว ต้องจัดการเงินนั้นเอง (คืนเงิน หรือบันทึกในบัญชี)</p>
        <p class="text-sm text-stone-600">คูปองที่จองไว้กับออร์เดอร์นี้จะถูกคืนให้ลูกค้าใช้ได้อีก</p>
        <textarea v-model="shut.note" rows="3" maxlength="300" class="input" placeholder="เหตุผล เช่น ลูกค้ายกเลิกและโอนคืนแล้ว"></textarea>
        <p v-if="shut.error" class="flex items-center gap-2 text-sm text-danger-700" role="alert"><AppIcon name="alert" :size="16" /> {{ shut.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="shut.row = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!!acting" @click="doClose">ปิดรายการ</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
