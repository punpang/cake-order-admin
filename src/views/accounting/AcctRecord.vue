<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { computed, reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { saveManual, precheckManual, saveJournal, deleteManual, reverseEntry, settleEntry, activeAccounts, locked } from '../../data/acct'
import { buildManualEntry, SETTLE } from '../../lib/acct/manual'
import { parseReceipt, receiptFill } from '../../lib/receiptOcr'
import { readReceiptText } from '../../lib/receiptOcrRunner'
import { resizeImage, imageErrorMessage } from '../../lib/imageResize'
import { entrySums } from '../../lib/acct/journal'
import { saveWithReceipts } from '../../lib/acct/receiptRefs'
import { filesEnabled, uploadPrivateImage } from '../../lib/storage'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import { askConfirm } from '../../lib/confirm'
import { toDateStr, money, dateOnly } from '../../lib/format'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import ImageUploader from '../../components/ImageUploader.vue'

// บันทึกรายได้/ค่าใช้จ่ายเอง → ระบบสร้างรายการบัญชีคู่ให้ (ขั้นสูง = ลงสมุดรายวันเอง)
const filter = ref('all')
const msg = ref('')
const rows = computed(() => db.acct.entries.slice().sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.id < b.id ? 1 : -1)).filter((e) => filter.value === 'all' || e.source?.kind === filter.value))
const total = (e) => entrySums(e).dr / 100

