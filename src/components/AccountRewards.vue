<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { db, customerPoints, customerCoupons, redeemReward, spinGacha, redeemRewardRemote, spinGachaRemote, usesServerLoyalty, myCustomer, activateCouponAtStore, phaseOfCoupon, sweepCoupons } from '../data/store'
import { pointsCouponQuote, POINTS_COUPON, POINTS_COUPON_MSG } from '../lib/pointsCoupon'
import { makeCouponRemote, makePointsCouponLocal } from '../lib/pointsCouponActions'
import { expiringSoon, chanceTotal, activeSecondsLeft } from '../lib/loyalty'
import { money, dateOnly, dateTime, toDateStr, num } from '../lib/format'
import AppIcon from './AppIcon.vue'
import AppModal from './AppModal.vue'
import CouponBarcode from './CouponBarcode.vue'
import { askConfirm } from '../lib/confirm'
import { couponTermsText } from '../lib/coupons'
import { isSampleName, pointsShortfall } from '../lib/accountView'
import { tierLines } from '../lib/memberLevels'
import { birthEligibleDate, setBirthRemote, clearBirthRemote, setSmsRemote } from '../lib/birthdayRemote'
import { MONTHS } from '../lib/birthday'

// คะแนน / แลกของ / กาชา / คูปอง ของลูกค้าที่ล็อกอินอยู่ (ย้ายมาจากหน้าลูกค้าจำลองเดิม) ใช้ได้เฉพาะของตัวเอง
const me = computed(() => myCustomer())
const today = toDateStr(new Date())
const points = computed(() => customerPoints(me.value))
const soon = computed(() => expiringSoon(me.value?.ledger, today, 30))
const tierCard = computed(() => (db.memberCard?.enabled ? tierLines(db.memberCard) : []))

// ---------- เดือนเกิดสมาชิก (ยินยอมแยกต่างหาก · ใช้สิทธิได้หลังกรอกครบ 30 วัน) ----------
const birthMonth = ref(me.value?.birth?.month ? String(me.value.birth.month) : '')
const birthConsent = ref(false)
const birthBusy = ref(false)
const birthEligible = computed(() => birthEligibleDate(me.value?.birth))
const birthDateTxt = computed(() => (birthEligible.value ? dateOnly(birthEligible.value.toISOString()) : ''))
async function saveBirth() {
  if (!birthMonth.value || !birthConsent.value || birthBusy.value) return
  birthBusy.value = true
  const r = await setBirthRemote(birthMonth.value, birthConsent.value)
  birthBusy.value = false
  msg.value = r.error ? r.error : 'บันทึกเดือนเกิดแล้ว สิทธิในเดือนเกิดใช้ได้หลังครบ 30 วัน'
  if (!r.error) birthConsent.value = false
}
const smsBusy = ref(false)
const smsOn = computed(() => me.value?.smsOptIn === true && !!me.value?.smsConsentAt)
async function toggleSms(v) {
  if (smsBusy.value) return
  smsBusy.value = true
  const r = await setSmsRemote(v)
  smsBusy.value = false
  msg.value = r.error ? r.error : v ? 'เปิดรับ SMS แจ้งสิทธิ์สมาชิกแล้ว' : 'ปิดรับ SMS แจ้งสิทธิ์สมาชิกแล้ว'
}
async function removeBirth() {
  birthBusy.value = true
  const r = await clearBirthRemote()
  birthBusy.value = false
  msg.value = r.error ? r.error : 'ถอนเดือนเกิดและความยินยอมแล้ว'
  if (!r.error) birthMonth.value = ''
}

const tab = ref('rewards')
const tabs = [
  { v: 'rewards', l: 'แลกของ' },
  { v: 'gacha', l: 'หมุนกาชา' },
  { v: 'coupons', l: 'คูปอง' },
  { v: 'history', l: 'ประวัติ' },
]

