<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { computed, defineAsyncComponent, reactive, ref, watch } from 'vue'
import { db, can, findCustomer, saveReward, savePrize, saveLoyaltySettings, markCouponDelivered, phaseOfCoupon, refundCoupon } from '../../data/store'
import { chanceTotal } from '../../lib/loyalty'
import { COUPON_MODES, couponTermsText, validateCouponReward } from '../../lib/coupons'
import { pointsForPrice } from '../../lib/rewardPoints'
import { money, dateOnly, toDateStr } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import { askConfirm, confirmDeactivate } from '../../lib/confirm'
const ManageTiers = defineAsyncComponent(() => import('./ManageTiers.vue')) // โหลดเมื่อเปิดแท็บ "ระดับ"

const tab = ref('settings')
const tabs = [
  { v: 'settings', l: 'ตั้งค่า' },
  { v: 'tiers', l: 'ระดับ' },
  { v: 'rewards', l: 'ของแลก' },
  { v: 'gacha', l: 'กาชา' },
  { v: 'coupons', l: 'คูปอง & มอบของ' },
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
  { k: 'earnPer', l: 'ทุกกี่บาท ได้ 1 คะแนน (ตอนส่งมอบ · ยอดก่อน VAT)', u: 'บาท' },
  { k: 'pointValue', l: 'มูลค่า 1 คะแนน (ตอนแปลงเป็นคูปอง)', u: 'บาท' },
  { k: 'pointExpireDays', l: 'คะแนนหมดอายุหลังได้รับ', u: 'วัน' },
  { k: 'couponExpireDays', l: 'คูปองหมดอายุหลังได้รับ', u: 'วัน' },
  { k: 'spinPer', l: 'ทุกกี่บาท ได้สิทธิ์หมุน 1 ครั้ง (ตอนส่งมอบ · ยอดก่อน VAT)', u: 'บาท' },
  { k: 'spinCost', l: 'หมุน 1 ครั้งด้วยคะแนน ใช้', u: 'คะแนน' },
  { k: 'activationMin', l: 'คูปอง/ของรางวัลขึ้นบน POS หลังลูกค้ากด "ใช้ที่ร้านตอนนี้" นาน (ครบเวลา = ถือว่าใช้แล้ว)', u: 'นาที' },
]

