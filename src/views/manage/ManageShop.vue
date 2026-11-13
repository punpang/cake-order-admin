<script setup>
import { validTaxId, validBranch } from '../../lib/acct/taxid'
import { computed, reactive, ref } from 'vue'
import { db, saveShopSettings, saveSlipQrSettings, pickupSlots } from '../../data/store'
import { toDateStr, money } from '../../lib/format'
import { deliveryFee } from '../../lib/delivery'
import { BANKS, bankByCode } from '../../lib/payFields'
import { clonePayment, validatePayAccount, newPayAccountId } from '../../lib/payAccounts'
import { cleanClosures, describeClosures, DOW_NAMES, MAX_ROWS } from '../../lib/shopHours'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import TaxAddressField from '../../components/TaxAddressField.vue'

const hm = /^([01]\d|2[0-3]):[0-5]\d$/
const shopAddrChoices = computed(() => [
  { label: 'ใช้ที่อยู่ร้านหน้าเว็บ', text: /ตัวอย่าง/.test(db.storefront?.address || '') ? '' : db.storefront?.address },
  { label: 'ใช้ที่อยู่ตามข้อมูลกฎหมาย', text: db.legal?.contact?.address },
])
const st = reactive({ ...db.shop, pickupRemindHours: db.shop.pickupRemindHours ?? 24, dueSoonHours: db.shop.dueSoonHours ?? 2, pointsExpireDays: db.shop.pointsExpireDays ?? 30, installmentAlertDays: db.shop.installmentAlertDays ?? 1, merchantCode: db.shop.merchantCode ?? '', billerId: db.shop.billerId ?? '', vat: { ...db.shop.vat }, payDueRule: { ...db.shop.payDueRule }, delivery: { ...db.shop.delivery }, payment: clonePayment(db.shop.payment), closures: JSON.parse(JSON.stringify(db.shop.closures)) })
// ---- วัน-เวลาปิดร้าน ----
const DOWS = [1, 2, 3, 4, 5, 6, 0] // จันทร์เริ่ม
const flip = (arr, d) => (arr.includes(d) ? arr.splice(arr.indexOf(d), 1) : arr.push(d))
const today = toDateStr(new Date())
const addRange = () => st.closures.ranges.push({ id: `r${Date.now()}`, from: today, to: today, reason: '' })
const addHours = () => st.closures.hours.push({ id: `h${Date.now()}`, days: [], from: '12:00', to: '13:00', reason: '' })
const closureLines = computed(() => describeClosures(cleanClosures(st.closures).value || {}))
const exampleFee = computed(() => deliveryFee(8, st.delivery))
const error = ref('')
const saved = ref(false)
const STEPS = [15, 30, 60]
const NEAR = [1, 2, 3, 6, 0]
const num = (v) => Number(v) >= 0 && v !== ''
// ---- สลิปในแชท (บันทึกแยกจากฟอร์มร้าน) ----
const ocrOf = (q) => ({ wai: q.ocr?.wai === true, claude: (q.ocr?.claude ?? q.ocr?.enabled) === true })
const acOf = (q) => ({ enabled: q.autoConfirm?.enabled === true, days: q.autoConfirm?.days ?? 3 })
const sq = reactive({ ...JSON.parse(JSON.stringify(db.slipQr)), ocr: ocrOf(db.slipQr), autoConfirm: acOf(db.slipQr) })
const slipErr = ref('')
const slipSaved = ref(false)
function saveSlip() {
  const r = saveSlipQrSettings(sq)
  if (r?.error) return (slipErr.value = r.error)
  slipErr.value = ''
  Object.assign(sq, { ...JSON.parse(JSON.stringify(db.slipQr)), ocr: ocrOf(db.slipQr), autoConfirm: acOf(db.slipQr) })
  slipSaved.value = true
  setTimeout(() => (slipSaved.value = false), 1500)
}

// บัญชีรับชำระ: เพิ่ม/ลบ/เลือกธนาคาร (ไม่จำกัดจำนวน)
const addPayAccount = (kind) => st.payment.accounts.push({ id: newPayAccountId(), kind, show: true, bankCode: '', bankName: '', accountNo: '', promptpayId: '', accountName: '' })
const removePayAccount = (i) => st.payment.accounts.splice(i, 1)
function setBank(a, code) { a.bankCode = code; a.bankName = bankByCode(code)?.name || '' }

