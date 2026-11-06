<script setup>
import { computed, reactive, ref } from 'vue'
import { can } from '../../data/store'
import { activeAccounts, recurring, recurringStatus, saveRecurring, removeRecurring, postRecurring, skipRecurring, deferrals, deferralRows, saveDeferral, removeDeferral, installments, installmentRows, saveInstallment, payInstallment, removeInstallment } from '../../data/acct'
import { thisMonth, addMonths, monthLabel } from '../../lib/acct/period'
import { recurringDue } from '../../lib/acct/plan'
import { askConfirm } from '../../lib/confirm'
import { toDateStr, money, dateOnly } from '../../lib/format'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// ค่าใช้จ่ายประจำเดือน (คงที่/ไม่คงที่ + เตือน) · รายได้/ค่าใช้จ่ายล่วงหน้า · ผ่อนชำระ
const sub = ref('rec')
const today = toDateStr(new Date())
const ym = ref(thisMonth())
const canRec = computed(() => can('acctRecord'))
const expAccts = computed(() => activeAccounts().filter((a) => a.kind === 'expense' && (!a.system || a.quick)))
const revAccts = computed(() => activeAccounts().filter((a) => a.kind === 'revenue' && !a.system))
const buyAccts = computed(() => activeAccounts().filter((a) => ['asset', 'expense'].includes(a.kind) && !['1010', '1020', '2400', '1590'].includes(a.id) && !a.contra))
const err = ref('')
const STATE = { posted: ['บันทึกแล้ว', 'bg-emerald-50 text-emerald-700'], skipped: ['ข้ามเดือนนี้', 'bg-stone-100 text-stone-600'], missing: ['ยังไม่บันทึก', 'bg-rose-50 text-rose-700'], due: ['ถึงกำหนดแล้ว', 'bg-amber-50 text-amber-700'], upcoming: ['ยังไม่ถึงกำหนด', 'bg-stone-100 text-stone-500'], inactive: ['ปิดใช้งาน', 'bg-stone-100 text-stone-400'] }
const rows = computed(() => recurringStatus(ym.value, today))

// ----- ค่าประจำ -----
const rb = () => ({ name: '', account: '', kind: 'fixed', amount: '', estimate: '', dueDay: 1, graceDays: 3, settle: 'bank', vatMode: 'none', vatRate: 7, claimable: false, payee: '', autoPost: false, startMonth: thisMonth(), active: true })
const rf = reactive({ id: null, ...rb() })
const rOpen = ref(false)
function rEdit(t) { Object.assign(rf, { id: t?.id || null, ...rb(), ...(t || {}) }); err.value = ''; rOpen.value = true }
function rSave() { const r = saveRecurring(rf, rf.id); if (r.error) return (err.value = r.error); err.value = ''; rOpen.value = false }
const post = reactive({ open: false, id: '', amount: '', t: null })
function rPost(t) {
  err.value = ''
  if (t.kind === 'fixed') { const r = postRecurring(t.id, ym.value); if (r.error) err.value = r.error; return }
  Object.assign(post, { open: true, id: t.id, amount: '', t })
}
function rPostVar() { const r = postRecurring(post.id, ym.value, { amount: post.amount }); if (r.error) return (err.value = r.error); post.open = false; err.value = '' }
const skip = reactive({ open: false, id: '', reason: '' })
function rSkip() { const r = skipRecurring(skip.id, ym.value, skip.reason); if (r.error) return (err.value = r.error); skip.open = false; skip.reason = ''; err.value = '' }
async function rDel(t) { if (await askConfirm({ title: 'ลบรายการประจำ', message: t.name, okText: 'ลบ', danger: true })) { const r = removeRecurring(t.id); if (r.error) err.value = r.error } }

