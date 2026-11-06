<script setup>
import { reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { closePeriod, reopenPeriod } from '../../data/acct'
import { askConfirm } from '../../lib/confirm'
import { toDateStr, dateOnly } from '../../lib/format'

// ปิดงวด: แช่แข็งรายการอัตโนมัติถึงวันที่ที่เลือก + ล็อกการแก้บันทึกเอง
const f = reactive({ date: toDateStr(new Date(Date.now() - 864e5)), error: '', ok: '' })
const reopenTo = ref('')
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
      <p v-if="f.error" class="text-sm text-rose-600" role="alert">{{ f.error }}</p>
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