const blank = (kind = 'expense') => ({ kind, date: toDateStr(new Date()), account: '', amount: '', vatMode: 'none', vatRate: db.shop.vat?.rate || 7, claimable: true, settle: 'cash', payee: '', taxInvoiceNo: '', taxInvoiceDate: '', payeeTaxId: '', memo: '', attachments: [] })
const f = reactive(blank())
const editId = ref(null)
const open = ref(false)
const error = ref('')
const accounts = computed(() => activeAccounts().filter((a) => a.quick && a.kind === (f.kind === 'income' ? 'revenue' : 'expense')))
const preview = computed(() => buildManualEntry({ ...f, amount: Number(f.amount) }))
function openNew(kind) {
  Object.assign(f, blank(kind))
  editId.value = null
  error.value = ''
  scan.msg = ''
  open.value = true
}
// ถ่ายรูปใบเสร็จ → อ่านในเบราว์เซอร์ → เติมเฉพาะช่องที่ว่าง → ผู้ใช้ตรวจและกดบันทึกเอง (ไม่บันทึกอัตโนมัติ)
const scan = reactive({ busy: false, pct: 0, msg: '' })
async function onScanReceipt(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  scan.busy = true
  scan.pct = 0
  scan.msg = 'กำลังอ่านรูป…'
  try {
    // อ่าน OCR ด้วยรูปความละเอียดสูง (ไม่เก็บ) · เก็บเป็นหลักฐานไม่เกิน 512 KB
    const ocrImg = await resizeImage(file, { maxSide: 2500, maxBytes: 4 * 1024 * 1024 })
    const img = await resizeImage(file, { maxBytes: 512 * 1024 })
    const text = await readReceiptText(ocrImg.dataUrl, (m) => { scan.pct = Math.round((m.progress || 0) * 100) })
    const parsed = parseReceipt(text)
    Object.assign(f, receiptFill(f, parsed, { vatRate: f.vatRate || db.shop.vat?.rate || 7 }))
    if (f.attachments.length < 5) f.attachments.push(img.dataUrl)
    const found = ['date', 'total', 'payee', 'taxId', 'taxInvoiceNo', 'vat'].filter((k) => parsed[k] != null).length
    scan.msg = found ? `อ่านได้ ${found} รายการ · ตรวจค่าก่อนบันทึก` : 'อ่านรูปไม่ได้ กรุณากรอกเอง (รูปยังแนบอยู่)'
  } catch (err) {
    scan.msg = err?.code ? imageErrorMessage(err) : 'อ่านรูปไม่ได้ กรุณากรอกเอง'
  } finally {
    scan.busy = false
  }
}
function openEdit(e) {
  const s = e.source
  Object.assign(f, { ...blank(s.kind), date: e.date, account: s.account, amount: s.amount, vatMode: s.vatMode, vatRate: s.vatRate || 7, claimable: s.claimable, settle: s.settle, payee: s.payee, taxInvoiceNo: s.taxInvoiceNo, taxInvoiceDate: s.taxInvoiceDate, payeeTaxId: s.payeeTaxId, memo: e.memo, attachments: [...(s.attachments || [])] })
  editId.value = e.id
  error.value = ''
  open.value = true
}
function setKind(k) {
  f.kind = k
  f.account = ''
  f.settle = 'cash'
}
// รูปแนบที่ยังเป็นข้อมูลในเครื่อง → อัปโหลดไป R2 ก่อนบันทึก (โหมดข้อมูลตัวอย่างไม่อัปโหลด) · อัปโหลดไม่สำเร็จ = ไม่บันทึกรายการ
const uploading = ref(false)
async function save() {
  if (uploading.value) return
  uploading.value = true
  error.value = ''
  try {
    let uploader = (src) => src
    if (supabaseEnabled && filesEnabled() && f.attachments.some((a) => String(a).startsWith('data:'))) {
      const c = await getSupabase()
      if (!c) throw new Error('no-client')
      const prefix = 'acct/' + String(f.date || '').slice(0, 7)
      uploader = (src) => uploadPrivateImage(c, src, prefix)
    }
    const form = { ...f, amount: Number(f.amount) }
    const r = await saveWithReceipts({
      form,
      precheck: (x) => precheckManual(x, editId.value),
      uploader,
      save: (x) => saveManual(x, editId.value),
    })
    if (r.error) return (error.value = r.error)
    open.value = false
  } catch {
    error.value = 'อัปโหลดรูปไม่สำเร็จ ยังไม่ได้บันทึกรายการ กรุณาลองใหม่'
  } finally {
    uploading.value = false
  }
}
const isEditable = (e) => (e.source?.kind === 'income' || e.source?.kind === 'expense') && !locked(e.date) && !e.reversedBy
async function del(e) {
  if (await askConfirm({ title: 'ลบรายการ', message: `${e.no} · ${e.memo || ''}`, okText: 'ลบ', danger: true })) {
    const r = deleteManual(e.id)
    msg.value = r.error || ''
  }
}
async function rev(e) {
  if (await askConfirm({ title: 'กลับรายการ', message: `สร้างรายการกลับด้านของ ${e.no} ลงวันนี้`, okText: 'กลับรายการ', danger: true })) {
    const r = reverseEntry(e.id)
    msg.value = r.error || ''
  }
}
const settleFor = ref(null)
const sf = reactive({ date: toDateStr(new Date()), method: 'bank', error: '' })
function doSettle() {
  const r = settleEntry(settleFor.value.id, { date: sf.date, method: sf.method })
  if (r.error) return (sf.error = r.error)
  settleFor.value = null
}

// ---- รายการขั้นสูง ----
const j = reactive({ date: toDateStr(new Date()), memo: '', lines: [{ account: '', dr: '', cr: '' }, { account: '', dr: '', cr: '' }], error: '' })
const jOpen = ref(false)
const jDr = computed(() => j.lines.reduce((s, l) => s + (Number(l.dr) || 0), 0))
const jCr = computed(() => j.lines.reduce((s, l) => s + (Number(l.cr) || 0), 0))
function openJournal() {
  Object.assign(j, { date: toDateStr(new Date()), memo: '', lines: [{ account: '', dr: '', cr: '' }, { account: '', dr: '', cr: '' }], error: '' })
  jOpen.value = true
}
function saveJ() {
  const r = saveJournal({ date: j.date, memo: j.memo, lines: j.lines.map((l) => ({ account: l.account, dr: Number(l.dr) || 0, cr: Number(l.cr) || 0 })) })
  if (r.error) return (j.error = r.error)
  jOpen.value = false
}
</script>