// ----- ล่วงหน้า -----
const db0 = () => ({ kind: 'prepaid', name: '', total: '', months: 12, startMonth: thisMonth(), account: '', payDate: today, method: 'bank' })
const df = reactive(db0())
const dOpen = ref(false)
function dNew() { Object.assign(df, db0()); err.value = ''; dOpen.value = true }
function dSave() { const r = saveDeferral(df); if (r.error) return (err.value = r.error); err.value = ''; dOpen.value = false }
const dShow = ref('')
async function dDel(d) { if (await askConfirm({ title: 'ลบรายการล่วงหน้า', message: d.name, okText: 'ลบ', danger: true })) { const r = removeDeferral(d.id); if (r.error) err.value = r.error } }

// ----- ผ่อนชำระ -----
const ib = () => ({ kind: 'loan', name: '', principal: '', ratePct: 0, method: 'reducing', n: 12, startDate: today, firstDue: addMonthsStr(today), receive: 'bank', account: '' })
function addMonthsStr(d) { const [y, m, dd] = d.split('-').map(Number); const x = new Date(y, m, dd); return toDateStr(x) }
const inf = reactive(ib())
const iOpen = ref(false)
function iNew() { Object.assign(inf, ib()); err.value = ''; iOpen.value = true }
function iSave() { const r = saveInstallment(inf); if (r.error) return (err.value = r.error); err.value = ''; iOpen.value = false }
const iShow = ref('')
const pay = reactive({ open: false, id: '', date: today, method: 'bank' })
function iPay() { const r = payInstallment(pay.id, { date: pay.date, method: pay.method }); if (r.error) return (err.value = r.error); pay.open = false; err.value = '' }
async function iDel(x) { if (await askConfirm({ title: 'ลบรายการผ่อนชำระ', message: x.name, okText: 'ลบ', danger: true })) { const r = removeInstallment(x.id); if (r.error) err.value = r.error } }
const paidSum = (x) => installmentRows(x).filter((r) => r.paid).length
const SET = [['cash', 'เงินสด'], ['bank', 'ธนาคาร/โอน'], ['payable', 'ค้างจ่าย']]
</script>

