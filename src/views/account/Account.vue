<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  db, myProfile, updateMyProfile, myOrders, myBirthdays, submitReview, customerLogout, changePin, changePhone, requestDeletion, myDeletionRequest,
} from '../../data/store'
import { describeSelections } from '../../lib/pricing'
import { isPin } from '../../lib/customerAuth'
import { money, dateOnly, dateTime, formatPhone, phoneValid, phoneDigits, num } from '../../lib/format'
import { mdLabel } from '../../lib/birthday'
import AppIcon from '../../components/AppIcon.vue'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import StatusBadge from '../../components/StatusBadge.vue'
import PhoneInput from '../../components/PhoneInput.vue'
import PinInput from '../../components/PinInput.vue'
import OtpStep from '../../components/OtpStep.vue'
import AccountRewards from '../../components/AccountRewards.vue'

// บัญชีของฉัน: เห็นข้อมูลของตัวเองทั้งหมด แก้ได้เฉพาะ ชื่อ / LINE ID / รับข่าวโปร · เบอร์และ PIN ต้องยืนยัน OTP
const router = useRouter()
const me = computed(() => myProfile())
const tab = ref('profile')
const tabs = [
  { v: 'profile', l: 'ข้อมูล' },
  { v: 'orders', l: 'ออร์เดอร์' },
  { v: 'rewards', l: 'คะแนน' },
  { v: 'security', l: 'ความปลอดภัย' },
]

// ---------- ข้อมูลส่วนตัว ----------
const form = reactive({ name: me.value?.name || '', line: me.value?.line || '', promoOptIn: !!me.value?.promoOptIn })
const msg = ref('')
const err = ref('')
function saveProfile() {
  msg.value = err.value = ''
  const r = updateMyProfile({ ...form })
  if (r.ok) msg.value = 'บันทึกแล้ว'
  else err.value = r.error
}
const birthdays = computed(() => myBirthdays())

// ---------- ออร์เดอร์ ----------
const orders = computed(() => myOrders())
const CHANNEL = { pos: 'หน้าร้าน' }
const REVIEW = { pending: 'รอร้านตรวจสอบ', approved: 'แสดงบนหน้าร้านแล้ว', rejected: 'ไม่ได้แสดง' }
const rv = reactive({ order: null, rating: 5, text: '', error: '' })
function openReview(o) {
  Object.assign(rv, { order: o, rating: 5, text: '', error: '' })
}
function sendReview() {
  const r = submitReview({ orderId: rv.order.id, rating: rv.rating, text: rv.text })
  if (r.ok) rv.order = null
  else rv.error = r.error
}