function save() {
  if (!st.open || !st.close || st.close <= st.open) return (error.value = 'เวลาปิดต้องหลังเวลาเปิด')
  if (!(Number(st.slotMinutes) >= 5)) return (error.value = 'ช่วงเวลาต้องอย่างน้อย 5 นาที')
  if (![st.leadPickup, st.leadDelivery, st.birthdayDays].every(num)) return (error.value = 'กรอกตัวเลขตั้งแต่ 0 ขึ้นไป')
  const mcDigits = String(st.merchantCode || '').replace(/\D/g, '')
  if (mcDigits && !/^\d{6,20}$/.test(mcDigits)) return (error.value = 'รหัสร้านค้าต้องเป็นตัวเลข 6–20 หลัก (เว้นว่างถ้าไม่ตรวจสลิป)')
  if (!(st.pickupRemindHours >= 1 && st.pickupRemindHours <= 72) || !(st.dueSoonHours >= 1 && st.dueSoonHours <= 12) || !(st.pointsExpireDays >= 1 && st.pointsExpireDays <= 90) || !(st.installmentAlertDays >= 0 && st.installmentAlertDays <= 30)) return (error.value = 'ตรวจเวลาแจ้งเตือน (นัดรับ 1–72 ชม. · งานใกล้เวลา 1–12 ชม. · คะแนนหมดอายุ 1–90 วัน · ผ่อนชำระ 0–30 วัน)')
  if (!(Number(st.payDueMin) >= 1) || Number(st.payDueMin) > 10080) return (error.value = 'กำหนดชำระเริ่มต้นต้องอยู่ระหว่าง 1–10080 นาที')
  const pr = st.payDueRule
  if (!(Number(pr.hoursBefore) >= 1 && Number(pr.hoursBefore) <= 720) || !(Number(pr.daysBefore) >= 0 && Number(pr.daysBefore) <= 30) || !hm.test(pr.atTime) || !hm.test(st.payReminderTime)) return (error.value = 'ตรวจค่ากำหนดชำระตามนัด / เวลาเตือน (ชม. 1–720, วัน 0–30, เวลา HH:mm)')
  if (!num(st.depositPercent) || Number(st.depositPercent) > 100) return (error.value = 'มัดจำต้องอยู่ระหว่าง 0–100%')
  const v = st.vat
  if (v.enabled && !(Number(v.rate) > 0 && Number(v.rate) <= 100)) return (error.value = 'อัตรา VAT ต้องอยู่ระหว่าง 0–100%')
  if (String(v.taxId || '').replace(/\D/g, '').length && !validTaxId(String(v.taxId).replace(/\D/g, ''))) return (error.value = 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก ตรวจตัวเลขท้าย)')
  if (v.branch && !validBranch(v.branch)) return (error.value = 'สาขาต้อง 5 หลัก (สำนักงานใหญ่ 00000)')
  { const cr = cleanClosures(st.closures); if (cr.error) return (error.value = cr.error) }
  for (const a of st.payment.accounts) { const e = validatePayAccount(a); if (e) return (error.value = e) }
  error.value = ''
  const sr = saveShopSettings(st)
  if (sr?.error) return (error.value = sr.error)
  Object.assign(st, db.shop, { vat: { ...db.shop.vat }, payDueRule: { ...db.shop.payDueRule }, delivery: { ...db.shop.delivery }, payment: clonePayment(db.shop.payment), closures: JSON.parse(JSON.stringify(db.shop.closures)) })
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
// ตัวอย่างเวลาของพรุ่งนี้ (ตามค่าที่บันทึกแล้ว)
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d) })()
</script>

