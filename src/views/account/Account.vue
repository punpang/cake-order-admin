<script setup>
import { orderNo } from '../../lib/format'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  db, myProfile, updateMyProfile, myOrders, myBirthdays, submitReview, customerLogout, changePin, changePhone, requestDeletion, myDeletionRequest, ensureMyScanCode,
} from '../../data/store'
import { describeSelections } from '../../lib/pricing'
import { isPin } from '../../lib/customerAuth'
import { forBoughtIds } from '../../lib/storefront'
import { initialOf } from '../../lib/accountView'
import CakeImage from '../../components/CakeImage.vue'
import StorePrice from '../../components/StorePrice.vue'
import { money, dateOnly, dateTime, formatPhone, phoneValid, phoneDigits, num } from '../../lib/format'
import { mdLabel } from '../../lib/birthday'
import AppIcon from '../../components/AppIcon.vue'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import PayDueBadge from '../../components/PayDueBadge.vue'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import OtpStep from '../../components/OtpStep.vue'
import AccountRewards from '../../components/AccountRewards.vue'
import MemberCard from '../../components/MemberCard.vue'
import { myTaxProfile, saveMyTaxProfile, myAddressChoices } from '../../data/acct'
import TaxAddressField from '../../components/TaxAddressField.vue'
import { lineStatus, lineUnlink } from '../../lib/line'
import { askConfirm } from '../../lib/confirm'

// บัญชีของฉัน: เห็นข้อมูลของตัวเองทั้งหมด แก้ได้เฉพาะ ชื่อ / รับข่าวโปร · เบอร์และ PIN ต้องยืนยัน OTP
const router = useRouter()
const me = computed(() => myProfile())
const route = useRoute()

// การ์ดสมาชิก: โหลดบาร์โค้ดเมื่อลูกค้าพลิกการ์ดครั้งแรก
const scanErr = ref('')
async function loadScanCode() {
  scanErr.value = ''
  const r = await ensureMyScanCode()
  if (r.error) scanErr.value = r.error
}
const TAB_KEYS = ['profile', 'orders', 'rewards', 'security']
// แถบเมนูล่างของหน้าร้านลิงก์มาที่แท็บด้วย ?tab= (เปลี่ยนตาม query ได้ด้วย)
const tab = ref(TAB_KEYS.includes(String(route.query.tab)) ? String(route.query.tab) : 'profile')
watch(() => route.query.tab, (v) => { if (TAB_KEYS.includes(String(v))) tab.value = String(v) })
const tabs = [
  { v: 'profile', l: 'ข้อมูล' },
  { v: 'orders', l: 'ออร์เดอร์' },
  { v: 'rewards', l: 'คะแนน' },
  { v: 'security', l: 'ความปลอดภัย' },
]

function switchTab(v) {
  tab.value = v
  msg.value = ''
  err.value = ''
}
const initial = computed(() => initialOf(me.value?.name))

// ---------- ข้อมูลส่วนตัว ----------
const form = reactive({ name: me.value?.name || '', promoOptIn: !!me.value?.promoOptIn })
// ปุ่มบันทึกเปิดเฉพาะเมื่อมีการแก้ไข
const profileDirty = computed(() => !!me.value && (form.name.trim() !== me.value.name || form.promoOptIn !== !!me.value.promoOptIn))
const msg = ref('')
const err = ref('')
const savingProfile = ref(false)
async function saveProfile() {
  if (savingProfile.value) return
  msg.value = err.value = ''
  savingProfile.value = true
  const r = await updateMyProfile({ ...form })
  savingProfile.value = false
  if (r.ok) msg.value = 'บันทึกแล้ว'
  else err.value = r.error
}
const birthdays = computed(() => myBirthdays())
// ข้อมูลออกใบกำกับภาษี (เก็บได้ชุดเดียว)
const tax = reactive({ name: '', taxId: '', branch: '00000', address: '', ...(myTaxProfile() || {}) })
const hasTax = computed(() => !!(tax.name || tax.taxId || tax.address))
const taxOpen = ref(false) // ปิดไว้เป็นค่าเริ่มต้น: ยังไม่มีข้อมูล → ปุ่ม "เพิ่ม" · มีแล้ว → สรุป กดแก้ไขจึงเปิดฟอร์ม
const taxMsg = ref('')
const taxErr = ref('')
function saveTax() {
  taxMsg.value = taxErr.value = ''
  const r = saveMyTaxProfile(tax)
  if (r.ok) { taxMsg.value = 'บันทึกข้อมูลใบกำกับภาษีแล้ว'; taxOpen.value = false }
  else taxErr.value = r.error
}
function cancelTax() {
  Object.assign(tax, { name: '', taxId: '', branch: '00000', address: '' }, myTaxProfile() || {})
  taxErr.value = ''
  taxOpen.value = false
}

