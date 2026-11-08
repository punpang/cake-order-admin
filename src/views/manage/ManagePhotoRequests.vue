<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findCustomer, findOrder, approvePhotoOptOut, rejectPhotoOptOut, allowPhotosAgain, photoStatusOf } from '../../data/store'
import { dateTime, formatPhone } from '../../lib/format'
import { smsChoice } from '../../lib/smsChoice'
import SmsTick from '../../components/SmsTick.vue'
import { askConfirmEx } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'

// คำขอ "ไม่ให้ใช้รูปงานเผยแพร่" ของลูกค้า (ส่งจากหน้าออร์เดอร์ลูกค้า ลิงก์/ล็อกอิน) · อนุมัติ = ลบรูปงานของออร์เดอร์นั้นทุกที่ (ออร์เดอร์/คลังรูป/รูปสินค้า) + ห้ามอัปโหลดใหม่ · ระหว่างรอ รูปถูกซ่อนจากเว็บ
const filter = ref('pending')
const FILTERS = [{ v: 'pending', l: 'รอตรวจสอบ' }, { v: 'approved', l: 'อนุมัติแล้ว' }, { v: 'rejected', l: 'ไม่อนุมัติ' }, { v: 'cancelled', l: 'ลูกค้ายกเลิก' }, { v: '', l: 'ทั้งหมด' }]
const STATUS = { pending: ['รอตรวจสอบ', 'bg-amber-50 text-amber-700'], approved: ['อนุมัติแล้ว', 'bg-emerald-50 text-emerald-700'], rejected: ['ไม่อนุมัติ', 'bg-rose-50 text-rose-700'], cancelled: ['ลูกค้ายกเลิก', 'bg-stone-100 text-stone-600'] }
const rows = computed(() => db.photoRequests.filter((r) => !filter.value || r.status === filter.value).map((r) => { const o = findOrder(r.orderId); return { r, o, c: findCustomer(r.customerId), n: o ? o.items.reduce((s, i) => s + (i.workPhotos || []).length, 0) : 0 } }))
const count = (v) => db.photoRequests.filter((r) => !v || r.status === v).length
const msg = ref('')
const err = ref('')
async function approve(row) {
  msg.value = err.value = ''
  const x = await askConfirmEx({ title: 'อนุมัติ · ลบรูปทุกที่', message: `ลบรูปงานทั้งหมด ${row.n} รูปของ ${row.o?.code} ออกจากออร์เดอร์ คลังรูป และรูปสินค้า (ถาวร) และห้ามอัปโหลดรูปใหม่ในออร์เดอร์นี้`, okText: 'อนุมัติและลบ', danger: true, checkbox: { label: 'แจ้งลูกค้าว่าลบรูปแล้ว', value: true }, ...(smsChoice(findCustomer(row.o?.customerId)) ? { checkbox2: { label: 'ส่ง SMS ด้วย', hint: formatPhone(findCustomer(row.o.customerId).phone), value: true } } : {}) })
  if (!x.ok) return
  const r = approvePhotoOptOut(row.r.id, { notify: x.checked, sms: x.checked2 !== false })
  if (r.error) err.value = r.error
  else msg.value = 'ลบรูปแล้ว'
}
const rj = reactive({ open: false, id: '', reason: '', notify: true, sms: true, cust: null, error: '' })
function openReject(row) { Object.assign(rj, { open: true, id: row.r.id, reason: '', notify: true, sms: true, cust: findCustomer(row.o?.customerId) || null, error: '' }) }
function doReject() {
  const r = rejectPhotoOptOut(rj.id, rj.reason, { notify: rj.notify, sms: rj.sms })
  if (r.error) return (rj.error = r.error)
  rj.open = false
  msg.value = 'บันทึกแล้ว รูปกลับมาแสดงตามเดิม'
}
</script>

<template>
  <ManageShell title="คำขอไม่เผยแพร่รูป" subtitle="ลูกค้าแจ้งไม่ให้ใช้รูปงานเผยแพร่ · ร้านอนุมัติก่อนลบ" :toolbar="false">
    <div class="space-y-3">
      <div class="flex flex-wrap gap-1.5"><button v-for="f in FILTERS" :key="f.v" type="button" class="chip" :class="filter === f.v ? 'chip-on' : 'chip-off'" @click="filter = f.v">{{ f.l }} ({{ count(f.v) }})</button></div>
      <p v-if="msg" class="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-800" role="status">{{ msg }}</p>
      <p v-if="err" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert">{{ err }}</p>
      <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีคำขอ</p>
      <article v-for="row in rows" :key="row.r.id" class="card space-y-2 text-sm">
        <div class="flex items-start justify-between gap-2"><div class="min-w-0"><RouterLink v-if="row.o" :to="`/admin/orders/${row.o.id}`" class="font-semibold text-brand-700 underline">{{ row.o.code }}</RouterLink> <span class="text-stone-600">{{ row.c?.name || 'ลูกค้า' }}</span><div class="text-xs text-stone-400">{{ dateTime(row.r.createdAt) }} · รูปงาน {{ row.n }} รูป</div></div><span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATUS[row.r.status][1]">{{ STATUS[row.r.status][0] }}</span></div>
        <p v-if="row.r.note" class="rounded-xl bg-stone-50 p-2 text-stone-700">หมายเหตุลูกค้า: {{ row.r.note }}</p>
        <p v-if="row.r.decisionNote" class="text-xs text-stone-500">เหตุผลร้าน: {{ row.r.decisionNote }}</p>
        <div v-if="row.r.status === 'pending'" class="flex gap-2"><button class="btn-danger flex-1" @click="approve(row)">อนุมัติ · ลบรูปทุกที่</button><button class="btn-outline flex-1" @click="openReject(row)">ไม่อนุมัติ</button></div>
        <button v-if="row.r.status === 'approved' && row.o && photoStatusOf(row.o) === 'revoked'" class="btn-soft" @click="allowPhotosAgain(row.o.id)">ลูกค้าเปลี่ยนใจ · อนุญาตให้ใช้รูปได้อีก</button>
      </article>
    </div>
    <AppModal v-if="rj.open" title="ไม่อนุมัติคำขอ" @close="rj.open = false">
      <div class="space-y-3 text-sm"><p class="text-stone-600">รูปจะกลับมาแสดงตามเดิม ใส่เหตุผลเพื่อแจ้งลูกค้า (ควรคุยกับลูกค้าก่อน)</p><input v-model="rj.reason" class="input" maxlength="300" aria-label="เหตุผลไม่อนุมัติ" /><label class="flex items-center gap-2"><input v-model="rj.notify" type="checkbox" class="h-4 w-4" /> แจ้งลูกค้า</label><SmsTick v-model="rj.sms" :customer="rj.cust" :show="rj.notify" /><p v-if="rj.error" class="text-rose-600" role="alert">{{ rj.error }}</p></div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="rj.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="doReject">บันทึก</button></template>
    </AppModal>
  </ManageShell>
</template>