<template>
  <ManageShell narrow guard title="ตั้งค่าร้าน" :toolbar="false">
    <section class="card mb-4">
      <label class="label">ชื่อร้าน (แสดงบนใบเสร็จ)</label>
      <input v-model="st.name" class="input" />
    </section>
    <section class="card space-y-4">
      <div class="card-title mb-0"><AppIcon name="clock" class="text-brand-600" /> เวลานัดรับ</div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">เวลาเปิด</label><input v-model="st.open" type="time" class="input" /></div>
        <div><label class="label">เวลาปิด (นัดได้ถึง)</label><input v-model="st.close" type="time" class="input" /></div>
      </div>
      <div>
        <div class="label">ห่างกันทุก (นาที)</div>
        <div class="flex flex-wrap items-center gap-2">
          <button v-for="m in STEPS" :key="m" type="button" class="chip" :class="Number(st.slotMinutes) === m ? 'chip-on' : 'chip-off'" @click="st.slotMinutes = m">{{ m }}</button>
          <input v-model.number="st.slotMinutes" type="text" v-num min="5" class="input w-24" aria-label="ช่วงเวลานัดรับ (นาที) กำหนดเอง" />
        </div>
      </div>
      <div>
        <div class="label">ค่าเริ่มต้น ช่วงดูออร์เดอร์ก่อน/หลัง ตอนเลือกเวลา</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="h in NEAR" :key="h" type="button" class="chip" :class="Number(st.nearbyHours) === h ? 'chip-on' : 'chip-off'" @click="st.nearbyHours = h">{{ h ? `±${h} ชม.` : 'ทั้งวัน' }}</button>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="cake" class="text-brand-600" /> ตารางผลิต · ต้องเสร็จก่อนนัด (นาที)</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">รับที่ร้าน</label><input v-model.number="st.leadPickup" type="text" v-num min="0" class="input" /></div>
          <div><label class="label">จัดส่ง</label><input v-model.number="st.leadDelivery" type="text" v-num min="0" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> มัดจำ / กำหนดชำระ</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">มัดจำขั้นต่ำ (%) <span class="font-normal text-stone-400">0 = ไม่ใช้</span></label><input v-model.number="st.depositPercent" type="text" v-num min="0" max="100" class="input" /></div>
          <div class="col-span-2"><label class="label">กำหนดชำระเริ่มต้นตอนแจ้งยอด (นาที)</label><input v-model.number="st.payDueMin" type="text" v-num min="1" max="10080" class="input" /></div>
          <div><label class="label">ก่อนนัด (ชม.) เริ่มต้น</label><input v-model.number="st.payDueRule.hoursBefore" type="text" v-num min="1" max="720" class="input" /></div>
          <div><label class="label">ล่วงหน้า (วัน) เริ่มต้น</label><input v-model.number="st.payDueRule.daysBefore" type="text" v-num min="0" max="30" class="input" /></div>
          <div><label class="label">...ก่อนเวลา</label><input v-model="st.payDueRule.atTime" type="time" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-1"><AppIcon name="calendar" class="text-brand-600" /> ตั้งเวลาแจ้งเตือนอัตโนมัติ</div>
        <p class="mb-3 text-xs text-stone-500">ค่าเริ่มต้นเท่าการทำงานเดิม · เกินกำหนดชำระใช้กำหนดชำระของออร์เดอร์ · ค่าใช้จ่ายประจำตั้งผ่อนผันรายการที่หน้าบัญชี</p>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">เตือนชำระ (พรุ่งนี้มีนัด) เวลา</label><input v-model="st.payReminderTime" type="time" class="input" /></div>
          <div><label class="label">เตือนก่อนนัดรับ (ชม.)</label><input v-model.number="st.pickupRemindHours" type="text" v-num min="1" max="72" class="input" /></div>
          <div><label class="label">เตือนวันเกิดล่วงหน้า (วัน)</label><input v-model.number="st.birthdayDays" type="text" v-num min="0" class="input" /></div>
          <div><label class="label">คะแนนใกล้หมดอายุ (วันล่วงหน้า)</label><input v-model.number="st.pointsExpireDays" type="text" v-num min="1" max="90" class="input" /></div>
          <div><label class="label">งานใกล้เวลาต้องเสร็จ (ชม.)</label><input v-model.number="st.dueSoonHours" type="text" v-num min="1" max="12" class="input" /></div>
          <div><label class="label">งวดผ่อนชำระ (วันก่อนครบกำหนด)</label><input v-model.number="st.installmentAlertDays" type="text" v-num min="0" max="30" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-1"><AppIcon name="calendar" class="text-brand-600" /> วัน-เวลาปิดร้าน</div>
        <p class="mb-3 text-xs text-stone-500">วัน-เวลานัดที่ตรงช่วงปิดจะเลือกไม่ได้ · ลูกค้ายังแชทและสั่งวัน-เวลาอื่นได้ · บอทแจ้งร้านปิดเมื่อลูกค้าทักครั้งแรกของวัน (ตั้งที่หน้าบอท)</p>
        <div class="label">ปิดประจำสัปดาห์</div>
        <div class="mb-4 flex flex-wrap gap-1.5">
          <button v-for="d in DOWS" :key="d" type="button" class="chip" :class="st.closures.weekly.includes(d) ? 'chip-on' : 'chip-off'" :aria-pressed="st.closures.weekly.includes(d)" @click="flip(st.closures.weekly, d)">{{ DOW_NAMES[d] }}</button>
        </div>
        <div class="mb-1.5 flex items-center justify-between"><div class="label mb-0">ปิดวันที่เจาะจง / ช่วงวัน (หยุดยาว)</div><button type="button" class="text-sm text-brand-700 underline" :disabled="st.closures.ranges.length >= MAX_ROWS" @click="addRange">+ เพิ่ม</button></div>
        <div v-for="(r, i) in st.closures.ranges" :key="r.id" class="mb-2 grid grid-cols-2 gap-2 rounded-xl border border-stone-200/70 p-2.5">
          <div><label class="label">ตั้งแต่</label><input v-model="r.from" type="date" class="input h-10" :aria-label="`วันเริ่มปิด ${i + 1}`" /></div>
          <div><label class="label">ถึง</label><input v-model="r.to" type="date" class="input h-10" :min="r.from" :aria-label="`วันสิ้นสุดปิด ${i + 1}`" /></div>
          <div class="col-span-2 flex gap-2"><input v-model="r.reason" class="input h-10 min-w-0 flex-1" maxlength="80" placeholder="เหตุผล (เช่น สงกรานต์)" :aria-label="`เหตุผลปิด ${i + 1}`" /><button type="button" class="btn-danger h-10 px-3" :aria-label="`ลบช่วงวันปิด ${i + 1}`" @click="st.closures.ranges.splice(i, 1)"><AppIcon name="trash" :size="16" /></button></div>
        </div>
        <div class="mt-3 mb-1.5 flex items-center justify-between"><div class="label mb-0">ปิดบางช่วงเวลาในวัน (เช่น พักเที่ยง)</div><button type="button" class="text-sm text-brand-700 underline" :disabled="st.closures.hours.length >= MAX_ROWS" @click="addHours">+ เพิ่ม</button></div>
        <div v-for="(h, i) in st.closures.hours" :key="h.id" class="mb-2 space-y-2 rounded-xl border border-stone-200/70 p-2.5">
          <div class="flex flex-wrap gap-1"><button v-for="d in DOWS" :key="d" type="button" class="chip h-8 px-2.5 text-xs" :class="h.days.includes(d) ? 'chip-on' : 'chip-off'" @click="flip(h.days, d)">{{ DOW_NAMES[d].slice(0, 3) }}</button><span class="self-center text-xs text-stone-400">{{ h.days.length ? '' : 'ไม่เลือก = ทุกวัน' }}</span></div>
          <div class="grid grid-cols-2 gap-2"><div><label class="label">เริ่มปิด</label><input v-model="h.from" type="time" class="input h-10" :aria-label="`เวลาเริ่มปิด ${i + 1}`" /></div><div><label class="label">เปิดอีกครั้ง</label><input v-model="h.to" type="time" class="input h-10" :aria-label="`เวลาเปิดอีกครั้ง ${i + 1}`" /></div></div>
          <div class="flex gap-2"><input v-model="h.reason" class="input h-10 min-w-0 flex-1" maxlength="80" placeholder="เหตุผล (เช่น พักเที่ยง)" :aria-label="`เหตุผลปิดช่วงเวลา ${i + 1}`" /><button type="button" class="btn-danger h-10 px-3" :aria-label="`ลบช่วงเวลาปิด ${i + 1}`" @click="st.closures.hours.splice(i, 1)"><AppIcon name="trash" :size="16" /></button></div>
        </div>
        <ul v-if="closureLines.length" class="mt-3 space-y-0.5 rounded-xl bg-stone-50 p-3 text-xs text-stone-600" aria-label="สรุปวัน-เวลาปิดร้าน"><li v-for="(l, i) in closureLines" :key="i">• {{ l }}</li></ul>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> ช่องทางรับชำระ (แสดงให้ลูกค้า)</div>
        <div class="mb-4 max-w-md"><label class="label">รหัสร้านค้า (ผู้รับชำระ) <span class="font-normal text-stone-400">ใส่ใน QR เป็น Ref 1 และใช้ตรวจสลิป · เว้นว่าง = ไม่มี QR และไม่ตรวจรหัสร้านค้า</span></label><input v-model="st.merchantCode" type="text" inputmode="numeric" class="input" placeholder="เช่น 014000000517185" /></div>
        <div class="mb-4 max-w-md"><label class="label">Biller ID (ผู้เรียกเก็บเงิน 15 หลัก) <span class="font-normal text-stone-400">ใช้สร้าง QR พร้อมเพย์แบบ Biller · เว้นว่าง = ไม่มี QR</span></label><input v-model="st.billerId" type="text" inputmode="numeric" maxlength="15" class="input" placeholder="เช่น 010753600010286" /></div>
        <div class="space-y-3">
          <div v-for="(a, i) in st.payment.accounts" :key="a.id" class="space-y-2 rounded-2xl border border-stone-200 bg-white p-3">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="text-sm font-semibold text-stone-800">{{ a.kind === 'bank' ? 'บัญชีธนาคาร' : 'พร้อมเพย์' }} {{ i + 1 }}</span>
              <div class="flex items-center gap-3"><AppSwitch v-model="a.show" label="แสดงให้ลูกค้า" /><button type="button" class="btn-outline h-8 px-3 text-xs" @click="removePayAccount(i)">ลบ</button></div>
            </div>
            <div v-if="a.kind === 'bank'" class="grid grid-cols-2 gap-2">
              <div class="col-span-2"><label class="label">ธนาคาร</label><select class="input" :value="a.bankCode" @change="setBank(a, $event.target.value)"><option value="">เลือกธนาคาร</option><option v-for="b in BANKS" :key="b.code" :value="b.code">{{ b.name }}</option></select></div>
              <div class="col-span-2"><label class="label">เลขบัญชี</label><input v-model="a.accountNo" inputmode="numeric" class="input" maxlength="20" /></div>
              <div class="col-span-2"><label class="label">ชื่อบัญชี</label><input v-model="a.accountName" class="input" maxlength="80" /></div>
            </div>
            <div v-else class="grid grid-cols-2 gap-2">
              <div class="col-span-2"><label class="label">เลขพร้อมเพย์ (เบอร์มือถือ / เลขบัตร / e-Wallet)</label><input v-model="a.promptpayId" inputmode="numeric" class="input" maxlength="15" /></div>
              <div class="col-span-2"><label class="label">ชื่อบัญชี</label><input v-model="a.accountName" class="input" maxlength="80" /></div>
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn-outline h-9 px-3 text-sm" @click="addPayAccount('bank')">+ บัญชีธนาคาร</button>
            <button type="button" class="btn-outline h-9 px-3 text-sm" @click="addPayAccount('promptpay')">+ พร้อมเพย์</button>
          </div>
          <p v-if="!st.payment.accounts.length" class="text-xs text-amber-700">ยังไม่มีช่องทางรับชำระ ลูกค้าจะเห็นข้อความให้สอบถามร้าน</p>
          <div><label class="label">หมายเหตุให้ลูกค้า</label><input v-model="st.payment.note" class="input" maxlength="200" /></div>
          <p class="text-xs text-stone-500">ลูกค้าจะเห็นเฉพาะบัญชีที่เปิดแสดง · QR พร้อมเพย์สร้างจากพร้อมเพย์ตัวแรกที่เปิดแสดง ตามยอดที่ลูกค้าเลือก</p>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="truck" class="text-brand-600" /> ค่าจัดส่งจากระยะทาง</div>
        <AppSwitch v-model="st.delivery.enabled" label="คิดค่าส่งแนะนำจากระยะทาง (พนักงานแก้ทับได้)" class="flex" />
        <div v-if="st.delivery.enabled" class="mt-3 grid grid-cols-2 gap-3">
          <div><label class="label">ฟรีในระยะ (กม.)</label><input v-model.number="st.delivery.freeKm" type="text" v-num.dec min="0" class="input" /></div>
          <div><label class="label">เกินแล้วคิด (บาท/กม.)</label><input v-model.number="st.delivery.perKm" type="text" v-num.dec min="0" class="input" /></div>
          <div><label class="label">ค่าส่งขั้นต่ำเมื่อเกินระยะฟรี (บาท)</label><input v-model.number="st.delivery.minFee" type="text" v-num.dec min="0" class="input" /></div>
          <div><label class="label">ปัดขึ้นทีละ (บาท)</label><input v-model.number="st.delivery.roundTo" type="text" v-num min="1" class="input" /></div>
          <p class="col-span-2 text-xs text-stone-500">ตัวอย่าง 8 กม.: {{ exampleFee == null ? 'ตั้งเรตต่อกม. ให้มากกว่า 0' : money(exampleFee) }}</p>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> ภาษีมูลค่าเพิ่ม (VAT)</div>
        <AppSwitch v-model="st.vat.enabled" label="คิด VAT กับออร์เดอร์ใหม่ (ทุกช่องทาง รวม POS)" class="flex" />
        <template v-if="st.vat.enabled">
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div><label class="label">อัตรา (%)</label><input v-model="st.vat.rate" type="text" v-num.dec class="input" /></div>
            <div>
              <div class="label">รูปแบบ</div>
              <div class="grid grid-cols-2 gap-1 seg-grid">
                <button v-for="m in [{ v: 'inclusive', l: 'VAT ใน' }, { v: 'exclusive', l: 'VAT นอก' }]" :key="m.v" type="button" class="h-9 rounded-lg text-sm font-medium" :class="st.vat.mode === m.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="st.vat.mode = m.v">{{ m.l }}</button>
              </div>
            </div>
          </div>
          <p class="mt-2 text-xs text-stone-500">
            <template v-if="st.vat.mode === 'inclusive'">VAT ใน: ราคาที่ตั้งไว้รวม VAT แล้ว ยอดที่ลูกค้าจ่ายไม่เปลี่ยน ระบบแยกแสดงบรรทัด VAT (ยอด × {{ Number(st.vat.rate) || 0 }} ÷ {{ 100 + (Number(st.vat.rate) || 0) }})</template>
            <template v-else>VAT นอก: บวก VAT {{ Number(st.vat.rate) || 0 }}% เพิ่มท้ายยอด</template>
            · ฐานภาษี = สินค้า + ค่าส่ง หลังส่วนลดทุกประเภท · เก็บค่าที่ใช้ไว้ในแต่ละออร์เดอร์ (แก้ตั้งค่าแล้วออร์เดอร์เดิมไม่เปลี่ยน) · กำไรในหน้ายอดขายนับก่อน VAT
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label class="label">ชื่อผู้เสียภาษี (แสดงบนใบเสร็จ)</label><input v-model="st.vat.legalName" class="input" maxlength="120" /></div>
            <div><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="st.vat.taxId" type="text" v-num maxlength="13" class="input" /></div>
            <div><label class="label">สาขา (5 หลัก · สำนักงานใหญ่ 00000)</label><input v-model="st.vat.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขาร้าน" /></div>
            <div class="sm:col-span-2"><label class="label">ที่อยู่ผู้ประกอบการ (แสดงบนใบกำกับภาษี)</label><TaxAddressField v-model="st.vat.address" label="ที่อยู่ผู้ประกอบการ" :suggestions="shopAddrChoices" /></div>
          </div>
          <p class="mt-2 text-xs text-amber-700">ใบเสร็จย่อของระบบนี้ไม่ใช่ใบกำกับภาษี · ออกใบกำกับภาษีเต็มรูปได้ที่หน้ารายละเอียดออร์เดอร์ (ต้องกรอกชื่อ ที่อยู่ เลขผู้เสียภาษีและสาขาของร้านให้ครบ) · ควรให้นักบัญชีตรวจก่อนใช้จริง</p>
        </template>
      </div>
      <!-- แถบบันทึกติดขอบล่าง: หน้านี้ยาว ไม่ต้องเลื่อนถึงท้ายเพื่อบันทึก -->
      <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-10 rounded-2xl border border-stone-200 bg-white/95 p-2 shadow-lg backdrop-blur lg:bottom-3">
        <p v-if="error" class="mb-2 px-1 text-sm font-medium text-rose-700" role="alert">{{ error }}</p>
        <button class="btn-primary w-full" @click="save"><AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึก' }}</button>
      </div>
      <p class="text-xs text-stone-500">ตัวอย่างพรุ่งนี้: {{ pickupSlots(tomorrow).join(', ') }}</p>
    </section>

    <section class="card space-y-4">
      <div class="card-title mb-0"><AppIcon name="image" class="text-brand-600" /> สลิปในแชท (QR)</div>
      <p class="text-sm text-stone-600">ลูกค้าส่งรูปสลิปโอนในแชท ระบบอ่าน QR ของสลิปเพื่อจับคู่ออร์เดอร์ · ยอดรอพนักงานตรวจก่อนยืนยันเสมอ (ยกเว้นเปิดยืนยันสลิปอัตโนมัติ)</p>
      <AppSwitch v-model="sq.enabled" label="ตรวจสลิปในแชท" class="flex" />
      <div>
        <div class="label">วิธีจับคู่</div>
        <div class="grid gap-2 sm:grid-cols-2">
          <button type="button" class="chip" :class="sq.mode === 'auto' ? 'chip-on' : 'chip-off'" @click="sq.mode = 'auto'">อัตโนมัติ · แนบกับออร์เดอร์ที่คุยล่าสุด</button>
          <button type="button" class="chip" :class="sq.mode === 'manual' ? 'chip-on' : 'chip-off'" @click="sq.mode = 'manual'">แมนนวล · พนักงานเลือกออร์เดอร์เอง</button>
        </div>
        <p class="mt-2 text-xs text-stone-500">{{ sq.mode === 'manual' ? 'แชทจะแสดงปุ่มผูกกับออร์เดอร์ที่แนะนำ หรือเลือกออร์เดอร์อื่นของลูกค้า (ในหน้าแชท ไม่เปลี่ยนหน้า)' : 'ผูกอัตโนมัติเมื่อรหัสอ้างอิงร้านค้าตรงกับออร์เดอร์ และยอด วัน-เวลา รหัสร้านค้าถูกต้องครบ · ไม่ครบให้พนักงานผูกเองในหน้าแชท' }}</p>
      </div>
      <div class="space-y-2">
        <AppSwitch v-model="sq.autoConfirm.enabled" label="ยืนยันสลิปอัตโนมัติ (เมื่อครบ 4 ข้อ)" class="flex" />
        <div v-if="sq.autoConfirm.enabled" class="max-w-md">
          <label class="label">ยืนยันอัตโนมัติเมื่อวันนัดรับห่างจากวันนี้อย่างน้อย (วัน)</label>
          <input v-model.number="sq.autoConfirm.days" type="text" v-num min="0" max="30" class="input" />
        </div>
        <p class="text-xs text-stone-500">ครบ 4 ข้อ = ยอดไม่เกินยอดค้าง · วัน-เวลาโอนหลังเวลาสร้างออร์เดอร์ · รหัสร้านค้าตรงกับที่ตั้งไว้ · รหัสอ้างอิงร้านค้า (POS/ORD) ตรงกับออร์เดอร์ ·นัดรับใกล้กว่าจำนวนวันที่ตั้ง หรือยังอ่านภาพสลิปไม่ได้ → พนักงานยืนยันเอง</p>
      </div>
      <div class="space-y-2">
        <p class="text-sm font-medium text-stone-700">ลำดับการอ่านสลิป</p>
        <div class="flex items-center justify-between gap-3 text-sm text-stone-700">
          <span>1) อ่าน QR ในสลิป</span>
          <span class="shrink-0 text-xs text-stone-500">ทำทุกครั้งที่ส่งสลิป</span>
        </div>
        <AppSwitch v-model="sq.ocr.wai" label="2) Workers AI (Cloudflare) · อ่านยอดและวัน-เวลา" class="flex" />
        <AppSwitch v-model="sq.ocr.claude" label="3) Claude (ระบบเดิม) · อ่านยอดและวัน-เวลา" class="flex" />
        <p class="text-xs text-stone-500">ระบบอ่าน QR ก่อนทุกครั้ง ถ้าเป็นสลิปจึงส่งต่อตามลำดับ 2 → 3 เฉพาะตัวที่เปิดไว้และตั้งค่าที่เซิร์ฟเวอร์ครบ ถ้าตัวแรกอ่านไม่ได้จะลองตัวถัดไป · ส่งเฉพาะรูปสลิปไปยังผู้ให้บริการที่เปิดไว้</p>
      </div>
      <p v-if="slipErr" class="text-sm text-rose-700">{{ slipErr }}</p>
      <button class="btn-outline w-full" @click="saveSlip"><AppIcon name="check" :size="18" /> {{ slipSaved ? 'บันทึกแล้ว' : 'บันทึกการตั้งค่าสลิป' }}</button>
    </section>
  </ManageShell>
</template>
