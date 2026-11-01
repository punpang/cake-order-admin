<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findCustomer, saveReward, savePrize, saveLoyaltySettings, markCouponDelivered } from '../../data/store'
import { couponUsable, chanceTotal } from '../../lib/loyalty'
import { money, dateOnly, toDateStr } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const tab = ref('settings')
const tabs = [
  { v: 'settings', l: 'ตั้งค่า' },
  { v: 'rewards', l: 'ของแลก' },
  { v: 'gacha', l: 'กาชา' },
  { v: 'coupons', l: 'มอบของ' },
]
const today = toDateStr(new Date())

// ---------- ตั้งค่า ----------
const st = reactive({ ...db.loyalty })
const saved = ref(false)
function saveSettings() {
  saveLoyaltySettings(st)
  Object.assign(st, db.loyalty)
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
const FIELDS = [
  { k: 'earnPer', l: 'ทุกกี่บาท ได้ 1 คะแนน (ตอนส่งมอบ)', u: 'บาท' },
  { k: 'pointValue', l: '1 คะแนน ใช้ลดได้', u: 'บาท' },
  { k: 'pointExpireDays', l: 'คะแนนหมดอายุหลังได้รับ', u: 'วัน' },
  { k: 'couponExpireDays', l: 'คูปองหมดอายุหลังได้รับ', u: 'วัน' },
  { k: 'spinPer', l: 'ทุกกี่บาท ได้สิทธิ์หมุน 1 ครั้ง (ตอนส่งมอบ)', u: 'บาท' },
  { k: 'spinCost', l: 'หมุน 1 ครั้งด้วยคะแนน ใช้', u: 'คะแนน' },
]

// ---------- ของแลก ----------
const rwOpen = ref(false)
const rw = reactive({ id: null, name: '', points: 0, active: true })
const rwError = ref('')
function editRw(r) {
  Object.assign(rw, r ? { ...r } : { id: null, name: '', points: 0, active: true })
  rwError.value = ''
  rwOpen.value = true
}
function saveRw() {
  if (!rw.name.trim()) return (rwError.value = 'กรอกชื่อของ')
  if (!(rw.points > 0)) return (rwError.value = 'คะแนนต้องมากกว่า 0')
  saveReward({ ...rw })
  rwOpen.value = false
}

// ---------- กาชา ----------
const PRIZE_TYPES = { points: 'คะแนน', reward: 'ของรางวัล', discount: 'ส่วนลด (บาท)', none: 'ไม่ได้รางวัล' }
const total = computed(() => chanceTotal(db.gachaPrizes))
const gpOpen = ref(false)
const gp = reactive({ id: null, name: '', type: 'points', value: 0, rewardId: '', chance: 0, active: true })
const gpError = ref('')
function editGp(p) {
  Object.assign(gp, { id: null, name: '', type: 'points', value: 0, rewardId: '', chance: 0, active: true }, p || {})
  gpError.value = ''
  gpOpen.value = true
}
function saveGp() {
  if (!gp.name.trim()) return (gpError.value = 'กรอกชื่อรางวัล')
  if (['points', 'discount'].includes(gp.type) && !(gp.value > 0)) return (gpError.value = 'ใส่จำนวน')
  if (gp.type === 'reward' && !gp.rewardId) return (gpError.value = 'เลือกของรางวัล')
  if (!(gp.chance >= 0)) return (gpError.value = 'โอกาสไม่ถูกต้อง')
  savePrize({ ...gp })
  gpOpen.value = false
}
const prizeDesc = (p) =>
  p.type === 'points' ? `${p.value} คะแนน`
    : p.type === 'discount' ? `ส่วนลด ${money(p.value)}`
      : p.type === 'reward' ? (db.rewards.find((r) => r.id === p.rewardId)?.name || '-')
        : 'ไม่ได้รางวัล'

// ---------- มอบของ ----------
const q = ref('')
const showAll = ref(false)
const rewardCoupons = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.coupons
    .filter((c) => c.type === 'reward')
    .filter((c) => showAll.value || couponUsable(c, today))
    .filter((c) => !s || (findCustomer(c.customerId)?.name || '').toLowerCase().includes(s) || c.name.toLowerCase().includes(s))
})
const couponState = (c) =>
  c.status === 'delivered' ? 'มอบแล้ว' : !couponUsable(c, today) ? 'หมดอายุ' : 'รอรับ'
</script>