<template>
  <div class="space-y-3">
    <div class="flex gap-2 overflow-x-auto"><button v-for="x in [{ v: 'rec', l: 'ค่าใช้จ่ายประจำ' }, { v: 'def', l: 'รายได้/ค่าใช้จ่ายล่วงหน้า' }, { v: 'inst', l: 'ผ่อนชำระ' }]" :key="x.v" class="chip whitespace-nowrap" :class="sub === x.v ? 'chip-on' : 'chip-off'" @click="sub = x.v; err = ''">{{ x.l }}</button></div>
    <p v-if="err" class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AppIcon name="alert" :size="16" /> {{ err }}</p>

    <template v-if="sub === 'rec'">
      <div class="flex items-center justify-between gap-2">
        <button class="btn-outline h-10 px-3" aria-label="เดือนก่อน" @click="ym = addMonths(ym, -1)">‹</button>
        <div class="font-semibold text-stone-900">{{ monthLabel(ym) }}</div>
        <button class="btn-outline h-10 px-3" aria-label="เดือนถัดไป" @click="ym = addMonths(ym, 1)">›</button>
      </div>
      <section class="card text-sm" aria-label="ค่าใช้จ่ายประจำเดือน">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">รายการประจำ</div><button v-if="canRec" class="btn-soft h-9 px-3" @click="rEdit()"><AppIcon name="plus" :size="16" /> เพิ่ม</button></div>
        <p v-if="!rows.length" class="py-6 text-center text-stone-400">ยังไม่มีรายการประจำ (เช่น ค่าเช่า ค่าไฟ ค่าอินเทอร์เน็ต)</p>
        <ul class="divide-y divide-stone-100">
          <li v-for="r in rows" :key="r.t.id" class="space-y-1.5 py-2.5">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0"><div class="font-medium text-stone-800">{{ r.t.name }} <span class="text-xs font-normal text-stone-400">{{ r.t.kind === 'fixed' ? 'คงที่' : 'ไม่คงที่' }}<template v-if="r.t.autoPost"> · ลงอัตโนมัติ</template></span></div><div class="text-xs text-stone-500">ครบกำหนด {{ dateOnly(recurringDue(r.t, ym)) }} · {{ r.t.kind === 'fixed' ? money(r.t.amount) : `ประมาณ ${money(r.t.estimate)}` }}</div></div>
              <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold" :class="STATE[r.state][1]">{{ STATE[r.state][0] }}</span>
            </div>
            <div v-if="r.skip" class="text-xs text-stone-500">เหตุผลที่ข้าม: {{ r.skip.reason }}</div>
            <div v-if="r.posted" class="text-xs text-stone-500">{{ r.posted.no }} · {{ money(r.posted.source.total) }}</div>
            <div v-if="canRec" class="flex flex-wrap gap-2">
              <template v-if="['missing', 'due', 'upcoming'].includes(r.state)">
                <button class="btn-primary h-9 px-3" @click="rPost(r.t)">{{ r.t.kind === 'fixed' ? 'บันทึกตามที่ตั้ง' : 'บันทึก (ใส่ยอด)' }}</button>
                <button class="btn-outline h-9 px-3" @click="skip.open = true; skip.id = r.t.id; err = ''">ข้ามเดือนนี้</button>
              </template>
              <button class="btn-soft h-9 px-3" @click="rEdit(r.t)">แก้ไข</button>
              <button class="btn-outline h-9 px-3 text-rose-600" @click="rDel(r.t)">ลบ</button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <template v-else-if="sub === 'def'">
      <section class="card text-sm">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">ล่วงหน้า ({{ deferrals().length }})</div><button v-if="canRec" class="btn-soft h-9 px-3" @click="dNew"><AppIcon name="plus" :size="16" /> เพิ่ม</button></div>
        <p v-if="!deferrals().length" class="py-6 text-center text-stone-400">เช่น จ่ายค่าเช่า/ประกันล่วงหน้า หรือรับค่าสมาชิกรายปี แล้วทยอยรับรู้รายเดือน</p>
        <ul class="divide-y divide-stone-100">
          <li v-for="d in deferrals()" :key="d.id" class="py-2.5">
            <button class="flex w-full items-start justify-between gap-2 text-left" :aria-expanded="dShow === d.id" @click="dShow = dShow === d.id ? '' : d.id">
              <span class="min-w-0"><span class="block font-medium text-stone-800">{{ d.name }}</span><span class="block text-xs text-stone-500">{{ d.kind === 'unearned' ? 'รายได้รับล่วงหน้า' : 'ค่าใช้จ่ายจ่ายล่วงหน้า' }} · {{ d.months }} เดือน เริ่ม {{ monthLabel(d.startMonth) }} · ตัดแล้ว {{ deferralRows(d).filter((r) => r.posted).length }}/{{ d.months }}</span></span>
              <b class="shrink-0">{{ money(d.total) }}</b>
            </button>
            <div v-if="dShow === d.id" class="mt-2 space-y-1 rounded-xl bg-stone-50 p-2 text-xs">
              <div v-for="r in deferralRows(d)" :key="r.no" class="flex justify-between" :class="r.posted ? 'text-stone-700' : 'text-stone-400'"><span>งวด {{ r.no }} · {{ monthLabel(r.ym) }}</span><span>{{ money(r.amount) }} {{ r.posted ? '✓' : '' }}</span></div>
              <button v-if="canRec" class="mt-1 text-rose-600 underline" @click="dDel(d)">ลบ (ได้เฉพาะที่ยังไม่เริ่มตัด)</button>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <template v-else>
      <section class="card text-sm">
        <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">ผ่อนชำระ ({{ installments().length }})</div><button v-if="canRec" class="btn-soft h-9 px-3" @click="iNew"><AppIcon name="plus" :size="16" /> เพิ่ม</button></div>
        <p v-if="!installments().length" class="py-6 text-center text-stone-400">เงินกู้ หรือซื้อสินทรัพย์/สินค้าแบบผ่อน (คิดดอกเบี้ยแบบคงที่ หรือลดต้นลดดอก)</p>
        <ul class="divide-y divide-stone-100">
          <li v-for="x in installments()" :key="x.id" class="py-2.5">
            <button class="flex w-full items-start justify-between gap-2 text-left" :aria-expanded="iShow === x.id" @click="iShow = iShow === x.id ? '' : x.id">
              <span class="min-w-0"><span class="block font-medium text-stone-800">{{ x.name }}</span><span class="block text-xs text-stone-500">{{ x.kind === 'loan' ? 'เงินกู้' : 'ซื้อผ่อน' }} · {{ x.ratePct }}% {{ x.method === 'flat' ? 'คงที่' : 'ลดต้นลดดอก' }} · ชำระแล้ว {{ paidSum(x) }}/{{ x.n }} งวด</span></span>
              <b class="shrink-0">{{ money(x.principal) }}</b>
            </button>
            <div v-if="iShow === x.id" class="mt-2 space-y-1 rounded-xl bg-stone-50 p-2 text-xs">
              <div class="grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-1 font-semibold text-stone-500"><span>งวด</span><span>ครบกำหนด</span><span class="text-right">ต้น</span><span class="text-right">ดอก</span><span class="text-right">คงเหลือ</span></div>
              <div v-for="r in installmentRows(x)" :key="r.no" class="grid grid-cols-[2rem_1fr_1fr_1fr_1fr] gap-1" :class="r.paid ? 'text-stone-700' : 'text-stone-500'"><span>{{ r.no }}</span><span>{{ dateOnly(r.due) }}{{ r.paid ? ' ✓' : '' }}</span><span class="text-right">{{ r.principal.toLocaleString() }}</span><span class="text-right">{{ r.interest.toLocaleString() }}</span><span class="text-right">{{ r.balance.toLocaleString() }}</span></div>
              <div v-if="canRec" class="flex flex-wrap gap-2 pt-1">
                <button v-if="paidSum(x) < x.n" class="btn-primary h-9 px-3" @click="Object.assign(pay, { open: true, id: x.id, date: today }); err = ''">จ่ายงวดถัดไป</button>
                <button class="btn-outline h-9 px-3 text-rose-600" @click="iDel(x)">ลบ (ยังไม่ชำระ)</button>
              </div>
            </div>
          </li>
        </ul>
      </section>
    </template>

    <p class="text-xs text-stone-400">ตัวเลขเป็นตัวช่วยบันทึกบัญชี ตรวจกับนักบัญชีก่อนใช้ยื่นภาษี · ภาษีซื้อของรายการเหล่านี้ให้บันทึกแยกในแท็บ "บันทึก"</p>

    <AppModal v-if="rOpen" :title="rf.id ? 'แก้ไขรายการประจำ' : 'เพิ่มรายการประจำ'" @close="rOpen = false">
      <div class="space-y-3">
        <div><label class="label">ชื่อรายการ</label><input v-model="rf.name" class="input" maxlength="100" aria-label="ชื่อรายการประจำ" /></div>
        <div><label class="label">หมวดบัญชี</label><select v-model="rf.account" class="input" aria-label="บัญชีรายการประจำ"><option value="" disabled>เลือกหมวด</option><option v-for="a in expAccts" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select></div>
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1"><button v-for="m in [['fixed', 'คงที่'], ['variable', 'ไม่คงที่']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="rf.kind === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="rf.kind = m[0]">{{ m[1] }}</button></div>
        <div v-if="rf.kind === 'fixed'"><label class="label">จำนวนเงินต่อเดือน</label><input v-model="rf.amount" v-num.dec class="input" aria-label="จำนวนเงินประจำ" /></div>
        <div v-else><label class="label">ประมาณการต่อเดือน (ใส่ยอดจริงทุกเดือนตอนบันทึก)</label><input v-model="rf.estimate" v-num.dec class="input" aria-label="ประมาณการ" /></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">ครบกำหนดวันที่</label><input v-model="rf.dueDay" v-num class="input" aria-label="วันครบกำหนด" /></div><div><label class="label">ผ่อนผัน (วัน) ก่อนเตือน</label><input v-model="rf.graceDays" v-num class="input" aria-label="วันผ่อนผัน" /></div></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">จ่ายโดย</label><select v-model="rf.settle" class="input" aria-label="จ่ายโดย"><option v-for="s in SET" :key="s[0]" :value="s[0]">{{ s[1] }}</option></select></div><div><label class="label">เริ่มเดือน</label><input v-model="rf.startMonth" type="month" class="input" aria-label="เริ่มเดือน" /></div></div>
        <div><label class="label">คู่ค้า</label><input v-model="rf.payee" class="input" maxlength="100" aria-label="คู่ค้า" /></div>
        <AppSwitch v-if="rf.kind === 'fixed'" v-model="rf.autoPost" label="ลงบัญชีอัตโนมัติเมื่อถึงกำหนด" />
        <AppSwitch v-model="rf.active" label="ใช้งาน" />
        <p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="rOpen = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="rSave">บันทึก</button></template>
    </AppModal>
    <AppModal v-if="post.open" :title="`บันทึก ${post.t?.name}`" @close="post.open = false">
      <div><label class="label">ยอดเดือน {{ monthLabel(ym) }} (ประมาณ {{ money(post.t?.estimate) }})</label><input v-model="post.amount" v-num.dec class="input" aria-label="ยอดเดือนนี้" /></div>
      <p v-if="err" class="mt-2 text-sm text-rose-600" role="alert">{{ err }}</p>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="post.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="rPostVar">บันทึก</button></template>
    </AppModal>
    <AppModal v-if="skip.open" title="ข้ามเดือนนี้" @close="skip.open = false">
      <div><label class="label">เหตุผล</label><input v-model="skip.reason" class="input" maxlength="200" aria-label="เหตุผลข้ามเดือน" /></div>
      <p v-if="err" class="mt-2 text-sm text-rose-600" role="alert">{{ err }}</p>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="skip.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="rSkip">ยืนยัน</button></template>
    </AppModal>
    <AppModal v-if="dOpen" title="เพิ่มรายการล่วงหน้า" @close="dOpen = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1"><button v-for="m in [['prepaid', 'จ่ายล่วงหน้า'], ['unearned', 'รับล่วงหน้า']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="df.kind === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="df.kind = m[0]; df.account = ''">{{ m[1] }}</button></div>
        <div><label class="label">ชื่อรายการ</label><input v-model="df.name" class="input" maxlength="100" aria-label="ชื่อรายการล่วงหน้า" /></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">จำนวนเงินรวม</label><input v-model="df.total" v-num.dec class="input" aria-label="ยอดล่วงหน้า" /></div><div><label class="label">ทยอยกี่เดือน</label><input v-model="df.months" v-num class="input" aria-label="จำนวนเดือนล่วงหน้า" /></div></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">เริ่มตัดเดือน</label><input v-model="df.startMonth" type="month" class="input" aria-label="เริ่มตัดเดือน" /></div><div><label class="label">วันที่{{ df.kind === 'unearned' ? 'รับ' : 'จ่าย' }}เงิน</label><input v-model="df.payDate" type="date" class="input" aria-label="วันที่รับจ่ายล่วงหน้า" /></div></div>
        <div><label class="label">{{ df.kind === 'unearned' ? 'บัญชีรายได้ที่จะรับรู้' : 'บัญชีค่าใช้จ่ายที่จะตัด' }}</label><select v-model="df.account" class="input" aria-label="บัญชีปลายทางล่วงหน้า"><option value="" disabled>เลือกบัญชี</option><option v-for="a in (df.kind === 'unearned' ? revAccts : expAccts)" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select></div>
        <div><label class="label">{{ df.kind === 'unearned' ? 'รับเงินทาง' : 'จ่ายโดย' }}</label><select v-model="df.method" class="input" aria-label="วิธีรับจ่ายล่วงหน้า"><option v-for="s in SET.filter((x) => df.kind === 'prepaid' || x[0] !== 'payable')" :key="s[0]" :value="s[0]">{{ s[1] }}</option></select></div>
        <p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="dOpen = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="dSave">บันทึก</button></template>
    </AppModal>
    <AppModal v-if="iOpen" title="เพิ่มรายการผ่อนชำระ" @close="iOpen = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1"><button v-for="m in [['loan', 'เงินกู้'], ['purchase', 'ซื้อผ่อน']]" :key="m[0]" type="button" class="h-9 rounded-lg text-sm font-medium" :class="inf.kind === m[0] ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="inf.kind = m[0]">{{ m[1] }}</button></div>
        <div><label class="label">ชื่อรายการ</label><input v-model="inf.name" class="input" maxlength="100" aria-label="ชื่อรายการผ่อน" /></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">เงินต้น</label><input v-model="inf.principal" v-num.dec class="input" aria-label="เงินต้นผ่อน" /></div><div><label class="label">ดอกเบี้ย % ต่อปี</label><input v-model="inf.ratePct" v-num.dec class="input" aria-label="ดอกเบี้ยต่อปี" /></div></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">จำนวนงวด (เดือน)</label><input v-model="inf.n" v-num class="input" aria-label="จำนวนงวด" /></div><div><label class="label">วิธีคิดดอก</label><select v-model="inf.method" class="input" aria-label="วิธีคิดดอก"><option value="reducing">ลดต้นลดดอก</option><option value="flat">คงที่ (flat)</option></select></div></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">วันที่เริ่ม/รับเงิน</label><input v-model="inf.startDate" type="date" class="input" aria-label="วันที่เริ่มผ่อน" /></div><div><label class="label">ครบงวดแรก</label><input v-model="inf.firstDue" type="date" class="input" aria-label="ครบงวดแรก" /></div></div>
        <div v-if="inf.kind === 'loan'"><label class="label">รับเงินเข้า</label><select v-model="inf.receive" class="input" aria-label="รับเงินกู้เข้า"><option value="bank">ธนาคาร</option><option value="cash">เงินสด</option></select></div>
        <div v-else><label class="label">บัญชีที่ซื้อมา (สินทรัพย์/ค่าใช้จ่าย)</label><select v-model="inf.account" class="input" aria-label="บัญชีซื้อผ่อน"><option value="" disabled>เลือกบัญชี</option><option v-for="a in buyAccts" :key="a.id" :value="a.id">{{ a.id }} {{ a.name }}</option></select><p class="mt-1 text-xs text-stone-500">ถ้าเลือก 1500 สินทรัพย์ถาวร ให้ลงทะเบียนสินทรัพย์ในแท็บ "สินทรัพย์" แบบไม่บันทึกการซื้อด้วย</p></div>
        <p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="iOpen = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="iSave">บันทึก</button></template>
    </AppModal>
    <AppModal v-if="pay.open" title="จ่ายงวดถัดไป" @close="pay.open = false">
      <div class="space-y-3"><div><label class="label">วันที่จ่าย</label><input v-model="pay.date" type="date" class="input" aria-label="วันที่จ่ายงวด" /></div><div><label class="label">จ่ายโดย</label><select v-model="pay.method" class="input" aria-label="จ่ายงวดโดย"><option value="bank">ธนาคาร</option><option value="cash">เงินสด</option></select></div><p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p></div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="pay.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="iPay">ยืนยันจ่าย</button></template>
    </AppModal>
  </div>
</template>