<template>
  <div class="space-y-3">
    <div v-if="can('acctRecord')" class="grid grid-cols-3 gap-2">
      <button class="btn-primary px-2 text-sm" @click="openNew('expense')"><AppIcon name="plus" :size="14" /> ค่าใช้จ่าย</button>
      <button class="btn-soft px-2 text-sm" @click="openNew('income')"><AppIcon name="plus" :size="14" /> รายได้</button>
      <button class="btn-outline px-2 text-sm" @click="openJournal">ขั้นสูง</button>
    </div>
    <div class="flex gap-2">
      <button v-for="x in [{ v: 'all', l: 'ทั้งหมด' }, { v: 'expense', l: 'ค่าใช้จ่าย' }, { v: 'income', l: 'รายได้' }, { v: 'journal', l: 'ขั้นสูง' }]" :key="x.v" class="chip" :class="filter === x.v ? 'chip-on' : 'chip-off'" @click="filter = x.v">{{ x.l }}</button>
    </div>
    <p v-if="msg" class="rounded-xl bg-danger-50 p-3 text-sm text-danger-700" role="alert">{{ msg }}</p>
    <p v-if="!rows.length" class="card py-8 text-center text-sm text-stone-500">ยังไม่มีรายการที่บันทึกเอง · รายได้จากออร์เดอร์/POS ดึงอัตโนมัติ ดูที่สมุดรายวัน</p>
    <ul class="space-y-2">
      <li v-for="e in rows" :key="e.id" class="card text-sm" :class="e.reversedBy ? 'opacity-60' : ''">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-medium break-words text-stone-900">{{ e.memo || e.source.payee || '(ไม่มีคำอธิบาย)' }}</div>
            <div class="text-xs text-stone-500">{{ e.no }} · {{ dateOnly(e.date) }} · {{ e.source.kind === 'income' ? 'รายได้' : e.source.kind === 'expense' ? 'ค่าใช้จ่าย' : e.source.settles ? 'ชำระหนี้' : 'ขั้นสูง' }}<template v-if="e.source.vat"> · VAT {{ money(e.source.vat) }}</template><template v-if="e.reversedBy"> · กลับรายการแล้ว</template></div>
          </div>
          <b class="shrink-0" :class="e.source.kind === 'income' ? 'text-success-700' : 'text-stone-900'">{{ money(e.source.total || total(e)) }}</b>
        </div>
        <div v-if="e.source.settle === 'payable' || e.source.settle === 'receivable'" class="mt-1 text-xs" :class="e.settledBy ? 'text-success-700' : 'text-warning-700'">{{ e.settledBy ? 'ชำระแล้ว' : e.source.settle === 'payable' ? 'ค้างจ่าย' : 'ค้างรับ' }}</div>
        <div v-if="can('acctRecord')" class="mt-2 flex flex-wrap gap-2">
          <button v-if="isEditable(e)" class="btn-outline h-8 px-3 text-xs" @click="openEdit(e)">แก้ไข</button>
          <button v-if="!locked(e.date) && !e.reversedBy && !e.source.reverses" class="btn-danger h-8 px-3 text-xs" @click="del(e)">ลบ</button>
          <button v-if="locked(e.date) && !e.reversedBy && !e.source.reverses" class="btn-outline h-8 px-3 text-xs" @click="rev(e)">กลับรายการ</button>
          <button v-if="(e.source.settle === 'payable' || e.source.settle === 'receivable') && !e.settledBy" class="btn-soft h-8 px-3 text-xs" @click="settleFor = e; sf.error = ''">{{ e.source.settle === 'payable' ? 'ชำระเจ้าหนี้' : 'รับชำระ' }}</button>
        </div>
      </li>
    </ul>

    <AppModal v-if="open" :title="editId ? 'แก้ไขรายการ' : f.kind === 'income' ? 'บันทึกรายได้' : 'บันทึกค่าใช้จ่าย'" @close="open = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-1 seg-grid">
          <button v-for="k in [{ v: 'expense', t: 'ค่าใช้จ่าย' }, { v: 'income', t: 'รายได้' }]" :key="k.v" type="button" class="h-10 rounded-xl text-sm font-semibold" :class="f.kind === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" :disabled="!!editId" @click="setKind(k.v)">{{ k.t }}</button>
        </div>
        <div v-if="f.kind === 'expense' && !editId" class="rounded-xl border border-dashed border-stone-300 p-3">
          <label class="btn-outline w-full cursor-pointer" :class="{ 'pointer-events-none opacity-60': scan.busy }"><input type="file" accept="image/*" capture="environment" class="sr-only" :disabled="scan.busy" aria-label="ถ่ายรูปใบเสร็จ" @change="onScanReceipt" />ถ่ายรูปใบเสร็จ</label>
          <p v-if="scan.busy" class="mt-2 text-sm text-stone-600" role="status">กำลังอ่านรูป… {{ scan.pct }}%</p>
          <p v-else-if="scan.msg" class="mt-2 text-sm text-stone-600" role="status">{{ scan.msg }}</p>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">วันที่</label><input v-model="f.date" type="date" class="input" aria-label="วันที่รายการ" /></div>
          <div><label class="label">จำนวนเงิน (บาท)</label><MoneyInput v-model="f.amount" class="input text-lg font-semibold" aria-label="จำนวนเงิน" /></div>
        </div>
        <div><label class="label">หมวด</label>
          <select v-model="f.account" class="input" aria-label="หมวดบัญชี"><option value="" disabled>เลือกหมวด</option><option v-for="a in accounts" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select>
        </div>
        <div>
          <div class="label">ภาษีมูลค่าเพิ่ม</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="m in [{ v: 'none', t: 'ไม่มี VAT' }, { v: 'included', t: 'ราคารวม VAT แล้ว' }, { v: 'excluded', t: 'ยังไม่รวม VAT' }]" :key="m.v" type="button" class="chip" :class="f.vatMode === m.v ? 'chip-on' : 'chip-off'" @click="f.vatMode = m.v">{{ m.t }}</button>
          </div>
          <div v-if="f.vatMode !== 'none'" class="mt-2 grid grid-cols-2 gap-3"><div><label class="label">อัตรา (%)</label><MoneyInput v-model.number="f.vatRate" class="input" aria-label="อัตรา VAT" /></div>
            <div v-if="f.kind === 'expense'" class="self-end"><AppSwitch v-model="f.claimable" label="ขอคืนภาษีซื้อได้" /></div></div>
        </div>
        <div>
          <div class="label">{{ f.kind === 'income' ? 'รับเงินอย่างไร' : 'จ่ายเงินอย่างไร' }}</div>
          <div class="flex flex-wrap gap-2"><button v-for="(v, k) in SETTLE[f.kind]" :key="k" type="button" class="chip" :class="f.settle === k ? 'chip-on' : 'chip-off'" @click="f.settle = k">{{ v[0] }}</button></div>
        </div>
        <div><label class="label">{{ f.kind === 'income' ? 'ลูกค้า/ที่มา' : 'ผู้ขาย/ร้านค้า' }}</label><input v-model="f.payee" class="input" maxlength="100" aria-label="คู่ค้า" /></div>
        <div v-if="f.kind === 'expense' && f.vatMode !== 'none' && f.claimable" class="grid grid-cols-2 gap-3">
          <div><label class="label">เลขที่ใบกำกับภาษี</label><input v-model="f.taxInvoiceNo" class="input" maxlength="40" aria-label="เลขที่ใบกำกับภาษีผู้ขาย" /></div>
          <div><label class="label">วันที่ใบกำกับ</label><input v-model="f.taxInvoiceDate" type="date" class="input" /></div>
          <div class="col-span-2"><label class="label">เลขผู้เสียภาษีผู้ขาย (13 หลัก)</label><input v-model="f.payeeTaxId" inputmode="numeric" class="input" maxlength="13" aria-label="เลขผู้เสียภาษีผู้ขาย" /></div>
        </div>
        <div><label class="label">คำอธิบาย</label><input v-model="f.memo" class="input" maxlength="200" aria-label="คำอธิบาย" /></div>
        <div><div class="label">แนบรูป (ใบเสร็จ/ใบกำกับ)</div><ImageUploader v-model="f.attachments" :max="5" label="แนบรูป" /></div>
        <div v-if="preview.entry" class="rounded-xl bg-stone-50 p-3 text-xs text-stone-600" aria-label="ตัวอย่างรายการบัญชี">
          <div class="mb-1 font-semibold text-stone-700">รายการบัญชีที่จะลง</div>
          <div v-for="(l, i) in preview.entry.lines" :key="i" class="flex justify-between"><span>{{ l.dr ? 'เดบิต' : 'เครดิต' }} {{ l.account }}</span><span>{{ money(l.dr || l.cr) }}</span></div>
        </div>
        <p v-if="error" class="text-sm text-danger-700" role="alert">{{ error }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button></template>
    </AppModal>

    <AppModal v-if="settleFor" :title="settleFor.source.settle === 'payable' ? 'ชำระเจ้าหนี้' : 'รับชำระลูกหนี้'" @close="settleFor = null">
      <div class="space-y-3"><div class="rounded-xl bg-stone-50 p-3 text-sm">{{ settleFor.no }} · {{ money(settleFor.source.total) }}</div>
        <div><label class="label">วันที่</label><input v-model="sf.date" type="date" class="input" /></div>
        <div class="flex gap-2"><button class="chip" :class="sf.method === 'cash' ? 'chip-on' : 'chip-off'" @click="sf.method = 'cash'">เงินสด</button><button class="chip" :class="sf.method === 'bank' ? 'chip-on' : 'chip-off'" @click="sf.method = 'bank'">ธนาคาร</button></div>
        <p v-if="sf.error" class="text-sm text-danger-700">{{ sf.error }}</p></div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="settleFor = null">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="doSettle">ยืนยัน</button></template>
    </AppModal>

    <AppModal v-if="jOpen" title="รายการบัญชีขั้นสูง" @close="jOpen = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-3"><div><label class="label">วันที่</label><input v-model="j.date" type="date" class="input" aria-label="วันที่รายการขั้นสูง" /></div><div><label class="label">คำอธิบาย</label><input v-model="j.memo" class="input" maxlength="200" aria-label="คำอธิบายรายการขั้นสูง" /></div></div>
        <div v-for="(l, i) in j.lines" :key="i" class="grid grid-cols-[1fr_5.5rem_5.5rem] gap-2">
          <select v-model="l.account" class="input px-2" :aria-label="`บัญชีบรรทัด ${i + 1}`"><option value="">บัญชี</option><option v-for="a in activeAccounts()" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select>
          <MoneyInput v-model="l.dr" class="input px-2" placeholder="เดบิต" :aria-label="`เดบิตบรรทัด ${i + 1}`" />
          <MoneyInput v-model="l.cr" class="input px-2" placeholder="เครดิต" :aria-label="`เครดิตบรรทัด ${i + 1}`" />
        </div>
        <button class="text-sm text-brand-700 underline" @click="j.lines.push({ account: '', dr: '', cr: '' })">+ เพิ่มบรรทัด</button>
        <div class="flex justify-between rounded-xl p-3 text-sm" :class="jDr === jCr && jDr > 0 ? 'bg-success-50 text-success-800' : 'bg-warning-50 text-warning-800'"><span>เดบิต {{ money(jDr) }}</span><span>เครดิต {{ money(jCr) }}</span></div>
        <p v-if="j.error" class="text-sm text-danger-700" role="alert">{{ j.error }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="jOpen = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="saveJ">บันทึก</button></template>
    </AppModal>
  </div>
</template>