// ---------- แลกของ ----------
const rewards = computed(() => db.rewards.filter((r) => r.active !== false && !isSampleName(r.name)))
const confirmRw = ref(null)
const msg = ref('')
async function redeem() {
  const id = confirmRw.value.id
  confirmRw.value = null
  if (usesServerLoyalty()) {
    // บัญชีบนเซิร์ฟเวอร์: แลกทำที่ฐานข้อมูล (กันแลกซ้ำจากสองเครื่อง) แล้วรีเฟรชคะแนน/คูปอง
    const r = await redeemRewardRemote(id)
    msg.value = r.error ? r.error : `แลก ${r.coupon?.name || 'ของรางวัล'} แล้ว รับได้ที่ร้าน (ดูในแท็บคูปอง)`
    return
  }
  const cp = redeemReward(me.value, id)
  msg.value = cp ? `แลก ${cp.name} แล้ว รับได้ที่ร้าน (ดูในแท็บคูปอง)` : 'คะแนนไม่พอ'
}

// ---------- สร้างคูปองจากคะแนน (ลูกค้าเลือกมูลค่าเอง ขั้นต่ำ 10 บาท ทวีคูณ 10) ----------
const couponAmt = ref(POINTS_COUPON.min)
const amtQuote = computed(() => pointsCouponQuote(couponAmt.value, db.loyalty.pointValue, points.value))
async function makeCoupon() {
  if (!amtQuote.value.ok) return
  const amt = Number(couponAmt.value)
  const r = usesServerLoyalty() ? await makeCouponRemote(amt) : makePointsCouponLocal(me.value, amt)
  msg.value = r.error ? (POINTS_COUPON_MSG[r.error] || r.error) : `สร้างคูปอง ${money(amt)} แล้ว ใช้ได้ภายใน ${POINTS_COUPON.days} วัน (ดูในแท็บคูปอง)`
}

// ---------- กาชา ----------
const prizes = computed(() => db.gachaPrizes.filter((p) => p.active !== false && p.chance > 0))
const ready = computed(() => chanceTotal(db.gachaPrizes) === 100)
const COLORS = ['#ffe0e7', '#ffd9b8', '#fff0c2', '#cdebd8', '#ffc2d0', '#ffd05c']
const wheelBg = computed(() => {
  let acc = 0
  const parts = prizes.value.map((p, i) => {
    const from = acc
    acc += (p.chance / 100) * 360
    return `${COLORS[i % COLORS.length]} ${from}deg ${acc}deg`
  })
  return `conic-gradient(${parts.join(', ')})`
})
const labels = computed(() => {
  let acc = 0
  return prizes.value.map((p) => {
    const mid = acc + ((p.chance / 100) * 360) / 2
    acc += (p.chance / 100) * 360
    return { id: p.id, name: p.name, angle: mid }
  })
})
const rotation = ref(0)
const spinning = ref(false)
const result = ref(null)
async function spin(usePoints) {
  if (spinning.value) return
  if (usePoints && !(await askConfirm({ title: 'หมุนกาชา', message: `ใช้ ${db.loyalty.spinCost} คะแนน`, okText: 'หมุนเลย' }))) return
  let prize
  if (usesServerLoyalty()) {
    // บัญชีบนเซิร์ฟเวอร์: สุ่มรางวัลและตัดคะแนน/สิทธิ์ที่ฐานข้อมูล
    const r = await spinGachaRemote(usePoints)
    if (r.error) return (msg.value = r.error)
    prize = r.prize
  } else {
    prize = spinGacha(me.value, usePoints)
    if (!prize) return (msg.value = usePoints ? 'คะแนนไม่พอ' : 'ไม่มีสิทธิ์หมุน')
  }
  if (!prize) return (msg.value = 'ยังไม่มีรางวัลกาชาที่เปิดใช้')
  const l = labels.value.find((x) => x.id === prize.id)
  // ให้ช่องของรางวัลมาอยู่ใต้เข็มด้านบน
  const target = 360 - (l ? l.angle : 0)
  const base = rotation.value - (rotation.value % 360)
  rotation.value = base + 360 * 5 + target
  spinning.value = true
  result.value = null
  setTimeout(() => {
    spinning.value = false
    result.value = prize
  }, 3200)
}

