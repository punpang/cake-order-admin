<script setup>
import { computed, ref } from 'vue'
import { db, customerPoints, customerCoupons, redeemReward, spinGacha } from '../data/store'
import { expiringSoon, couponUsable, chanceTotal } from '../lib/loyalty'
import { money, dateOnly, dateTime, toDateStr, num } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import { askConfirm } from '../lib/confirm'

// หน้าลูกค้า (จำลอง): เลือกลูกค้าแทนการล็อกอิน จนกว่าจะต่อ Supabase
const customerId = ref(db.customers[0]?.id || '')
const me = computed(() => db.customers.find((c) => c.id === customerId.value))
const today = toDateStr(new Date())
const points = computed(() => customerPoints(me.value))
const soon = computed(() => expiringSoon(me.value?.ledger, today, 30))

const tab = ref('rewards')
const tabs = [
  { v: 'rewards', l: 'แลกของ' },
  { v: 'gacha', l: 'หมุนกาชา' },
  { v: 'coupons', l: 'คูปอง' },
  { v: 'history', l: 'ประวัติ' },
]

// ---------- แลกของ ----------
const rewards = computed(() => db.rewards.filter((r) => r.active !== false))
const confirmRw = ref(null)
const msg = ref('')
function redeem() {
  const cp = redeemReward(me.value, confirmRw.value.id)
  msg.value = cp ? `แลก ${cp.name} แล้ว รับได้ที่ร้าน (ดูในแท็บคูปอง)` : 'คะแนนไม่พอ'
  confirmRw.value = null
}

// ---------- กาชา ----------
const prizes = computed(() => db.gachaPrizes.filter((p) => p.active !== false && p.chance > 0))
const ready = computed(() => chanceTotal(db.gachaPrizes) === 100)
const COLORS = ['#e3efea', '#c5ddd3', '#f1f7f4', '#9cc3b3', '#eff1f0', '#6ba48e']
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
  const prize = spinGacha(me.value, usePoints)
  if (!prize) return (msg.value = usePoints ? 'คะแนนไม่พอ' : 'ไม่มีสิทธิ์หมุน')
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
const couponState = (c) => {
  if (c.status === 'used') return { t: 'ใช้แล้ว', cls: 'bg-stone-100 text-stone-500' }
  if (c.status === 'delivered') return { t: 'รับแล้ว', cls: 'bg-stone-100 text-stone-500' }
  if (!couponUsable(c, today)) return { t: 'หมดอายุ', cls: 'bg-rose-50 text-rose-600' }
  return c.type === 'reward' ? { t: 'รอรับที่ร้าน', cls: 'bg-amber-50 text-amber-700' } : { t: 'ใช้ได้', cls: 'bg-emerald-50 text-emerald-700' }
}
const history = computed(() => (me.value?.ledger || []).slice().reverse())
</script>

<template>
  <div class="mx-auto max-w-lg">
    <!-- เลือกลูกค้า (จำลองการล็อกอิน) -->
    <div class="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
      <AppIcon name="user" :size="16" />
      <span class="shrink-0">จำลองเป็น</span>
      <select v-model="customerId" class="input h-9 min-w-0 flex-1 py-0" @change="msg = ''; result = null">
        <option v-for="c in db.customers" :key="c.id" :value="c.id">{{ c.name }}</option>
      </select>
    </div>

    <template v-if="me">
      <!-- คะแนน -->
      <section class="mb-4 rounded-3xl bg-linear-to-br from-brand-600 to-brand-800 p-5 text-white">
        <div class="text-sm opacity-80">สวัสดี {{ me.name }}</div>
        <div class="mt-2 flex items-end gap-2">
          <span class="text-4xl font-semibold tracking-tight">{{ num(points) }}</span>
          <span class="pb-1 text-sm opacity-80">คะแนน</span>
        </div>
        <div v-if="soon" class="mt-1 text-xs opacity-80">{{ soon.points }} คะแนนจะหมดอายุ {{ dateOnly(soon.date) }}</div>
        <div class="mt-3 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-sm">สิทธิ์หมุนกาชา {{ me.spins }} ครั้ง</div>
      </section>

      <div class="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-stone-100 p-1">
        <button
          v-for="t in tabs"
          :key="t.v"
          type="button"
          class="h-10 rounded-xl text-sm font-semibold transition"
          :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
          @click="tab = t.v; msg = ''"
        >{{ t.l }}</button>
      </div>

      <p v-if="msg" class="mb-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-800">{{ msg }}</p>

      <!-- แลกของ -->
      <div v-if="tab === 'rewards'" class="space-y-2.5">
        <p v-if="!rewards.length" class="card py-10 text-center text-stone-500">ยังไม่มีของให้แลก</p>
        <div v-for="r in rewards" :key="r.id" class="card flex items-center gap-3">
          <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="cake" :size="24" /></span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-semibold text-stone-900">{{ r.name }}</span>
            <span class="block text-sm text-stone-500">{{ num(r.points) }} คะแนน</span>
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
                class="absolute top-1/2 left-1/2 w-24 origin-left -translate-y-1/2 pl-8 text-[11px] font-semibold text-stone-800"
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
        <div v-for="c in coupons" :key="c.id" class="card flex items-center gap-3">
          <span class="min-w-0 flex-1">
            <span class="block font-semibold break-words text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">
              {{ c.type === 'reward' ? 'ของรางวัล' : `ส่วนลด ${money(c.amount)}` }} · {{ c.source === 'gacha' ? 'จากกาชา' : 'แลกคะแนน' }}
              <template v-if="c.expiresAt"> · หมดอายุ {{ dateOnly(c.expiresAt) }}</template>
            </span>
          </span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="couponState(c).cls">{{ couponState(c).t }}</span>
        </div>
      </div>

      <!-- ประวัติคะแนน -->
      <div v-else class="card divide-y divide-stone-100 p-0">
        <p v-if="!history.length" class="py-10 text-center text-stone-500">ยังไม่มีประวัติ</p>
        <div v-for="h in history" :key="h.id" class="flex items-center gap-3 px-4 py-3">
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm text-stone-900">{{ h.reason }}</span>
            <span class="block text-xs text-stone-400">{{ dateTime(h.at) }}<template v-if="h.delta > 0 && h.expiresAt"> · หมดอายุ {{ dateOnly(h.expiresAt) }}</template></span>
          </span>
          <span class="shrink-0 font-semibold" :class="h.delta > 0 ? 'text-emerald-700' : 'text-rose-600'">{{ h.delta > 0 ? '+' : '' }}{{ h.delta }}</span>
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