// ---------- ขั้นตอนที่ต้องยืนยัน OTP (เปลี่ยน PIN / เปลี่ยนเบอร์ / ขอลบข้อมูล) ----------
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
function finishPhone() {
  const r = changePhone({ token: token.value, phone: phoneDigits(f.phone) })
  if (r.ok) {
    close()
    msg.value = 'เปลี่ยนเบอร์โทรแล้ว'
  } else f.error = r.error
}
function finishDelete() {
  const r = requestDeletion({ token: token.value, note: f.note })
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
  <div v-if="me" class="mx-auto max-w-2xl px-4 pt-6 pb-4">
    <div class="mb-4 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="truncate text-2xl font-semibold text-stone-900">สวัสดี {{ me.name }}</h1>
        <p class="text-sm text-stone-500">{{ formatPhone(me.phone) }} · {{ num(me.points) }} คะแนน</p>
      </div>
      <button class="btn-outline h-10 px-3" @click="logout"><AppIcon name="logout" :size="16" /> ออก</button>
    </div>

    <div class="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-stone-100 p-1">
      <button v-for="t in tabs" :key="t.v" type="button" class="h-10 rounded-xl text-xs font-semibold transition sm:text-sm" :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="tab = t.v; msg = err = ''">{{ t.l }}</button>
    </div>
    <p v-if="msg" class="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{{ msg }}</p>

    <!-- ข้อมูล -->
    <div v-if="tab === 'profile'" class="space-y-4">
      <form class="card space-y-4" @submit.prevent="saveProfile">
        <div class="card-title">ข้อมูลของฉัน</div>
        <div><label class="label">ชื่อ</label><input v-model="form.name" class="input" maxlength="100" autocomplete="name" /></div>
        <div>
          <label class="label">เบอร์โทร</label>
          <div class="flex gap-2">
            <input :value="formatPhone(me.phone)" class="input flex-1 bg-stone-100" disabled aria-readonly="true" />
            <button type="button" class="btn-outline" @click="start('phone')">เปลี่ยน</button>
          </div>
          <p class="mt-1 text-xs text-stone-400">การเปลี่ยนเบอร์ต้องยืนยัน OTP ที่เบอร์ใหม่</p>
        </div>
        <div><label class="label">LINE ID</label><input v-model="form.line" class="input" maxlength="50" placeholder="ไม่บังคับ" /></div>
        <AppSwitch v-model="form.promoOptIn" label="รับข่าวสารและโปรโมชัน (รวมอวยพรวันเกิด)" />
        <p v-if="err" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ err }}</p>
        <button class="btn-primary w-full">บันทึก</button>
      </form>

      <section class="card">
        <div class="card-title">วันเกิดที่เคยสั่ง</div>
        <p v-if="!birthdays.length" class="text-sm text-stone-500">ยังไม่มี</p>
        <ul v-else class="space-y-1 text-sm text-stone-700">
          <li v-for="(b, i) in birthdays" :key="i">{{ b.name || 'ไม่ระบุชื่อ' }} · {{ mdLabel(b.md) }}</li>
        </ul>
        <p class="mt-2 text-xs text-stone-400">ข้อมูลนี้มาจากออร์เดอร์ แก้ไขได้โดยแจ้งร้าน</p>
      </section>
    </div>

    <!-- ออร์เดอร์ -->
    <div v-else-if="tab === 'orders'" class="space-y-3">
      <p v-if="!orders.length" class="card py-10 text-center text-stone-500">ยังไม่มีออร์เดอร์</p>
      <details v-for="o in orders" :key="o.id" class="card p-0">
        <summary class="flex cursor-pointer list-none items-center gap-3 px-4 py-3">
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2"><b class="text-stone-900">{{ o.code }}</b><span v-if="CHANNEL[o.channel]" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{{ CHANNEL[o.channel] }}</span></span>
            <span class="block text-xs text-stone-500">{{ o.channel === 'pos' ? dateTime(o.createdAt) : `นัดรับ ${dateTime(o.pickupAt)}` }}</span>
          </span>
          <span class="shrink-0 text-right"><StatusBadge :status="o.status" /><span class="mt-1 block text-sm font-semibold text-stone-900">{{ money(o.total) }}</span></span>
        </summary>
        <div class="space-y-3 border-t border-stone-100 px-4 py-3 text-sm">
          <ul class="space-y-2">
            <li v-for="it in o.items" :key="it.id">
              <div class="flex justify-between gap-3"><span class="font-medium text-stone-800">{{ it.name }} × {{ it.qty }}</span><span class="shrink-0">{{ money(it.unitPrice * it.qty) }}</span></div>
              <div v-for="(d, i) in describeSelections(it, db.optionGroups)" :key="i" class="text-xs text-stone-500">{{ d.group }}: {{ d.value }}</div>
              <div v-if="it.note" class="text-xs text-stone-500">หมายเหตุ: {{ it.note }}</div>
            </li>
          </ul>
          <div v-if="o.fulfillment === 'delivery' && o.address" class="text-xs text-stone-500">จัดส่ง: {{ o.address }}</div>
          <div class="space-y-1 rounded-xl bg-stone-50 p-3">
            <div class="flex justify-between"><span>ยอดรวม</span><b>{{ money(o.total) }}</b></div>
            <div class="flex justify-between"><span>ชำระแล้ว</span><span>{{ money(o.paid) }}</span></div>
            <div v-if="o.status !== 'cancelled'" class="flex justify-between" :class="o.balance > 0 ? 'text-amber-700' : 'text-emerald-700'"><span>คงค้าง</span><b>{{ money(o.balance) }}</b></div>
            <div v-for="(p, i) in o.payments" :key="i" class="flex justify-between text-xs text-stone-500"><span>{{ p.method }} · {{ dateOnly(p.paidAt) }}</span><span>{{ money(p.amount) }}</span></div>
          </div>
          <div v-if="o.status === 'delivered'">
            <p v-if="o.review" class="text-xs text-stone-500">รีวิวของคุณ: {{ '★'.repeat(o.review.rating) }} · {{ REVIEW[o.review.status] }}</p>
            <button v-else class="btn-soft h-9" @click="openReview(o)"><AppIcon name="star" :size="16" /> เขียนรีวิว</button>
          </div>
        </div>
      </details>
    </div>

    <!-- คะแนน / แลกของ / กาชา / คูปอง -->
    <AccountRewards v-else-if="tab === 'rewards'" />

    <!-- ความปลอดภัย -->
    <div v-else class="space-y-4">
      <section class="card space-y-3">
        <div class="card-title"><AppIcon name="lock" :size="16" /> PIN</div>
        <p class="text-sm text-stone-600">เปลี่ยน PIN ต้องยืนยัน OTP ที่เบอร์ {{ formatPhone(me.phone) }} ก่อน</p>
        <button class="btn-outline w-full" @click="start('pin')">เปลี่ยน PIN</button>
      </section>

      <section class="card space-y-3">
        <div class="card-title"><AppIcon name="shield" :size="16" /> ขอลบข้อมูลของฉัน</div>
        <p class="text-sm text-stone-600">เมื่อร้านอนุมัติ ร้านจะลบชื่อ เบอร์โทร LINE/Facebook ที่ผูกไว้ บัญชีและ PIN แชท คะแนน/คูปอง รีวิว และรายละเอียดส่วนตัวในออร์เดอร์ (ที่อยู่ วันเกิด รูปอ้างอิง สลิป ข้อความบนเค้ก)</p>
        <p class="text-sm text-stone-600">ร้านจะเก็บ <b>ออร์เดอร์และการชำระเงินแบบไม่ระบุตัวตน</b> เพื่อเป็นหลักฐานทางบัญชี · ลบได้เมื่อไม่มีออร์เดอร์ที่ยังไม่จบหรือยอดค้างชำระ</p>
        <div v-if="delReq?.status === 'pending'" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ส่งคำขอเมื่อ {{ dateTime(delReq.createdAt) }} · รอร้านตรวจสอบ</div>
        <div v-else-if="delReq?.status === 'rejected'" class="rounded-xl bg-rose-50 p-3 text-sm text-rose-700">คำขอก่อนหน้าไม่ได้รับอนุมัติ: {{ delReq.reason }}</div>
        <button v-if="delReq?.status !== 'pending'" class="btn-danger w-full" @click="start('delete')">ขอลบข้อมูลของฉัน</button>
      </section>
    </div>
  </div>

  <!-- เขียนรีวิว -->
  <AppModal v-if="rv.order" :title="`รีวิว ${rv.order.code}`" @close="rv.order = null">
    <div class="space-y-3">
      <div class="flex gap-1" role="radiogroup" aria-label="ให้คะแนน">
        <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rv.rating === n" class="text-3xl leading-none" :class="n <= rv.rating ? 'text-amber-500' : 'text-stone-300'" :aria-label="`${n} ดาว`" @click="rv.rating = n">★</button>
      </div>
      <textarea v-model="rv.text" rows="4" maxlength="500" class="input" placeholder="เล่าให้ฟังหน่อยว่าเป็นอย่างไรบ้าง"></textarea>
      <p class="text-xs text-stone-400">จะแสดงบนหน้าร้านหลังร้านตรวจสอบ โดยใช้ชื่อต้นของคุณเท่านั้น</p>
      <p v-if="rv.error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ rv.error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="rv.order = null">ยกเลิก</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="sendReview">ส่งรีวิว</button>
    </template>
  </AppModal>

  <!-- ขั้นตอนยืนยัน OTP -->
  <AppModal v-if="flow" :title="{ pin: 'เปลี่ยน PIN', phone: 'เปลี่ยนเบอร์โทร', delete: 'ขอลบข้อมูล' }[flow]" @close="close">
    <div v-if="flow === 'phone' && step === 1" class="space-y-4">
      <div><label class="label">เบอร์ใหม่</label><PhoneInput v-model="f.phone" /></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="newPhoneNext">ขอรหัสยืนยัน (OTP)</button>
    </div>

    <OtpStep v-else-if="step === 2" :phone="flow === 'phone' ? phoneDigits(f.phone) : ''" :purpose="{ pin: 'change_pin', phone: 'change_phone', delete: 'delete' }[flow]" @verified="verified" @cancel="flow === 'phone' ? (step = 1) : close()" />

    <div v-else-if="flow === 'pin'" class="space-y-4">
      <div><label class="label">PIN ใหม่ 6 หลัก</label><PinInput v-model="f.pin" autocomplete="new-password" /></div>
      <div><label class="label">ยืนยัน PIN ใหม่</label><PinInput v-model="f.pin2" autocomplete="new-password" /></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="finishPin">เปลี่ยน PIN</button>
    </div>

    <div v-else-if="flow === 'phone'" class="space-y-4">
      <p class="text-sm text-stone-600">ยืนยันแล้ว เปลี่ยนเบอร์เป็น <b>{{ formatPhone(f.phone) }}</b></p>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-primary w-full" @click="finishPhone">ยืนยันการเปลี่ยนเบอร์</button>
    </div>

    <div v-else class="space-y-4">
      <p class="text-sm text-stone-600">ส่งคำขอให้ร้านตรวจสอบ ระหว่างนี้บัญชียังใช้งานได้ตามปกติ</p>
      <div><label class="label">หมายเหตุถึงร้าน (ไม่บังคับ)</label><textarea v-model="f.note" rows="3" maxlength="300" class="input"></textarea></div>
      <p v-if="f.error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ f.error }}</p>
      <button class="btn-danger w-full" @click="finishDelete">ส่งคำขอลบข้อมูล</button>
    </div>
  </AppModal>
</template>
