<script setup>
// หน้าลุ้นโชคของบิล (สาธารณะ ไม่ต้องล็อกอิน): แสดงรางวัลที่ลุ้นได้ก่อน → ขูดบัตรทีละใบ (จำนวนตามยอดบิล)
import { computed, onMounted, ref } from 'vue'
import { callLuckySpin } from '../../lib/luckyRemote'
import { dateTime, money } from '../../lib/format'
import ScratchCard from '../../components/ScratchCard.vue'

const props = defineProps({ token: { type: String, default: '' } })
const phase = ref('loading') // loading · error · ready · busy (กำลังเตรียมบัตร) · scratch (มีบัตรให้ขูด)
const err = ref('')
const data = ref(null) // { draws, remaining, state, prizes, spins: [{ at, prize, code, codeExpiresAt, redeemed }] }
const pending = ref(null) // { index, spin } ใบที่กำลังขูด
const KIND = { points: 'คะแนนสะสม', coupon: 'คูปองส่วนลด', item: 'ของ/อื่น ๆ' }

const remaining = computed(() => data.value?.remaining ?? 0)
const draws = computed(() => data.value?.draws ?? 0)
const prizes = computed(() => data.value?.prizes || [])
const doneCards = computed(() => (data.value?.spins || []).map((s, i) => ({ s, i })).filter(({ i }) => !pending.value || i !== pending.value.index))

function fail(message) {
  err.value = message
  phase.value = 'error'
}
function applyStatus(d) {
  data.value = d
  phase.value = 'ready'
}

async function load() {
  phase.value = 'loading'
  const r = await callLuckySpin(props.token, false)
  if (r.error) return fail(r.error)
  applyStatus(r.data)
}

// กดขูดบัตรใบถัดไป: เซิร์ฟเวอร์กำหนดผลก่อน แล้วแสดงบัตรให้ขูด
async function startCard() {
  if (phase.value !== 'ready' || remaining.value < 1) return
  phase.value = 'busy'
  const r = await callLuckySpin(props.token, true)
  if (r.error) return fail(r.error)
  data.value = r.data
  const index = r.data.spins.length - 1
  pending.value = { index, spin: r.data.spins[index] }
  phase.value = 'scratch'
}

// ขูดครบแล้ว: บัตรใบนี้ไปอยู่ในรายการผลที่เปิดแล้ว
function onRevealed() {
  pending.value = null
  phase.value = 'ready'
}

onMounted(load)
</script>

<template>
  <main class="mx-auto max-w-md space-y-4 p-4">
    <header class="pt-4 text-center">
      <div class="text-sm font-medium text-brand-700">ลุ้นโชคท้ายบิล</div>
      <h1 class="text-2xl font-semibold text-stone-900">ขูดลุ้นรางวัลจากบิลของคุณ</h1>
    </header>

    <section v-if="phase === 'loading'" class="card text-center text-stone-600">กำลังโหลด...</section>

    <section v-else-if="phase === 'error'" class="card text-center text-rose-700" role="alert">{{ err }}</section>

    <template v-else>
      <section class="card space-y-3">
        <div class="card-title">รางวัลที่ลุ้นได้</div>
        <ul v-if="prizes.length" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="(p, i) in prizes" :key="i" class="rounded-2xl border border-brand-200 bg-brand-50 p-3">
            <div class="font-semibold text-stone-900">{{ p.name }}</div>
            <div class="text-xs text-stone-600">
              {{ KIND[p.kind] || 'รางวัล' }}<template v-if="p.amount > 0"> · มูลค่า {{ money(p.amount) }}</template>
            </div>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีรายการรางวัลในขณะนี้</p>
        <p class="text-center text-sm text-stone-700">บิลนี้ลุ้นได้ {{ draws }} ใบ · เหลือ {{ remaining }} ใบ</p>
      </section>

      <section v-if="phase === 'busy'" class="card space-y-3 text-center">
        <div class="mx-auto h-24 w-24 animate-spin rounded-full border-8 border-brand-300 border-t-brand-700" aria-hidden="true" />
        <p class="text-stone-700">กำลังเตรียมบัตร...</p>
      </section>

      <section v-else-if="phase === 'scratch' && pending" class="card space-y-3">
        <div class="text-center text-sm text-stone-600">บัตรใบที่ {{ pending.index + 1 }} จาก {{ draws }} · ขูดให้ทั่วเพื่อดูผล</div>
        <ScratchCard :covered="true" label="ขูดตรงนี้" @revealed="onRevealed">
          <div class="flex min-h-44 flex-col items-center justify-center gap-2 bg-gradient-to-br from-amber-300 via-amber-400 to-brand-600 p-6 text-center text-white">
            <template v-if="pending.spin.prize">
              <div class="text-sm">ยินดีด้วย คุณได้รับ</div>
              <div class="text-2xl font-bold">{{ pending.spin.prize.name }}</div>
              <div class="rounded-xl bg-white/90 px-4 py-2 font-mono text-2xl font-bold tracking-widest text-stone-900">{{ pending.spin.code }}</div>
              <div class="text-xs">ใช้ได้ถึง {{ dateTime(pending.spin.codeExpiresAt) }}</div>
            </template>
            <template v-else>
              <div class="text-xl font-semibold">ยังไม่ได้รางวัล</div>
              <div class="text-sm">ขอบคุณที่ร่วมสนุกค่ะ</div>
            </template>
          </div>
        </ScratchCard>
      </section>

      <section v-else-if="remaining > 0" class="card text-center">
        <button type="button" class="btn-primary h-14 w-full text-lg" @click="startCard">ขูดบัตรใบที่ {{ draws - remaining + 1 }}</button>
      </section>

      <section v-else class="card text-center text-stone-700">ขูดครบทุกใบของบิลนี้แล้ว</section>

      <section v-for="{ s, i } in doneCards" :key="s.at + '-' + i" class="card space-y-2 text-center">
        <div class="text-xs text-stone-500">บัตรใบที่ {{ i + 1 }}</div>
        <template v-if="s.prize">
          <p class="text-xl font-semibold text-brand-800">{{ s.prize.name }}</p>
          <div class="rounded-2xl bg-brand-50 p-3">
            <div class="text-xs text-stone-600">รหัสรางวัล (แสดงให้พนักงานที่ร้าน)</div>
            <div class="font-mono text-2xl font-bold tracking-widest text-stone-900">{{ s.code }}</div>
            <div class="mt-1 text-xs text-stone-600">ใช้ได้ถึง {{ dateTime(s.codeExpiresAt) }}</div>
          </div>
          <p v-if="s.redeemed" class="text-sm font-medium text-emerald-700">รับรางวัลที่ร้านแล้ว</p>
        </template>
        <p v-else class="text-stone-700">ยังไม่ได้รางวัล</p>
      </section>
    </template>

    <p class="text-center text-xs text-stone-500">เก็บหน้านี้หรือรหัสไว้ แล้วแสดงให้พนักงานที่ร้านเพื่อรับรางวัล</p>
  </main>
</template>