// ---------- คูปอง / ประวัติ ----------
const coupons = computed(() => customerCoupons(me.value))
// เวลาเดินทุกวินาที (นับถอยหลังตอนแสดงที่ร้าน)
const nowTick = ref(Date.now())
let timer = null
onMounted(() => { timer = setInterval(() => { nowTick.value = Date.now(); sweepCoupons() }, 1000) })
onBeforeUnmount(() => clearInterval(timer))
const phase = (c) => phaseOfCoupon(c, new Date(nowTick.value).toISOString())
const left = (c) => { const s = activeSecondsLeft(c, nowTick.value); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` }
// กด "ใช้ที่ร้านตอนนี้": พนักงานจะเห็นบน POS ภายในเวลาที่ร้านตั้ง · ครบเวลา = ถือว่าใช้แล้ว · ยกเลิกไม่ได้
const useMsg = ref('')
const useErr = ref('')
async function useAtStore(c) {
  useMsg.value = useErr.value = ''
  const min = db.loyalty.activationMin || 15
  if (!(await askConfirm({ title: 'ใช้ที่ร้านตอนนี้', message: `${c.name}\nต้องอยู่ที่ร้านตอนนี้ พนักงานจะเห็นบนเครื่อง POS เป็นเวลา ${min} นาที ครบเวลาแล้วถือว่าใช้ไปแล้ว ใช้ซ้ำไม่ได้ และยกเลิกไม่ได้`, okText: 'ใช้ที่ร้านตอนนี้' }))) return
  const r = activateCouponAtStore(c.id)
  if (r.error) useErr.value = r.error
  else useMsg.value = `แสดงที่ร้านแล้ว ภายใน ${r.minutes} นาที แจ้งพนักงานได้เลย`
}
const couponState = (c) => {
  const ph = phase(c)
  if (ph === 'used') return { t: 'ใช้แล้ว', cls: 'bg-stone-100 text-stone-500' }
  if (ph === 'delivered') return { t: 'รับแล้ว', cls: 'bg-stone-100 text-stone-500' }
  if (ph === 'lapsed') return { t: 'หมดเวลา (ถือว่าใช้แล้ว)', cls: 'bg-stone-100 text-stone-500' }
  if (ph === 'refunded') return { t: 'ร้านคืนคะแนนแล้ว', cls: 'bg-stone-100 text-stone-500' }
  if (ph === 'expired') return { t: 'หมดอายุ', cls: 'bg-danger-50 text-danger-700' }
  if (ph === 'active') return { t: `แสดงที่ร้านอยู่ ${left(c)}`, cls: 'bg-brand-50 text-brand-800' }
  return c.type === 'reward' ? { t: 'รอรับที่ร้าน', cls: 'bg-warning-50 text-warning-700' } : { t: 'ใช้ได้', cls: 'bg-success-50 text-success-700' }
}
const history = computed(() => (me.value?.ledger || []).slice().reverse())
</script>

<template>
  <div>
    <template v-if="me">
      <!-- คะแนน -->
      <section class="mb-4 rounded-[2rem] bg-linear-to-br from-hero-1 via-hero-2 to-hero-3 p-5 text-white shadow-lg">
        <div class="mt-2 flex items-end gap-2">
          <span class="font-display text-4xl">{{ num(points) }}</span>
          <span class="pb-1 text-sm">คะแนน</span>
        </div>
        <div v-if="soon" class="mt-1 text-xs">{{ soon.points }} คะแนนจะหมดอายุ {{ dateOnly(soon.date) }}</div>
        <div class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm">สิทธิ์หมุนกาชา {{ me.spins }} ครั้ง</div>
      </section>
      <!-- ระดับสมาชิก (เซิร์ฟเวอร์ส่งให้เฉพาะโหมดใช้จริง · ไม่มียอดสะสม) -->
      <section v-if="tierCard.length" class="mb-4 rounded-[2rem] bg-white p-5 shadow ring-1 ring-stone-200" aria-label="ระดับสมาชิก">
        <div class="font-semibold text-stone-800">{{ tierCard[0] }}</div>
        <div v-for="(l, i) in tierCard.slice(1)" :key="i" class="mt-1 text-sm text-stone-600">{{ l }}</div>
      </section>

      <section v-if="tierCard.length && usesServerLoyalty()" class="card mb-4 space-y-3" aria-label="วันเกิดสมาชิก">
        <p class="font-semibold text-stone-900">เดือนเกิดของคุณ</p>
        <p class="text-sm text-stone-500">ใช้คำนวณสิทธิในเดือนเกิด (ตัวคูณแต้ม คูปองส่วนลด และส่วนลดหมวดเค้กที่ร้านกำหนด) ร้านไม่เก็บวันเกิดเต็มหรือปีเกิด</p>
        <p v-if="me.birth?.month" class="text-sm text-stone-700">
          ตอนนี้ตั้งเป็นเดือน {{ MONTHS[Number(me.birth.month) - 1] }}<template v-if="birthDateTxt"> · ใช้สิทธิได้ตั้งแต่ {{ birthDateTxt }}</template>
        </p>
        <div class="flex flex-wrap items-center gap-2">
          <select v-model="birthMonth" class="input h-11 w-40" aria-label="เดือนเกิด">
            <option value="">เลือกเดือน</option>
            <option v-for="(m, i) in MONTHS" :key="m" :value="String(i + 1)">{{ m }}</option>
          </select>
        </div>
        <label class="flex items-start gap-2 text-sm text-stone-700">
          <input v-model="birthConsent" type="checkbox" class="mt-1 h-4 w-4" />
          <span>ยินยอมให้ร้านเก็บเดือนเกิดของฉันเพื่อใช้สิทธิในเดือนเกิด (ดูประกาศความเป็นส่วนตัวข้อ 2)</span>
        </label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="btn-primary h-11 px-4" :disabled="!birthMonth || !birthConsent || birthBusy" :class="!birthMonth || !birthConsent ? 'opacity-40' : ''" @click="saveBirth">บันทึกเดือนเกิด</button>
          <button v-if="me.birth?.month" type="button" class="btn-outline h-11 px-4" :disabled="birthBusy" @click="removeBirth">ถอนเดือนเกิด</button>
        </div>
      </section>

      <section v-if="me && usesServerLoyalty()" class="card mb-4 space-y-2" aria-label="SMS แจ้งสิทธิ์สมาชิก">
        <label class="flex items-start gap-2 text-sm text-stone-700">
          <input type="checkbox" class="mt-1 h-4 w-4" :checked="smsOn" :disabled="smsBusy" @change="toggleSms($event.target.checked)" />
          <span>รับ SMS เมื่อเลื่อนระดับ ได้รับโบนัสคะแนน หรือได้คูปองวันเกิด (แยกจากข่าวโปรโมชัน ปิดได้ทุกเมื่อ)</span>
        </label>
      </section>

      <!-- แท็บย่อยของคะแนน: ตัวหนังสือมีเส้นใต้ เพื่อให้ต่างจากแท็บหลักที่เป็นปุ่ม -->
      <div class="mb-4 flex gap-5 overflow-x-auto border-b border-stone-200 [scrollbar-width:none]" aria-label="เมนูคะแนน">
        <button
          v-for="t in tabs"
          :key="t.v"
          type="button"
          :aria-current="tab === t.v ? 'true' : undefined"
          class="-mb-px min-h-11 shrink-0 border-b-2 px-1 text-sm font-medium transition"
          :class="tab === t.v ? 'border-brand-600 text-brand-800' : 'border-transparent text-stone-500 hover:text-stone-800'"
          @click="tab = t.v; msg = ''"
        >{{ t.l }}</button>
      </div>

      <p v-if="msg" class="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{{ msg }}</p>

      <!-- แลกของ -->
      <div v-if="tab === 'rewards'" class="space-y-2.5">
        <div class="card space-y-3">
          <p class="font-semibold text-stone-900">สร้างคูปองจากคะแนน</p>
          <p class="text-sm text-stone-500">ขั้นต่ำ {{ POINTS_COUPON.min }} บาท เป็นทวีคูณของ {{ POINTS_COUPON.step }} · ใช้ได้ครั้งเดียว · หมดอายุใน {{ POINTS_COUPON.days }} วัน</p>
          <div class="flex flex-wrap items-center gap-2">
            <button v-for="v in [10, 20, 50, 100]" :key="v" type="button" class="btn-outline h-9 px-3" :class="Number(couponAmt) === v ? 'ring-2 ring-brand-400' : ''" @click="couponAmt = v">{{ v }} บาท</button>
            <input v-model.number="couponAmt" type="number" :min="POINTS_COUPON.min" :step="POINTS_COUPON.step" inputmode="numeric" class="input h-9 w-28" aria-label="มูลค่าคูปอง (บาท)" />
          </div>
          <p class="text-sm" :class="amtQuote.ok ? 'text-stone-600' : 'text-danger-700'" aria-live="polite">{{ amtQuote.ok ? `ใช้ ${num(amtQuote.points)} คะแนน` : POINTS_COUPON_MSG[amtQuote.reason] }}</p>
          <button type="button" class="btn-primary h-11 w-full" :disabled="!amtQuote.ok" :class="!amtQuote.ok ? 'opacity-40' : ''" @click="makeCoupon">สร้างคูปอง {{ money(Number(couponAmt) || 0) }}</button>
        </div>
        <p v-if="!rewards.length" class="card py-10 text-center text-stone-500">ยังไม่มีของให้แลก</p>
        <div v-for="r in rewards" :key="r.id" class="card flex items-center gap-3">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="cake" :size="24" /></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-stone-900">{{ r.name }}</span>
            <span class="block text-sm text-stone-500">{{ num(r.points) }} คะแนน<template v-if="r.kind === 'coupon'"> · {{ couponTermsText(r) }} ใช้ที่หน้าร้านหรือในออร์เดอร์</template></span>
            <span v-if="pointsShortfall(points, r.points)" class="block text-xs font-medium text-warning-700">ขาดอีก {{ num(pointsShortfall(points, r.points)) }} คะแนน</span>
          </span>
          <button class="btn-primary h-9 px-4" :disabled="points < r.points" :class="points < r.points ? 'opacity-40' : ''" @click="confirmRw = r">แลก</button>
        </div>
      </div>

      <!-- กาชา -->
      <div v-else-if="tab === 'gacha'" class="card flex flex-col items-center gap-4 py-6">
        <p v-if="!ready" class="text-sm text-stone-500">ยังไม่เปิดให้หมุน</p>
        <template v-else>
          <div class="relative h-64 w-64">
            <div class="absolute -top-1 left-1/2 z-10 h-0 w-0 -translate-x-1/2 border-x-[10px] border-t-[18px] border-x-transparent border-t-brand-800"></div>
            <div
              class="relative h-full w-full rounded-full border-4 border-white shadow-lg"
              :style="{ background: wheelBg, transform: `rotate(${rotation}deg)`, transition: spinning ? 'transform 3s cubic-bezier(0.17, 0.67, 0.12, 1)' : 'none' }"
            >
              <span
                v-for="l in labels"
                :key="l.id"
                class="absolute top-1/2 left-1/2 w-24 origin-left -translate-y-1/2 pl-8 text-xs font-semibold text-stone-800"
                :style="{ transform: `rotate(${l.angle - 90}deg)` }"
              >{{ l.name }}</span>
            </div>
            <div class="absolute top-1/2 left-1/2 h-10 w-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"></div>
          </div>

          <div v-if="result" class="rounded-xl bg-brand-50 px-4 py-2 text-center font-semibold text-brand-800">
            {{ result.type === 'none' ? 'เสียใจด้วย ลองใหม่นะ' : `ได้ ${result.name}` }}
          </div>

          <div class="grid w-full grid-cols-2 gap-2">
            <button class="btn-primary" :disabled="spinning || me.spins < 1" :class="me.spins < 1 ? 'opacity-40' : ''" @click="spin(false)">ใช้สิทธิ์หมุน ({{ me.spins }})</button>
            <button class="btn-outline" :disabled="spinning || points < db.loyalty.spinCost" :class="points < db.loyalty.spinCost ? 'opacity-40' : ''" @click="spin(true)">ใช้ {{ db.loyalty.spinCost }} คะแนน</button>
          </div>
        </template>
      </div>

      <!-- คูปอง -->
      <div v-else-if="tab === 'coupons'" class="space-y-2.5">
        <p v-if="!coupons.length" class="card py-10 text-center text-stone-500">ยังไม่มีคูปอง</p>
        <p v-else class="rounded-xl bg-stone-50 p-3 text-xs text-stone-600" role="note">จะใช้คูปอง/รับของที่ร้าน ให้กด "ใช้ที่ร้านตอนนี้" เมื่ออยู่ที่ร้านแล้ว พนักงานจึงจะเห็นบนเครื่อง POS ({{ db.loyalty.activationMin || 15 }} นาที) · ครบเวลาถือว่าใช้ไปแล้ว ใช้ซ้ำและยกเลิกไม่ได้</p>
        <p v-if="useErr" class="text-sm text-danger-700" role="alert">{{ useErr }}</p>
        <p v-if="useMsg" class="rounded-xl bg-success-50 p-3 text-sm text-success-800" role="status">{{ useMsg }}</p>
        <template v-for="c in coupons" :key="c.id">
        <div class="card flex items-center gap-3">
          <span class="min-w-0 flex-1">
            <span class="block font-semibold break-words text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">
              {{ c.type === 'reward' ? 'ของรางวัล' : couponTermsText(c) }} · {{ c.source === 'gacha' ? 'จากกาชา' : c.source === 'lucky' ? 'จากลุ้นโชค' : c.source === 'refund' ? 'คืนเงิน' : c.source === 'convert' ? 'แปลงคะแนน' : c.source === 'points_coupon' ? 'สร้างเองจากคะแนน' : 'แลกคะแนน' }}
              <template v-if="c.expiresAt"> · หมดอายุ {{ dateOnly(c.expiresAt) }}</template>
            </span>
          </span>
          <span class="flex shrink-0 flex-col items-end gap-1.5"><span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="couponState(c).cls">{{ couponState(c).t }}</span><button v-if="phase(c) === 'pending'" type="button" class="btn-primary h-8 px-3 text-xs" @click="useAtStore(c)">ใช้ที่ร้านตอนนี้</button></span>
        </div>
        <CouponBarcode v-if="phase(c) === 'active'" :value="c.id" />
        </template>
      </div>

      <!-- ประวัติคะแนน -->
      <div v-else class="card divide-y divide-stone-100 p-0">
        <p v-if="!history.length" class="py-10 text-center text-stone-500">ยังไม่มีประวัติ</p>
        <div v-for="h in history" :key="h.id" class="flex items-center gap-3 px-4 py-3">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-stone-900">{{ h.reason }}</span>
            <span class="block text-xs text-stone-400">{{ dateTime(h.at) }}<template v-if="h.delta > 0 && h.expiresAt"> · หมดอายุ {{ dateOnly(h.expiresAt) }}</template></span>
          </span>
          <span class="shrink-0 font-semibold" :class="h.delta > 0 ? 'text-success-700' : 'text-danger-700'">{{ h.delta > 0 ? '+' : '' }}{{ h.delta }}</span>
        </div>
      </div>
    </template>

    <AppModal v-if="confirmRw" title="ยืนยันการแลก" @close="confirmRw = null">
      <p class="text-stone-700">แลก <b>{{ confirmRw.name }}</b> ใช้ {{ confirmRw.points }} คะแนน</p>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="confirmRw = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="redeem">แลกเลย</button>
      </template>
    </AppModal>
  </div>
</template>
