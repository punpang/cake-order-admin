<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findCustomer, approveDeletion, rejectDeletion, deletionBlockers } from '../../data/store'
import { formatPhone, dateTime } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'

// คำขอลบข้อมูลของลูกค้า (ส่งจากหน้าบัญชีของฉัน หลังยืนยัน OTP) · แอดมินอนุมัติ/ปฏิเสธ
// อนุมัติ = ลบตัวตน เก็บออร์เดอร์และการชำระแบบนิรนาม · ลบไม่ได้ถ้ามีออร์เดอร์ที่ยังไม่จบหรือยอดค้าง
const filter = ref('pending')
const FILTERS = [
  { v: 'pending', l: 'รอตรวจสอบ' },
  { v: 'approved', l: 'อนุมัติแล้ว' },
  { v: 'rejected', l: 'ปฏิเสธ' },
  { v: '', l: 'ทั้งหมด' },
]
const STATUS = { pending: ['รอตรวจสอบ', 'bg-amber-50 text-amber-700'], approved: ['อนุมัติแล้ว', 'bg-emerald-50 text-emerald-700'], rejected: ['ปฏิเสธ', 'bg-rose-50 text-rose-700'] }
const rows = computed(() =>
  db.deletionRequests
    .filter((r) => !filter.value || r.status === filter.value)
    .map((r) => ({ r, c: findCustomer(r.customerId), blockers: r.status === 'pending' ? deletionBlockers(r.customerId) : [], orders: db.orders.filter((o) => o.customerId === r.customerId).length })),
)
const count = (v) => db.deletionRequests.filter((r) => !v || r.status === v).length

const msg = ref('')
const err = ref('')
async function approve(row) {
  msg.value = err.value = ''
  const ok = await askConfirm({
    title: 'อนุมัติลบข้อมูล',
    message: `ลบตัวตนของ ${row.c?.name || 'ลูกค้า'} ถาวร (ชื่อ เบอร์ บัญชี แชท คะแนน/คูปอง รีวิว และข้อมูลส่วนตัวในออร์เดอร์) · เก็บออร์เดอร์ ${row.orders} รายการแบบไม่ระบุตัวตน ย้อนกลับไม่ได้`,
    okText: 'อนุมัติและลบ',
    danger: true,
  })
  if (!ok) return
  const res = approveDeletion(row.r.id)
  if (res.ok) msg.value = 'ลบข้อมูลแล้ว'
  else err.value = res.error
}

const rej = reactive({ row: null, reason: '', error: '' })
const openReject = (row) => Object.assign(rej, { row, reason: '', error: '' })
function reject() {
  const res = rejectDeletion(rej.row.r.id, rej.reason)
  if (res.ok) rej.row = null
  else rej.error = res.error
}
</script>

<template>
  <ManageShell title="คำขอลบข้อมูลลูกค้า" :subtitle="`${count('pending')} รอตรวจสอบ`" :toolbar="false">
    <div class="mb-4 flex gap-2 overflow-x-auto pb-1">
      <button v-for="f in FILTERS" :key="f.v" type="button" class="chip" :class="filter === f.v ? 'chip-on' : 'chip-off'" @click="filter = f.v">{{ f.l }} ({{ count(f.v) }})</button>
    </div>
    <p v-if="msg" class="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{{ msg }}</p>
    <p v-if="err" class="mb-3 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>

    <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีคำขอ</p>
    <div class="grid gap-3 lg:grid-cols-2 lg:items-start">
      <div v-for="row in rows" :key="row.r.id" class="card space-y-2">
        <div class="flex items-center gap-2">
          <b class="min-w-0 flex-1 truncate text-stone-900">{{ row.c?.name || 'ลูกค้า' }}</b>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS[row.r.status][1]">{{ STATUS[row.r.status][0] }}</span>
        </div>
        <div class="text-sm text-stone-600"><template v-if="row.c?.phone">{{ formatPhone(row.c.phone) }} · </template>ออร์เดอร์ {{ row.orders }} รายการ · ส่งคำขอ {{ dateTime(row.r.createdAt) }}</div>
        <p v-if="row.r.customerNote" class="rounded-xl bg-stone-50 p-2.5 text-sm text-stone-700">ลูกค้าแจ้ง: {{ row.r.customerNote }}</p>
        <template v-if="row.r.status === 'pending'">
          <ul v-if="row.blockers.length" class="space-y-1 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <li v-for="b in row.blockers" :key="b" class="flex gap-2"><AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" /> {{ b }}</li>
            <li class="text-xs">อนุมัติได้เมื่อออร์เดอร์จบและไม่มียอดค้าง · หรือปฏิเสธพร้อมแจ้งเหตุผล</li>
          </ul>
          <div class="flex gap-2">
            <button class="btn-danger flex-1" :disabled="row.blockers.length > 0" @click="approve(row)">อนุมัติและลบข้อมูล</button>
            <button class="btn-outline flex-1" @click="openReject(row)">ปฏิเสธ</button>
          </div>
        </template>
        <p v-else class="text-xs text-stone-500">
          {{ row.r.status === 'approved' ? 'อนุมัติ' : 'ปฏิเสธ' }}เมื่อ {{ dateTime(row.r.decidedAt) }} โดย {{ row.r.decidedBy }}<template v-if="row.r.reason"> · เหตุผล: {{ row.r.reason }}</template>
        </p>
      </div>
    </div>

    <AppModal v-if="rej.row" title="ปฏิเสธคำขอ" @close="rej.row = null">
      <div class="space-y-3">
        <p class="text-sm text-stone-600">ลูกค้าจะเห็นเหตุผลนี้ในหน้าบัญชีของเขา</p>
        <textarea v-model="rej.reason" rows="3" maxlength="300" class="input" placeholder="เหตุผล เช่น ยังมีออร์เดอร์ที่ต้องรับ"></textarea>
        <p v-if="rej.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ rej.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rej.row = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="reject">ปฏิเสธคำขอ</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
