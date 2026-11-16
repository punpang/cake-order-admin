<script setup>
// หน้าลุ้นโชคของบิล: ดูรางวัลและจำนวนที่ออกไปแล้วได้ทุกคน · ลุ้นได้เฉพาะสมาชิกที่เข้าสู่ระบบ
// รางวัลที่ได้เป็นคูปองเข้าบัญชีสมาชิก (เมนู คูปอง) · ผลถูกกำหนดที่เซิร์ฟเวอร์ก่อนแสดงบัตรให้ขูด
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callLuckySpin } from '../../lib/luckyRemote'
import { readSessionToken } from '../../lib/customerRemote'
import { refreshCustomerBundle } from '../../data/store'
import { dateOnly, dateTime, money } from '../../lib/format'
import ScratchCard from '../../components/ScratchCard.vue'

const props = defineProps({ token: { type: String, default: '' } })
const route = useRoute()
const router = useRouter()
const phase = ref('loading') // loading · error · ready · busy (กำลังเตรียมบัตร) · scratch (มีบัตรให้ขูด)
const err = ref('')
const notice = ref('') // ข้อความที่ไม่ใช่ข้อผิดพลาด เช่น ต้องเข้าสู่ระบบก่อนลุ้น
const data = ref(null) // { draws, remaining, state, window, prizes, awarded, spins } · spins = ผลของสมาชิกที่เข้าสู่ระบบอยู่
const pending = ref(null) // { index, spin } ใบที่กำลังขูด
const awarded = ref(null) // รางวัลที่ออกไปแล้วที่แสดงอยู่ (null = โหลดไม่ได้)
const awardedLatest = ref(null) // ค่าล่าสุดจากเซิร์ฟเวอร์ (รวมบัตรที่กำลังขูด) · แสดงจริงเมื่อขูดเสร็จ เพื่อไม่ให้เผยผลก่อนขูด
const session = ref(readSessionToken())
const loggedIn = computed(() => !!session.value)
const KIND = { discount: 'คูปองส่วนลด', reward: 'ของรางวัล · รับที่ร้าน' }

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
  awardedLatest.value = d.awarded ?? null
  awarded.value = awardedLatest.value
  phase.value = 'ready'
}

async function load() {
  phase.value = 'loading'
  session.value = readSessionToken()
  const r = await callLuckySpin(props.token, false, session.value)
  if (r.error) return fail(r.error)
  applyStatus(r.data)
}

// ลุ้นต้องเข้าสู่ระบบสมาชิก · ไม่มีเซสชันหรือเซสชันหมดอายุ → ไปหน้าเข้าสู่ระบบ แล้วกลับมาหน้านี้
function goLogin() {
  router.push({ path: '/account/login', query: { next: route.fullPath } })
}

// กดขูดบัตรใบถัดไป: เซิร์ฟเวอร์กำหนดผลก่อน แล้วแสดงบัตรให้ขูด
async function startCard() {
  if (phase.value !== 'ready' || remaining.value < 1) return
  notice.value = ''
  if (!loggedIn.value) return goLogin()
  phase.value = 'busy'
  const r = await callLuckySpin(props.token, true, session.value)
  if (r.code === 'login') {
    session.value = ''
    notice.value = r.error
    return applyStatus(data.value)
  }
  if (r.error) return r.code === 409 ? load() : fail(r.error)
  data.value = r.data
  awardedLatest.value = r.data.awarded ?? null // ยังไม่แสดงจนกว่าขูดเสร็จ
  refreshCustomerBundle() // ให้คูปองที่ได้ขึ้นในบัญชีทันที (ไม่รอ)
  const index = r.data.spins.length - 1
  pending.value = { index, spin: r.data.spins[index] }
  phase.value = 'scratch'
}