<template>
  <ManageShell title="คะแนน & รางวัล" :toolbar="false">
    <div class="mb-4 grid grid-cols-4 gap-1 rounded-2xl bg-stone-100 p-1">
      <button
        v-for="t in tabs"
        :key="t.v"
        type="button"
        class="h-10 rounded-xl text-sm font-semibold transition"
        :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
        @click="tab = t.v"
      >{{ t.l }}</button>
    </div>

    <!-- ตั้งค่า -->
    <section v-if="tab === 'settings'" class="card space-y-4">
      <div v-for="f in FIELDS" :key="f.k">
        <label class="label">{{ f.l }}</label>
        <div class="flex items-center gap-2">
          <input v-model.number="st[f.k]" type="number" inputmode="decimal" min="0" class="input" />
          <span class="w-14 shrink-0 text-sm text-stone-500">{{ f.u }}</span>
        </div>
      </div>
      <button class="btn-primary w-full" @click="saveSettings"><AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึก' }}</button>
    </section>

    <!-- ของแลก -->
    <template v-else-if="tab === 'rewards'">
      <button class="btn-primary mb-3 w-full sm:w-auto" @click="editRw(null)"><AppIcon name="plus" /> เพิ่มของแลก</button>
      <p v-if="!db.rewards.length" class="card py-10 text-center text-stone-500">ยังไม่มีของแลก</p>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          v-for="r in db.rewards"
          :key="r.id"
          class="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand-300"
          :class="r.active === false ? 'opacity-60' : ''"
          @click="editRw(r)"
        >
          <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ r.name }}</span>
          <span class="shrink-0 text-sm font-semibold text-stone-700">{{ r.points }} คะแนน</span>
        </button>
      </div>
    </template>

    <!-- กาชา -->
    <template v-else-if="tab === 'gacha'">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <button class="btn-primary" @click="editGp(null)"><AppIcon name="plus" /> เพิ่มรางวัล</button>
        <span class="rounded-full px-3 py-1 text-sm font-medium" :class="total === 100 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-600'">
          รวม {{ total }}% {{ total === 100 ? '' : '(ต้องเท่ากับ 100% จึงหมุนได้)' }}
        </span>
      </div>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <button
          v-for="p in db.gachaPrizes"
          :key="p.id"
          class="card flex items-center gap-3 p-3.5 text-left transition hover:border-brand-300"
          :class="p.active === false ? 'opacity-60' : ''"
          @click="editGp(p)"
        >
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ p.name }}</span>
            <span class="block text-xs text-stone-500">{{ prizeDesc(p) }}</span>
          </span>
          <span class="shrink-0 text-sm font-semibold text-stone-700">{{ p.chance }}%</span>
        </button>
      </div>
    </template>

    <!-- มอบของ -->
    <template v-else>
      <div class="card mb-3 flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
        <input v-model="q" class="input min-w-0 flex-1" placeholder="ค้นหาชื่อลูกค้า / ของ" />
        <AppSwitch v-model="showAll" label="แสดงที่มอบแล้ว/หมดอายุ" class="shrink-0 px-1" />
      </div>
      <p v-if="!rewardCoupons.length" class="card py-10 text-center text-stone-500">ไม่มีของรอมอบ</p>
      <div class="space-y-2.5">
        <div v-for="c in rewardCoupons" :key="c.id" class="card flex items-center gap-3 p-3.5">
          <span class="min-w-0 flex-1">
            <span class="block font-medium break-words text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">
              {{ findCustomer(c.customerId)?.name }} · {{ c.source === 'gacha' ? 'กาชา' : 'แลกคะแนน' }}
              <template v-if="c.expiresAt"> · หมดอายุ {{ dateOnly(c.expiresAt) }}</template>
            </span>
          </span>
          <button v-if="couponState(c) === 'รอรับ'" class="btn-primary h-9 shrink-0 px-3" @click="markCouponDelivered(c)"><AppIcon name="check" :size="16" /> มอบแล้ว</button>
          <span v-else class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">{{ couponState(c) }}</span>
        </div>
      </div>
    </template>

    <!-- modal ของแลก -->
    <AppModal v-if="rwOpen" :title="rw.id ? 'แก้ไขของแลก' : 'เพิ่มของแลก'" @close="rwOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อของ <span class="text-rose-500">*</span></label><input v-model="rw.name" class="input" /></div>
        <div><label class="label">ใช้คะแนน</label><input v-model.number="rw.points" type="number" inputmode="numeric" min="1" class="input" /></div>
        <AppSwitch v-model="rw.active" label="ใช้งาน (แสดงให้ลูกค้าแลก)" class="flex" />
        <p v-if="rwError" class="text-sm text-rose-600">{{ rwError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rwOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveRw">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal รางวัลกาชา -->
    <AppModal v-if="gpOpen" :title="gp.id ? 'แก้ไขรางวัล' : 'เพิ่มรางวัล'" @close="gpOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อรางวัล (แสดงบนวงล้อ) <span class="text-rose-500">*</span></label><input v-model="gp.name" class="input" /></div>
        <div>
          <div class="label">ประเภท</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="(l, k) in PRIZE_TYPES" :key="k" type="button" class="chip" :class="gp.type === k ? 'chip-on' : 'chip-off'" @click="gp.type = k">{{ l }}</button>
          </div>
        </div>
        <div v-if="gp.type === 'points' || gp.type === 'discount'">
          <label class="label">{{ gp.type === 'points' ? 'จำนวนคะแนน' : 'ส่วนลด (บาท)' }}</label>
          <input v-model.number="gp.value" type="number" inputmode="numeric" min="1" class="input" />
        </div>
        <div v-if="gp.type === 'reward'">
          <label class="label">ของรางวัล</label>
          <select v-model="gp.rewardId" class="input">
            <option value="" disabled>เลือกของ</option>
            <option v-for="r in db.rewards" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
        <div><label class="label">โอกาส (%)</label><input v-model.number="gp.chance" type="number" inputmode="decimal" min="0" max="100" step="any" class="input" /></div>
        <AppSwitch v-model="gp.active" label="ใช้งาน" class="flex" />
        <p v-if="gpError" class="text-sm text-rose-600">{{ gpError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="gpOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveGp">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
