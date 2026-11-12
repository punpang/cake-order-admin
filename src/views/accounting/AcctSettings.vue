<script setup>
import { reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { closePeriod, reopenPeriod, saveAcctSettings } from '../../data/acct'
import { askConfirm } from '../../lib/confirm'
import { toDateStr, dateOnly } from '../../lib/format'

// ปิดงวด: แช่แข็งรายการอัตโนมัติถึงวันที่ที่เลือก + ล็อกการแก้บันทึกเอง
const f = reactive({ date: toDateStr(new Date(Date.now() - 864e5)), error: '', ok: '' })
const reopenTo = ref('')
const st = reactive({ entityType: db.acct.settings.entityType, fiscalYearStartMonth: db.acct.settings.fiscalYearStartMonth, paidInCapital: db.acct.settings.paidInCapital || 0, assetMinCost: db.acct.settings.assetMinCost ?? 500, error: '', ok: '' })
function saveSt() {
  st.error = st.ok = ''
  const r = saveAcctSettings({ entityType: st.entityType, fiscalYearStartMonth: st.fiscalYearStartMonth, paidInCapital: st.paidInCapital, assetMinCost: st.assetMinCost })
  if (r.error) return (st.error = r.error)
  st.ok = 'บันทึกแล้ว'
}
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม']
async function close() {
  f.error = f.ok = ''
  if (!(await askConfirm({ title: 'ปิดงวดบัญชี', message: `ปิดถึง ${dateOnly(f.date)} · หลังปิดแก้รายการถึงวันนั้นไม่ได้ (ต้องกลับรายการ)`, okText: 'ปิดงวด' }))) return
  const r = closePeriod(f.date)
  if (r.error) return (f.error = r.error)
  f.ok = `ปิดงวดแล้ว แช่แข็ง ${r.frozen} รายการอัตโนมัติ`
}
async function reopen() {
  f.error = f.ok = ''
  if (!(await askConfirm({ title: 'เปิดงวดกลับ', message: reopenTo.value ? `ถอยวันที่ปิดงวดเป็น ${dateOnly(reopenTo.value)}` : 'เปิดงวดทั้งหมด', okText: 'เปิดงวด', danger: true }))) return
  const r = reopenPeriod(reopenTo.value)
  if (r.error) return (f.error = r.error)
  f.ok = 'เปิดงวดกลับแล้ว'
}
</script>

<template>
  <div class="space-y-4">
    <section v-if="can('acctSettings')" class="card space-y-3" aria-label="ตั้งค่าบัญชี">
      <div class="card-title">ตั้งค่าบัญชี</div>
      <div class="grid grid-cols-2 gap-1 seg-grid"><button v-for="m in [['juristic', 'นิติบุคคล'], ['individual', 'บุคคลธรรมดา']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="st.entityType === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="st.entityType = m[0]">{{ m[1] }}</button></div>
      <div class="grid grid-cols-2 gap-3"><div><label class="label">เริ่มปีบัญชีเดือน</label><select v-model="st.fiscalYearStartMonth" class="input" aria-label="เดือนเริ่มปีบัญชี"><option v-for="(m, i) in MONTHS" :key="i" :value="i + 1">{{ m }}</option></select></div><div><label class="label">ทุนชำระแล้ว (บาท)</label><input v-model="st.paidInCapital" v-num.dec class="input" aria-label="ทุนชำระแล้ว" /></div></div>
      <div><label class="label">สินทรัพย์ต่ำกว่า (บาท) ตัดเป็นค่าใช้จ่ายทันที</label><input v-model="st.assetMinCost" v-num.dec class="input" aria-label="เกณฑ์สินทรัพย์" /></div>
      <button class="btn-soft w-full" @click="saveSt">บันทึกตั้งค่า</button>
      <p v-if="st.error" class="text-sm text-rose-700" role="alert">{{ st.error }}</p>
      <p v-if="st.ok" class="text-sm text-emerald-700" role="status">{{ st.ok }}</p>
    </section>
    <section class="card space-y-3">
      <div class="card-title">ปิดงวดบัญชี</div>
      <p class="text-sm text-stone-600">ปิดงวดถึง: <b>{{ db.acct.closedThrough ? dateOnly(db.acct.closedThrough) : 'ยังไม่เคยปิด' }}</b></p>
      <template v-if="can('acctClose')">
        <div><label class="label">ปิดงวดถึงวันที่</label><input v-model="f.date" type="date" class="input" :max="toDateStr(new Date())" aria-label="ปิดงวดถึงวันที่" /></div>
        <button class="btn-primary w-full" @click="close">ปิดงวด</button>
        <div v-if="db.acct.closedThrough" class="border-t border-stone-100 pt-3">
          <label class="label">เปิดงวดกลับ (ถอยไปถึงวันที่ — ว่าง = เปิดทั้งหมด)</label>
          <input v-model="reopenTo" type="date" class="input mb-2" aria-label="เปิดงวดกลับถึงวันที่" />
          <button class="btn-danger w-full" @click="reopen">เปิดงวดกลับ</button>
        </div>
      </template>
      <p v-else class="text-sm text-stone-500">ต้องมีสิทธิ์ "ปิดงวด/เปิดงวด"</p>
      <p v-if="f.error" class="text-sm text-rose-700" role="alert">{{ f.error }}</p>
      <p v-if="f.ok" class="text-sm text-emerald-700" role="status">{{ f.ok }}</p>
    </section>
    <section class="card text-sm text-stone-600">
      <div class="card-title">หลักการบันทึกบัญชี (ฐานสิทธิ)</div>
      <ul class="list-disc space-y-1 pl-5">
        <li>รับเงินจากลูกค้า → พักเป็น "รายได้รับล่วงหน้า" + ภาษีขายตามสัดส่วน (เกิดตอนรับเงิน)</li>
        <li>ส่งมอบ → รับรู้รายได้ + ต้นทุนขายตามสูตร · ส่วนลดจากคะแนน/คูปองเป็นค่าใช้จ่าย</li>
        <li>ยกเลิก → กลับรายการ · เงินคืนตามช่องทาง · ส่วนที่ไม่คืนเป็นรายได้อื่น (ริบมัดจำ)</li>
        <li>ปิดงวดแล้วตัวเลขย้อนหลังไม่เปลี่ยนแม้แก้ออร์เดอร์เดิม</li>
      </ul>
    </section>
  </div>
</template>