// ---------- ออร์เดอร์ ----------
const orders = computed(() => myOrders())
// สำหรับคุณ: แนะนำจากสินค้าที่เคยสั่ง (ไม่นับออร์เดอร์ที่ยกเลิก) · ไม่มีข้อมูล → ขายดี
const picks = computed(() => {
  const bought = orders.value.filter((o) => o.status !== 'cancelled').flatMap((o) => (o.items || []).filter((i) => i.kind === 'retail' && i.retailId).map((i) => i.retailId))
  return forBoughtIds(db, bought)
})
const CHANNEL = { pos: 'หน้าร้าน' }

// ---------- ขั้นตอนที่ต้องยืนยัน OTP (เปลี่ยน PIN / เปลี่ยนเบอร์ / ขอลบข้อมูล) ----------
// การเชื่อม LINE: ดูสถานะและยกเลิกได้ (ยกเลิกแล้วลบชื่อ LINE และประวัติข้อความทันที)
const lineInfo = ref(null)
const lineMsg = ref('')
const lineErr = ref('')
const lineBusy = ref(false)
async function loadLine() {
  const r = await lineStatus()
  lineInfo.value = typeof r.linked === 'boolean' ? r : null // ไม่แสดงการ์ดถ้าโหลดไม่ได้ (เช่น โหมดทดสอบ)
}
async function unlinkLine() {
  lineMsg.value = lineErr.value = ''
  if (!(await askConfirm({ title: 'ยกเลิกการเชื่อม LINE', message: 'ระบบจะลบชื่อ LINE และประวัติข้อความ LINE ของคุณทันที', okText: 'ยกเลิกการเชื่อม', danger: true }))) return
  lineBusy.value = true
  const r = await lineUnlink()
  lineBusy.value = false
  if (r.ok) {
    lineMsg.value = 'ยกเลิกการเชื่อม LINE แล้ว'
    await loadLine()
  } else lineErr.value = r.error || 'ยกเลิกไม่สำเร็จ กรุณาลองใหม่'
}
onMounted(loadLine)

const flow = ref('') // '' | pin | phone | delete
const step = ref(1)
const token = ref('')
const f = reactive({ pin: '', pin2: '', phone: '', note: '', error: '' })
function start(kind) {
  Object.assign(f, { pin: '', pin2: '', phone: '', note: '', error: '' })
  flow.value = kind
  step.value = kind === 'phone' ? 1 : 2
  token.value = ''
}
const close = () => (flow.value = '')
function newPhoneNext() {
  f.error = ''
  if (!phoneValid(f.phone)) return (f.error = 'กรอกเบอร์โทรให้ถูกต้อง')
  if (phoneDigits(f.phone) === phoneDigits(me.value.phone)) return (f.error = 'เป็นเบอร์เดิมของคุณ')
  step.value = 2
}
function verified(r) {
  token.value = r.token
  step.value = 3
}
async function finishPin() {
  f.error = ''
  if (!isPin(f.pin)) return (f.error = 'PIN ต้องเป็นตัวเลข 6 หลัก')
  if (f.pin !== f.pin2) return (f.error = 'PIN ที่ยืนยันไม่ตรงกัน')
  const r = await changePin({ token: token.value, pin: f.pin })
  if (r.ok) {
    close()
    msg.value = 'เปลี่ยน PIN แล้ว'
  } else f.error = r.error
}
async function finishPhone() {
  const r = await changePhone({ token: token.value, phone: phoneDigits(f.phone) })
  if (r.ok) {
    close()
    msg.value = 'เปลี่ยนเบอร์โทรแล้ว'
  } else f.error = r.error
}
async function finishDelete() {
  const r = await requestDeletion({ token: token.value, note: f.note })
  if (r.ok) {
    close()
    msg.value = 'ส่งคำขอลบข้อมูลแล้ว ร้านจะตรวจสอบและแจ้งผล'
  } else f.error = r.error
}
const delReq = computed(() => (me.value ? myDeletionRequest() : null))