// ---------- ของแลก ----------
const rwOpen = ref(false)
const blankRw = () => ({ id: null, name: '', kind: 'item', mode: 'fixed', points: 0, amount: '', minSpend: '', pct: '', cap: '', productId: '', validDays: '', active: true })
const rw = reactive(blankRw())
const rwError = ref('')
// ราคาของที่แลก (บาท) ไม่เก็บลงข้อมูล · ใช้คำนวณ "ใช้คะแนน" ให้เท่านั้น
const rwPrice = ref('')
watch(rwPrice, (v) => { if (v !== '') rw.points = pointsForPrice(v, db.loyalty.pointValue) })
// คูปองลดเป็นบาท: ถ้ายังไม่ได้พิมพ์ราคาเอง ให้ใช้ "ลด (บาท)" เป็นราคาของที่แลก
watch(() => rw.amount, (v) => { if (rw.kind === 'coupon' && rw.mode === 'fixed' && rwPrice.value === '') rwPrice.value = v || '' })
const activeRetail = computed(() => db.retailItems.filter((x) => x.active !== false))
// ตัวอย่างเงื่อนไขที่ลูกค้าจะเห็น (ชื่อสินค้าจากรายการที่เลือก)
const rwPreview = computed(() => ({ ...rw, productName: activeRetail.value.find((x) => x.id === rw.productId)?.name || '' }))
function editRw(r) {
  Object.assign(rw, blankRw(), r ? { ...r, amount: r.amount ? String(r.amount) : '', minSpend: r.minSpend ? String(r.minSpend) : '', pct: r.pct ? String(r.pct) : '', cap: r.cap ? String(r.cap) : '', validDays: r.validDays ? String(r.validDays) : '' } : {})
  rwError.value = ''
  rwPrice.value = ''
  rwOpen.value = true
}
async function saveRw() {
  if (!rw.name.trim()) return (rwError.value = 'กรอกชื่อของ')
  if (!(rw.points > 0)) return (rwError.value = 'คะแนนต้องมากกว่า 0')
  if (rw.kind === 'coupon') {
    const err = validateCouponReward(rw)
    if (err) return (rwError.value = err)
  }
  if (!(await confirmDeactivate(db.rewards, rw, rw.name))) return
  const r = saveReward({ ...rw })
  if (r?.error) return (rwError.value = r.error)
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
async function saveGp() {
  if (!gp.name.trim()) return (gpError.value = 'กรอกชื่อรางวัล')
  if (['points', 'discount'].includes(gp.type) && !(gp.value > 0)) return (gpError.value = 'ใส่จำนวน')
  if (gp.type === 'reward' && !gp.rewardId) return (gpError.value = 'เลือกของรางวัล')
  if (!(gp.chance >= 0)) return (gpError.value = 'โอกาสไม่ถูกต้อง')
  if (!(await confirmDeactivate(db.gachaPrizes, gp, gp.name))) return
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
// คูปอง/ของรางวัลของลูกค้าทั้งหมด: มอบ (หลังบ้าน ไม่ต้องรอลูกค้ากดแสดง) · คืนคะแนนตามที่ไม่ได้ใช้จริง
const PHASE = { pending: ['ยังไม่ใช้', 'bg-warning-50 text-warning-700'], active: ['แสดงที่ร้านอยู่', 'bg-brand-50 text-brand-800'], lapsed: ['หมดเวลาแสดง (ถือว่าใช้แล้ว)', 'bg-stone-100 text-stone-600'], expired: ['หมดอายุ', 'bg-danger-50 text-danger-700'], delivered: ['มอบแล้ว', 'bg-stone-100 text-stone-500'], used: ['ใช้แล้ว', 'bg-stone-100 text-stone-500'], refunded: ['คืนคะแนนแล้ว', 'bg-success-50 text-success-700'] }
const phaseOf = (c) => phaseOfCoupon(c)
const DONE = ['delivered', 'used', 'refunded']
const rewardCoupons = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.coupons
    .filter((c) => showAll.value || !DONE.includes(phaseOf(c)))
    .filter((c) => !s || (findCustomer(c.customerId)?.name || '').toLowerCase().includes(s) || c.name.toLowerCase().includes(s))
})
async function deliver(c) {
  if (await askConfirm({ title: 'มอบของรางวัล', message: `${c.name} ให้ ${findCustomer(c.customerId)?.name || ''} · มอบแล้วถือว่าใช้แล้ว`, okText: 'มอบแล้ว' })) markCouponDelivered(c)
}
const canRefund = (c) => !DONE.includes(phaseOf(c)) && (Number(c.points) > 0 || (c.rewardId && c.source !== 'gacha'))
const rf = reactive({ open: false, c: null, reason: '', notify: true, error: '', ok: '' })
function openRefund(c) { Object.assign(rf, { open: true, c, reason: '', notify: true, error: '' }) }
function doRefund() {
  const r = refundCoupon(rf.c.id, rf.reason, { notify: rf.notify })
  if (r.error) return (rf.error = r.error)
  rf.open = false
  rf.ok = `คืน ${r.points} คะแนนแล้ว`
}
</script>