// ขูดครบแล้ว: บัตรใบนี้ไปอยู่ในรายการผลที่เปิดแล้ว และอัปเดตรางวัลที่ออกไปแล้ว
function onRevealed() {
  pending.value = null
  awarded.value = awardedLatest.value
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
          <li v-for="(p, i) in prizes" :key="p.id || i" class="rounded-2xl border border-brand-200 bg-brand-50 p-3">
            <div class="font-semibold text-stone-900">{{ p.name }}</div>
            <div class="text-xs text-stone-600">
              {{ KIND[p.kind] || 'รางวัล' }}<template v-if="p.kind === 'discount' && p.amount > 0"> · {{ money(p.amount) }}</template>
            </div>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีรายการรางวัลในขณะนี้</p>
        <p class="text-center text-sm text-stone-700">บิลนี้ลุ้นได้ {{ draws }} ใบ · เหลือ {{ remaining }} ใบ</p>
      </section>

      <section v-if="notice" class="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800" role="status">{{ notice }}</section>

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
              <div class="text-xs">ได้คูปองในบัญชีสมาชิกแล้ว<template v-if="pending.spin.couponExpiresAt"> · ใช้ได้ถึง {{ dateOnly(pending.spin.couponExpiresAt) }}</template></div>
            </template>
            <template v-else>
              <div class="text-xl font-semibold">ยังไม่ได้รางวัล</div>
              <div class="text-sm">ขอบคุณที่ร่วมสนุกค่ะ</div>
            </template>
          </div>
        </ScratchCard>
      </section>

      <section v-else-if="remaining > 0 && !loggedIn" class="card space-y-3 text-center">
        <p class="font-semibold text-stone-900">ลุ้นได้เฉพาะสมาชิก</p>
        <p class="text-sm text-stone-600">เข้าสู่ระบบด้วยบัญชีสมาชิก แล้วกดขูดเพื่อลุ้น รางวัลจะเข้าในบัญชีของคุณ</p>
        <button type="button" class="btn-primary h-14 w-full text-lg" @click="goLogin">เข้าสู่ระบบเพื่อลุ้น</button>
        <RouterLink to="/account/register" class="block text-sm text-brand-700 underline">ยังไม่มีบัญชี? สมัครสมาชิก</RouterLink>
      </section>

      <section v-else-if="remaining > 0" class="card text-center">
        <button type="button" class="btn-primary h-14 w-full text-lg" @click="startCard">ขูดบัตรใบที่ {{ draws - remaining + 1 }}</button>
      </section>

      <section v-else class="card text-center text-stone-700">ขูดครบทุกใบของบิลนี้แล้ว</section>

      <section v-if="awarded" class="card space-y-2">
        <div class="card-title">รางวัลที่ออกไปแล้ว</div>
        <p v-if="data?.window?.from && data?.window?.to" class="text-xs text-stone-500">
          ช่วงเปิดลุ้น {{ dateTime(data.window.from) }} – {{ dateTime(data.window.to) }}
        </p>
        <ul v-if="awarded.length" class="divide-y divide-stone-100">
          <li v-for="a in awarded" :key="a.id" class="flex items-center justify-between gap-3 py-2 text-sm">
            <span class="text-stone-900">{{ a.name }}</span>
            <span class="shrink-0 font-semibold text-brand-800">ออกแล้ว {{ a.count }} ครั้ง</span>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีการออกรางวัลในช่วงนี้</p>
      </section>

      <section v-for="{ s, i } in doneCards" :key="s.at + '-' + i" class="card space-y-2 text-center">
        <div class="text-xs text-stone-500">บัตรใบที่ {{ i + 1 }}</div>
        <template v-if="s.prize">
          <p class="text-xl font-semibold text-brand-800">{{ s.prize.name }}</p>
          <p class="text-sm text-stone-700">ได้คูปองในบัญชีสมาชิกแล้ว<template v-if="s.couponExpiresAt"> · ใช้ได้ถึง {{ dateOnly(s.couponExpiresAt) }}</template></p>
        </template>
        <p v-else class="text-stone-700">ยังไม่ได้รางวัล</p>
      </section>
    </template>

    <p class="text-center text-xs text-stone-500">รางวัลอยู่ในเมนู "คูปอง" ของบัญชีสมาชิก เมื่ออยู่ที่ร้านให้กด "ใช้ที่ร้านตอนนี้" เพื่อให้พนักงานเห็น</p>
  </main>
</template>