function logout() {
  customerLogout()
  router.replace('/')
}
</script>

<template>
  <div v-if="me" class="mx-auto max-w-2xl space-y-4 px-4 pt-5 pb-10 md:max-w-4xl">
    <!-- หัวบัญชี -->
    <section class="card flex items-center gap-4">
      <span class="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 font-display text-2xl text-brand-700" aria-hidden="true">{{ initial }}</span>
      <div class="min-w-0 flex-1">
        <p class="text-xs text-stone-500">สวัสดี</p>
        <h1 class="truncate text-[22px] leading-tight text-stone-900">{{ me.name }}</h1>
      </div>
      <button type="button" class="shrink-0 rounded-full bg-brand-50 px-3 py-1.5 text-sm font-semibold whitespace-nowrap text-brand-800 transition hover:bg-brand-100" @click="switchTab('rewards')">
        {{ num(me.points) }} คะแนน
      </button>
    </section>

    <!-- สมาชิก: การ์ดบัตร แตะเพื่อพลิกไปแสดงบาร์โค้ดให้พนักงานสแกน -->
    <section class="space-y-2" aria-labelledby="member-title">
      <h2 id="member-title" class="card-title">สมาชิก</h2>
      <MemberCard :me="me" :tier="db.memberCard" :scan-code="me.scanCode || ''" :scan-err="scanErr" :shop-name="db.shop?.name || ''" @show-back="loadScanCode" />
    </section>

    <!-- เมนูแท็บ -->
    <nav class="flex gap-1 overflow-x-auto rounded-2xl bg-stone-100 p-1 [scrollbar-width:none]" aria-label="เมนูบัญชี">
      <button
        v-for="t in tabs"
        :key="t.v"
        type="button"
        class="h-10 min-w-max flex-1 rounded-xl px-3 text-[13px] font-medium whitespace-nowrap transition"
        :class="tab === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600 hover:text-stone-900'"
        :aria-current="tab === t.v ? 'page' : undefined"
        @click="switchTab(t.v)"
      >{{ t.l }}</button>
    </nav>
    <p v-if="msg" role="status" class="flex items-center gap-2 rounded-2xl bg-success-50 px-4 py-3 text-sm text-success-800"><AppIcon name="check" :size="16" /> {{ msg }}</p>

    <!-- ข้อมูล -->
    <div v-if="tab === 'profile'" class="space-y-4 md:grid md:grid-cols-2 md:items-start md:gap-4 md:space-y-0">
      <section v-if="lineInfo" class="card space-y-3" aria-labelledby="acct-line">
        <h2 id="acct-line" class="card-title">LINE</h2>
        <p class="text-sm text-stone-600">{{ lineInfo.linked ? `เชื่อมกับ LINE แล้ว${lineInfo.displayName ? ` (${lineInfo.displayName})` : ''}` : 'ยังไม่ได้เชื่อมกับ LINE' }}</p>
        <p v-if="lineErr" role="alert" class="text-sm text-danger-700">{{ lineErr }}</p>
        <p v-if="lineMsg" role="status" class="text-sm text-success-800">{{ lineMsg }}</p>
        <button v-if="lineInfo.linked" type="button" class="btn-outline w-full" :disabled="lineBusy" @click="unlinkLine">{{ lineBusy ? 'กำลังยกเลิก…' : 'ยกเลิกการเชื่อม LINE' }}</button>
      </section>
      <form class="card space-y-5" aria-labelledby="acct-personal" @submit.prevent="saveProfile">
        <h2 id="acct-personal" class="card-title">ข้อมูลส่วนตัว</h2>
        <div>
          <label class="label" for="acct-name">ชื่อ</label>
          <input id="acct-name" v-model="form.name" class="input" maxlength="100" autocomplete="name" />
        </div>
        <div>
          <span class="label">เบอร์โทร</span>
          <div class="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-4 py-3">
            <span class="font-medium text-stone-900">{{ formatPhone(me.phone) }}</span>
            <button type="button" class="text-sm font-semibold text-brand-700 underline underline-offset-4" @click="start('phone')">เปลี่ยนเบอร์</button>
          </div>
          <p class="mt-1.5 text-xs text-stone-500">การเปลี่ยนเบอร์ต้องยืนยันด้วยรหัส OTP ที่เบอร์ใหม่</p>
        </div>
        <div class="flex items-center justify-between gap-4 rounded-xl bg-stone-50 px-4 py-3">
          <div class="min-w-0">
            <p class="text-sm font-medium text-stone-900">รับข่าวสารและโปรโมชัน</p>
            <p class="text-xs text-stone-500">รวมข่าวอวยพรวันเกิด</p>
          </div>
          <AppSwitch v-model="form.promoOptIn" aria-label="รับข่าวสารและโปรโมชัน" />
        </div>
        <p v-if="err" role="alert" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>
        <button class="btn-primary w-full" :disabled="savingProfile || !profileDirty">
          {{ savingProfile ? 'กำลังบันทึก…' : profileDirty ? 'บันทึกการเปลี่ยนแปลง' : 'บันทึก' }}
        </button>
      </form>

      <div class="space-y-4">
        <!-- ใบกำกับภาษี: แสดงสรุปก่อน กดแก้ไขจึงเปิดฟอร์ม -->
        <section class="card space-y-4" aria-labelledby="acct-tax">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <h2 id="acct-tax" class="card-title">ข้อมูลใบกำกับภาษี</h2>
              <p class="mt-0.5 text-xs text-stone-500">ใช้ออกใบกำกับภาษีให้ทุกครั้งที่สั่ง · บันทึกได้ 1 ชุด</p>
            </div>
            <button v-if="hasTax && !taxOpen" type="button" class="btn-outline h-9 shrink-0 px-4 text-sm" @click="taxOpen = true">แก้ไข</button>
          </div>
          <p v-if="taxMsg && !taxOpen" role="status" class="text-sm text-success-700">{{ taxMsg }}</p>

          <button v-if="!hasTax && !taxOpen" type="button" class="btn-soft w-full" @click="taxOpen = true">+ เพิ่มข้อมูลใบกำกับภาษี</button>

          <dl v-else-if="!taxOpen" class="grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-stone-50 p-4 text-sm">
            <div class="col-span-2"><dt class="text-xs text-stone-500">ชื่อผู้ซื้อ</dt><dd class="font-medium text-stone-900">{{ tax.name || '—' }}</dd></div>
            <div><dt class="text-xs text-stone-500">เลขประจำตัวผู้เสียภาษี</dt><dd class="text-stone-900">{{ tax.taxId || '—' }}</dd></div>
            <div><dt class="text-xs text-stone-500">สาขา</dt><dd class="text-stone-900">{{ tax.branch || '00000' }}</dd></div>
            <div class="col-span-2"><dt class="text-xs text-stone-500">ที่อยู่ตามใบกำกับ</dt><dd class="whitespace-pre-line text-stone-900">{{ tax.address || '—' }}</dd></div>
          </dl>

          <form v-else class="space-y-4" @submit.prevent="saveTax">
            <div>
              <label class="label" for="tax-name">ชื่อผู้ซื้อ</label>
              <input id="tax-name" v-model="tax.name" class="input" maxlength="120" />
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div class="col-span-2">
                <label class="label" for="tax-id">เลขประจำตัวผู้เสียภาษี</label>
                <input id="tax-id" v-model="tax.taxId" inputmode="numeric" maxlength="13" class="input" />
              </div>
              <div>
                <label class="label" for="tax-branch">สาขา</label>
                <input id="tax-branch" v-model="tax.branch" inputmode="numeric" maxlength="5" class="input" />
              </div>
            </div>
            <div>
              <span class="label">ที่อยู่ตามใบกำกับ</span>
              <TaxAddressField v-model="tax.address" label="ที่อยู่ใบกำกับของฉัน" :suggestions="myAddressChoices()" />
            </div>
            <p v-if="taxErr" role="alert" class="text-sm text-danger-700">{{ taxErr }}</p>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn-outline" @click="cancelTax">ยกเลิก</button>
              <button type="submit" class="btn-primary">บันทึก</button>
            </div>
          </form>
        </section>

        <!-- วันเกิด -->
        <section class="card space-y-3" aria-labelledby="acct-bday">
          <h2 id="acct-bday" class="card-title">วันเกิดที่เคยสั่ง</h2>
          <p v-if="!birthdays.length" class="text-sm text-stone-500">ยังไม่มี</p>
          <ul v-else class="flex flex-wrap gap-2">
            <li v-for="(b, i) in birthdays" :key="i" class="rounded-full bg-stone-100 px-3 py-1.5 text-sm text-stone-700">{{ b.name || 'ไม่ระบุชื่อ' }} · {{ mdLabel(b.md) }}</li>
          </ul>
          <p class="text-xs text-stone-500">ข้อมูลนี้มาจากออร์เดอร์ แก้ไขได้โดยแจ้งร้าน</p>
        </section>
      </div>
    </div>

    <!-- ออร์เดอร์ -->
    <div v-else-if="tab === 'orders'" class="space-y-3">
      <section v-if="picks.length" class="card space-y-3" aria-label="สำหรับคุณ">
        <div class="card-title">สำหรับคุณ</div>
        <p class="text-sm text-stone-600">แนะนำจากสิ่งที่คุณเคยสั่ง · กดเพื่อดูรายละเอียด</p>
        <ul class="grid grid-cols-2 gap-3 md:grid-cols-4">
          <li v-for="r in picks" :key="r.product.id">
            <RouterLink :to="`/menu/ready/${r.product.id}`" class="block overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-stone-200 transition hover:shadow-md">
              <div class="aspect-square overflow-hidden"><CakeImage :src="r.product.images?.[0]" :alt="r.product.name" /></div>
              <div class="p-2">
                <div class="line-clamp-1 text-sm font-semibold text-stone-900">{{ r.product.name }}</div>
                <StorePrice :price="r.price" :regular="r.regular" />
              </div>
            </RouterLink>
          </li>
        </ul>
      </section>
      <p v-if="!orders.length" class="card py-10 text-center text-stone-500">ยังไม่มีออร์เดอร์</p>
      <RouterLink v-for="o in orders" :key="o.id" :to="`/account/orders/${o.id}`" class="card flex items-center gap-3 px-4 py-3 transition hover:border-brand-300 active:scale-[0.99]">
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2"><b class="text-stone-900">{{ orderNo(o.code) }}</b><span v-if="CHANNEL[o.channel]" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{{ CHANNEL[o.channel] }}</span></span>
          <span class="block text-xs text-stone-500">{{ o.channel === 'pos' ? dateTime(o.createdAt) : `นัดรับ ${dateTime(o.pickupAt)}` }}</span>
          <span class="block truncate text-xs text-stone-500">{{ o.items[0]?.name }}<template v-if="o.items.length > 1"> +{{ o.items.length - 1 }}</template></span>
        </span>
        <span class="shrink-0 text-right"><StatusBadge :status="o.status" /><span class="mt-1 block"><PayDueBadge :due="o.payDue" short /></span><span class="mt-1 block text-sm font-semibold text-stone-900">{{ money(o.total) }}</span><span v-if="o.balance > 0 && o.status !== 'cancelled'" class="block text-xs text-warning-700">ค้าง {{ money(o.balance) }}</span></span>
      </RouterLink>
    </div>

    <!-- คะแนน / แลกของ / กาชา / คูปอง -->
    <AccountRewards v-else-if="tab === 'rewards'" />

    <!-- ความปลอดภัย -->
    <div v-else class="space-y-4">
      <section class="card p-0" aria-label="การรักษาความปลอดภัย">
        <button type="button" class="flex w-full items-center gap-3 rounded-2xl px-4 py-4 text-left transition hover:bg-stone-50" @click="start('pin')">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-700"><AppIcon name="lock" :size="18" /></span>
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-stone-900">เปลี่ยน PIN</span>
            <span class="block text-xs text-stone-500">ต้องยืนยัน OTP ที่เบอร์ {{ formatPhone(me.phone) }} ก่อน</span>
          </span>
          <AppIcon name="next" :size="18" class="shrink-0 text-stone-500" />
        </button>
      </section>

      <section class="card space-y-3 border border-danger-100" aria-labelledby="acct-delete">
        <h2 id="acct-delete" class="card-title flex items-center gap-2"><AppIcon name="shield" :size="16" /> ขอลบข้อมูลของฉัน</h2>
        <p class="text-sm text-stone-600">เมื่อร้านอนุมัติ ร้านจะลบชื่อ เบอร์โทร และ Facebook ที่ผูกไว้ บัญชีและ PIN แชท คะแนน/คูปอง รีวิว และรายละเอียดส่วนตัวในออร์เดอร์ (ที่อยู่ วันเกิด รูปอ้างอิง สลิป ข้อความบนเค้ก)</p>
        <p class="text-sm text-stone-600">ร้านจะเก็บ <b>ออร์เดอร์และการชำระเงินแบบไม่ระบุตัวตน</b> เพื่อเป็นหลักฐานทางบัญชี · ลบได้เมื่อไม่มีออร์เดอร์ที่ยังไม่จบหรือยอดค้างชำระ</p>
        <div v-if="delReq?.status === 'pending'" class="rounded-xl bg-warning-50 p-3 text-sm text-warning-800">ส่งคำขอเมื่อ {{ dateTime(delReq.createdAt) }} · รอร้านตรวจสอบ</div>
        <div v-else-if="delReq?.status === 'rejected'" class="rounded-xl bg-danger-50 p-3 text-sm text-danger-700">คำขอก่อนหน้าไม่ได้รับอนุมัติ: {{ delReq.reason }}</div>
        <button v-if="delReq?.status !== 'pending'" class="btn-danger w-full" @click="start('delete')">ขอลบข้อมูลของฉัน</button>
      </section>
    </div>

    <!-- ออกจากระบบ: อยู่ท้ายทุกแท็บ ไม่แย่งความสำคัญจากเนื้อหา -->
    <div class="pt-2 text-center">
      <button type="button" class="inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium text-stone-500 transition hover:bg-stone-100 hover:text-stone-800" @click="logout">
        <AppIcon name="logout" :size="16" /> ออกจากระบบ
      </button>
    </div>
  </div>

  <!-- ขั้นตอนยืนยัน OTP -->
  <AppModal v-if="flow" :title="{ pin: 'เปลี่ยน PIN', phone: 'เปลี่ยนเบอร์โทร', delete: 'ขอลบข้อมูล' }[flow]" @close="close">
    <div v-if="flow === 'phone' && step === 1" class="space-y-4">
      <div><label class="label">เบอร์ใหม่</label><PhoneInput v-model="f.phone" /></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="newPhoneNext">ขอรหัสยืนยัน (OTP)</button>
    </div>

    <OtpStep v-else-if="step === 2" :phone="flow === 'phone' ? phoneDigits(f.phone) : ''" :purpose="{ pin: 'change_pin', phone: 'change_phone', delete: 'delete' }[flow]" @verified="verified" @cancel="flow === 'phone' ? (step = 1) : close()" />

    <div v-else-if="flow === 'pin'" class="space-y-4">
      <div><label class="label">PIN ใหม่ 6 หลัก</label><PinInput v-model="f.pin" autocomplete="new-password" /></div>
      <div><label class="label">ยืนยัน PIN ใหม่</label><PinInput v-model="f.pin2" autocomplete="new-password" /></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="finishPin">เปลี่ยน PIN</button>
    </div>

    <div v-else-if="flow === 'phone'" class="space-y-4">
      <p class="text-sm text-stone-600">ยืนยันแล้ว เปลี่ยนเบอร์เป็น <b>{{ formatPhone(f.phone) }}</b></p>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="finishPhone">ยืนยันการเปลี่ยนเบอร์</button>
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm text-stone-600">ส่งคำขอให้ร้านตรวจสอบ ระหว่างนี้บัญชียังใช้งานได้ตามปกติ</p>
      <div><label class="label">หมายเหตุถึงร้าน (ไม่บังคับ)</label><textarea v-model="f.note" rows="3" maxlength="300" class="input"></textarea></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-danger w-full" @click="finishDelete">ส่งคำขอลบข้อมูล</button>
    </div>
  </AppModal>
</template>