<template>
  <ManageShell narrow guard title="คะแนน & รางวัล" :toolbar="false">
    <div class="mb-4 grid grid-cols-5 gap-1 seg-grid">
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
          <MoneyInput v-model.number="st[f.k]" min="0" class="input" />
          <span class="w-14 shrink-0 text-sm text-stone-500">{{ f.u }}</span>
        </div>
      </div>
      <button class="btn-primary w-full" @click="saveSettings"><AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึก' }}</button>
    </section>

    <!-- ระดับสมาชิก -->
    <template v-else-if="tab === 'tiers'">
      <ManageTiers />
    </template>

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
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ r.name }}</span>
            <span class="block text-xs text-stone-500">{{ r.kind === 'coupon' ? `คูปอง · ${couponTermsText(r)}${r.validDays ? ` · อายุ ${r.validDays} วัน` : ''}` : 'ของรางวัล (รับที่ร้าน)' }}</span>
          </span>
          <span class="shrink-0 text-sm font-semibold text-stone-700">{{ r.points }} คะแนน</span>
        </button>
      </div>
    </template>

    <!-- กาชา -->
    <template v-else-if="tab === 'gacha'">
      <div class="mb-3 flex flex-wrap items-center gap-3">
        <button class="btn-primary" @click="editGp(null)"><AppIcon name="plus" /> เพิ่มรางวัล</button>
        <span class="rounded-full px-3 py-1 text-sm font-medium" :class="total === 100 ? 'bg-success-50 text-success-700' : 'bg-danger-50 text-danger-700'">
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
      <p v-if="rf.ok" class="mb-2 rounded-xl bg-success-50 p-3 text-sm text-success-800" role="status">{{ rf.ok }}</p>
      <p v-if="!rewardCoupons.length" class="card py-10 text-center text-stone-500">ไม่มีรายการ</p>
      <div class="space-y-2.5">
        <div v-for="c in rewardCoupons" :key="c.id" class="card space-y-2 p-3.5">
          <div class="flex items-start gap-3">
            <span class="min-w-0 flex-1">
              <span class="block font-medium break-words text-stone-900">{{ c.name }} <span class="text-xs font-normal text-stone-400">{{ c.type === 'reward' ? 'ของรางวัล' : couponTermsText(c) }}</span></span>
              <span class="block text-xs text-stone-500">
                {{ findCustomer(c.customerId)?.name }} · {{ c.source === 'gacha' ? 'กาชา' : c.source === 'refund' ? 'คืนเงิน' : c.source === 'convert' ? 'แปลงคะแนน' : 'แลกคะแนน' }}<template v-if="c.points"> ({{ c.points }} คะแนน)</template>
                <template v-if="c.expiresAt"> · หมดอายุ {{ dateOnly(c.expiresAt) }}</template>
              </span>
            </span>
            <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="PHASE[phaseOf(c)][1]">{{ PHASE[phaseOf(c)][0] }}</span>
          </div>
          <div v-if="c.type === 'reward' && ['pending', 'active'].includes(phaseOf(c)) || canRefund(c)" class="flex flex-wrap gap-2">
            <button v-if="c.type === 'reward' && ['pending', 'active'].includes(phaseOf(c))" class="btn-primary h-9 px-3" @click="deliver(c)"><AppIcon name="check" :size="16" /> มอบแล้ว</button>
            <button v-if="canRefund(c) && can('adjustPoints')" class="btn-outline h-9 px-3" @click="openRefund(c)">คืนคะแนน</button>
          </div>
          <p v-if="c.refundReason" class="text-xs text-stone-500">คืนคะแนน: {{ c.refundReason }}</p>
        </div>
      </div>
    </template>

    <AppModal v-if="rf.open" title="คืนคะแนนตามคูปองที่ไม่ได้ใช้" @close="rf.open = false">
      <div class="space-y-3 text-sm">
        <p class="text-stone-600"><b>{{ rf.c.name }}</b> ของ {{ findCustomer(rf.c.customerId)?.name }} · คืน {{ rf.c.points || (db.rewards.find((r) => r.id === rf.c.rewardId)?.points ?? 0) }} คะแนน แล้วคูปองจะใช้ไม่ได้อีก</p>
        <div><label class="label">เหตุผล <span class="text-danger-700">*</span></label><input v-model="rf.reason" class="input" maxlength="200" aria-label="เหตุผลคืนคะแนน" /></div>
        <label class="flex items-center gap-2"><input v-model="rf.notify" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้าคืนคะแนน" /> แจ้งลูกค้า</label>
        <p v-if="rf.error" class="text-danger-700" role="alert">{{ rf.error }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="rf.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="doRefund">คืนคะแนน</button></template>
    </AppModal>

    <!-- modal ของแลก -->
    <AppModal v-if="rwOpen" :title="rw.id ? 'แก้ไขของแลก' : 'เพิ่มของแลก'" @close="rwOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อของ <span class="text-danger-700">*</span></label><input v-model="rw.name" class="input" /></div>
        <div class="grid grid-cols-2 gap-1 seg-grid">
          <button v-for="k in [{ v: 'item', l: 'ของรางวัล (รับที่ร้าน)' }, { v: 'coupon', l: 'คูปองส่วนลด' }]" :key="k.v" type="button" class="h-9 rounded-lg px-1 text-sm font-medium" :class="rw.kind === k.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="rw.kind = k.v">{{ k.l }}</button>
        </div>
        <template v-if="rw.kind === 'coupon'">
          <div class="grid grid-cols-3 gap-1 seg-grid">
            <button v-for="m in COUPON_MODES" :key="m.v" type="button" class="h-9 rounded-lg px-1 text-xs font-medium sm:text-sm" :class="rw.mode === m.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" :aria-pressed="rw.mode === m.v" @click="rw.mode = m.v">{{ m.l }}</button>
          </div>
          <div v-if="rw.mode === 'fixed'" class="grid grid-cols-3 gap-3">
            <div><label class="label">ลด (บาท)</label><MoneyInput v-model="rw.amount" class="input" /></div>
            <div><label class="label">ยอดขั้นต่ำ</label><MoneyInput v-model="rw.minSpend" class="input" placeholder="ไม่มี" /></div>
            <div><label class="label">อายุ (วัน)</label><input v-model="rw.validDays" type="text" v-num class="input" :placeholder="String(db.loyalty.couponExpireDays)" /></div>
          </div>
          <div v-else class="space-y-3">
            <div v-if="rw.mode === 'spend'"><label class="label">ซื้อครบ (บาท)</label><MoneyInput v-model="rw.minSpend" class="input" /></div>
            <div v-else>
              <label class="label" for="rw-product">สินค้าที่ต้องซื้อ</label>
              <select id="rw-product" v-model="rw.productId" class="input h-11">
                <option value="">เลือกสินค้า</option>
                <option v-for="x in activeRetail" :key="x.id" :value="x.id">{{ x.name }}</option>
              </select>
            </div>
            <div class="grid grid-cols-3 gap-3">
              <div><label class="label">ลด (%)</label><input v-model="rw.pct" type="text" v-num.dec class="input" placeholder="เช่น 10" /></div>
              <div><label class="label">ลดสูงสุด (บาท)</label><MoneyInput v-model="rw.cap" class="input" /></div>
              <div><label class="label">อายุ (วัน)</label><input v-model="rw.validDays" type="text" v-num class="input" :placeholder="String(db.loyalty.couponExpireDays)" /></div>
            </div>
          </div>
          <p class="rounded-xl bg-stone-50 p-2.5 text-sm text-stone-700">ลูกค้าจะเห็น: {{ couponTermsText(rwPreview) }}</p>
          <p class="text-xs text-stone-400">ลูกค้าแลกบนเว็บ (บัญชีของฉัน → คะแนน) แล้วนำคูปองมาใช้ที่ POS/ออร์เดอร์ · คะแนนที่แลกแล้วไม่คืน</p>
        </template>
        <div>
          <label class="label">ราคาของที่แลก (บาท)</label>
          <MoneyInput v-model="rwPrice" class="input" placeholder="เช่น 120" />
        </div>
        <div>
          <label class="label">ใช้คะแนน</label>
          <input v-model.number="rw.points" type="text" v-num min="1" class="input" />
          <p v-if="rwPrice !== ''" class="mt-1 text-xs text-stone-500">คิดจาก {{ rwPrice }} ÷ {{ db.loyalty.pointValue }} บาท/คะแนน (ปัดขึ้น) · แก้เองได้</p>
        </div>
        <AppSwitch v-model="rw.active" label="ใช้งาน (แสดงให้ลูกค้าแลก)" class="flex" />
        <p v-if="rwError" class="text-sm text-danger-700">{{ rwError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rwOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveRw">บันทึก</button>
      </template>
    </AppModal>

    <!-- modal รางวัลกาชา -->
    <AppModal v-if="gpOpen" :title="gp.id ? 'แก้ไขรางวัล' : 'เพิ่มรางวัล'" @close="gpOpen = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อรางวัล (แสดงบนวงล้อ) <span class="text-danger-700">*</span></label><input v-model="gp.name" class="input" /></div>
        <div>
          <div class="label">ประเภท</div>
          <div class="flex flex-wrap gap-2">
            <button v-for="(l, k) in PRIZE_TYPES" :key="k" type="button" class="chip" :class="gp.type === k ? 'chip-on' : 'chip-off'" @click="gp.type = k">{{ l }}</button>
          </div>
        </div>
        <div v-if="gp.type === 'points' || gp.type === 'discount'">
          <label class="label">{{ gp.type === 'points' ? 'จำนวนคะแนน' : 'ส่วนลด (บาท)' }}</label>
          <input v-model.number="gp.value" type="text" v-num min="1" class="input" />
        </div>
        <div v-if="gp.type === 'reward'">
          <label class="label">ของรางวัล</label>
          <select v-model="gp.rewardId" class="input">
            <option value="" disabled>เลือกของ</option>
            <option v-for="r in db.rewards.filter((x) => x.kind !== 'coupon')" :key="r.id" :value="r.id">{{ r.name }}</option>
          </select>
        </div>
        <div><label class="label">โอกาส (%)</label><MoneyInput v-model.number="gp.chance" min="0" max="100" class="input" /></div>
        <AppSwitch v-model="gp.active" label="ใช้งาน" class="flex" />
        <p v-if="gpError" class="text-sm text-danger-700">{{ gpError }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="gpOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveGp">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
