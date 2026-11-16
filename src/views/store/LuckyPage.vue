<script setup>
// หน้าลุ้นโชคของบิล: แสดงทุกโครงการที่บิลนี้ได้ลุ้น · ดูรางวัลและจำนวนที่ออกไปแล้วได้ทุกคน · ลุ้นได้เฉพาะสมาชิกที่เข้าสู่ระบบ
// แต่ละโครงการลุ้นแยกกัน รางวัลที่ได้เป็นคูปองเข้าบัญชีสมาชิก (เมนู คูปอง) · ผลถูกกำหนดที่เซิร์ฟเวอร์ก่อนแสดงบัตรให้ขูด
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { callLuckySpin } from '../../lib/luckyRemote'
import { readSessionToken } from '../../lib/customerRemote'
import { refreshCustomerBundle } from '../../data/store'
import { dateOnly, dateTime, money } from '../../lib/format'
import { MAX_DRAWS_PER_BILL } from '../../lib/luckyDraw'
import ScratchCard from '../../components/ScratchCard.vue'

const props = defineProps({ token: { type: String, default: '' } })
const route = useRoute()
const router = useRouter()
const phase = ref('loading') // loading · error · ready · busy (กำลังเตรียมบัตร) · scratch (มีบัตรให้ขูด)
const err = ref('')
const notice = ref('') // ข้อความที่ไม่ใช่ข้อผิดพลาด เช่น ต้องเข้าสู่ระบบก่อนลุ้น
const data = ref(null) // { projects: [...] } · spins ของแต่ละโครงการ = ผลของสมาชิกที่เข้าสู่ระบบอยู่
const spinningId = ref('') // โครงการที่กำลังเตรียมบัตร
const pending = ref(null) // { projectId, index, number, spin } ใบที่กำลังขูด
const shown = ref({}) // รางวัลที่ออกไปแล้วที่แสดงอยู่ แยกตามโครงการ · อัปเดตหลังขูดเสร็จ เพื่อไม่เผยผลก่อนขูด
const latest = ref({}) // ค่าล่าสุดจากเซิร์ฟเวอร์ (รวมบัตรที่กำลังขูด)
const session = ref(readSessionToken())
const loggedIn = computed(() => !!session.value)
const KIND = { discount: 'คูปองส่วนลด', reward: 'ของรางวัล · รับที่ร้าน', points: 'คะแนนสะสม' }
const STATE = {
  ready: { t: 'เปิดลุ้น', c: 'bg-emerald-100 text-emerald-800' },
  done: { t: 'ลุ้นครบแล้ว', c: 'bg-stone-100 text-stone-700' },
  closed: { t: 'ปิดแล้ว', c: 'bg-rose-100 text-rose-700' },
}

const projects = computed(() => data.value?.projects || [])
const totalDraws = computed(() => projects.value.reduce((s, p) => s + p.draws, 0))
const totalRemaining = computed(() => projects.value.reduce((s, p) => s + p.remaining, 0))
const canSpin = (p) => p.state === 'ready' && p.remaining > 0
const prizesOf = (p) => (p.prizes || []).filter((x) => x.kind !== 'none') // ไม่ได้รางวัลไม่แสดงในรายการรางวัล

function conditionText(p) {
  if (p.kind === 'amount') return `ซื้อครบทุก ${p.everyBaht} บาท ได้ 1 ครั้ง (สูงสุด ${MAX_DRAWS_PER_BILL} ครั้งต่อบิล)`
  return 'มีสินค้าที่ร่วมโครงการอย่างน้อย 1 ชิ้น ได้ 1 ครั้งต่อบิล'
}
// ผลของสมาชิกในโครงการนั้น ยกเว้นบัตรที่กำลังขูด
function doneSpins(p) {
  return (p.spins || []).map((s, i) => ({ s, i })).filter(({ i }) => !(pending.value && pending.value.projectId === p.id && pending.value.index === i))
}

function fail(message) {
  err.value = message
  phase.value = 'error'
}
function applyStatus(d) {
  data.value = d
  shown.value = Object.fromEntries((d.projects || []).map((p) => [p.id, p.awarded]))
  latest.value = shown.value
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

// กดขูดบัตรใบถัดไปของโครงการนั้น: เซิร์ฟเวอร์กำหนดผลก่อน แล้วแสดงบัตรให้ขูด
async function startCard(p) {
  if (phase.value !== 'ready' || !canSpin(p)) return
  notice.value = ''
  if (!loggedIn.value) return goLogin()
  phase.value = 'busy'
  spinningId.value = p.id
  try {
    const r = await callLuckySpin(props.token, true, session.value, p.id)
    if (r.code === 'login') {
      session.value = ''
      notice.value = r.error
      return applyStatus(data.value)
    }
    if (r.error) return r.code === 409 ? load() : fail(r.error)
    const np = r.data.projects.find((x) => x.id === p.id)
    if (!np) return load()
    data.value = r.data
    latest.value = Object.fromEntries(r.data.projects.map((x) => [x.id, x.awarded])) // ยังไม่แสดงจนกว่าขูดเสร็จ
    refreshCustomerBundle() // ให้คูปองที่ได้ขึ้นในบัญชีทันที (ไม่รอ)
    const index = np.spins.length - 1
    pending.value = { projectId: p.id, index, number: np.draws - np.remaining, spin: np.spins[index] }
    phase.value = 'scratch'
  } finally {
    spinningId.value = ''
  }
}

// ขูดครบแล้ว: บัตรใบนี้ไปอยู่ในรายการผลที่เปิดแล้ว และอัปเดตรางวัลที่ออกไปแล้ว
function onRevealed() {
  pending.value = null
  shown.value = latest.value
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
      <section class="card text-center text-sm text-stone-700">
        <template v-if="projects.length">บิลนี้ลุ้นได้ {{ totalDraws }} ใบ จาก {{ projects.length }} โครงการ · เหลือ {{ totalRemaining }} ใบ</template>
        <template v-else>บิลนี้ยังไม่มีสิทธิ์ลุ้นในขณะนี้</template>
      </section>

      <section v-if="notice" class="rounded-xl bg-amber-50 p-3 text-center text-sm text-amber-800" role="status">{{ notice }}</section>

      <section v-if="!loggedIn && totalRemaining > 0" class="card space-y-3 text-center">
        <p class="font-semibold text-stone-900">ลุ้นได้เฉพาะสมาชิก</p>
        <p class="text-sm text-stone-600">เข้าสู่ระบบด้วยบัญชีสมาชิก แล้วกดขูดเพื่อลุ้น รางวัลจะเข้าในบัญชีของคุณ</p>
        <button type="button" class="btn-primary h-14 w-full text-lg" @click="goLogin">เข้าสู่ระบบเพื่อลุ้น</button>
        <RouterLink to="/account/register" class="block text-sm text-brand-700 underline">ยังไม่มีบัญชี? สมัครสมาชิก</RouterLink>
      </section>

      <section v-for="p in projects" :key="p.id" class="card space-y-3">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <div class="font-semibold text-stone-900">{{ p.name }}</div>
            <div class="text-xs text-stone-600">{{ conditionText(p) }}</div>
          </div>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="STATE[p.state]?.c">{{ STATE[p.state]?.t }}</span>
        </div>

        <ul v-if="prizesOf(p).length" class="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <li v-for="(x, i) in prizesOf(p)" :key="x.id || i" class="rounded-2xl border border-brand-200 bg-brand-50 p-3">
            <div class="font-semibold text-stone-900">{{ x.name }}</div>
            <div class="text-xs text-stone-600">
              {{ KIND[x.kind] || 'รางวัล' }}<template v-if="x.kind === 'discount' && x.amount > 0"> · {{ money(x.amount) }}</template><template v-if="x.kind === 'points' && x.points > 0"> · {{ x.points }} คะแนน</template>
            </div>
          </li>
        </ul>
        <p v-else class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีรายการรางวัลในโครงการนี้</p>

        <p class="text-center text-sm text-stone-700">ลุ้นได้ {{ p.draws }} ใบ · เหลือ {{ p.remaining }} ใบ</p>
        <p v-if="p.window?.to" class="text-center text-xs text-stone-500">ลุ้นได้ถึง {{ dateTime(p.window.to) }}</p>

        <div v-if="spinningId === p.id" class="space-y-3 text-center">
          <div class="mx-auto h-16 w-16 animate-spin rounded-full border-8 border-brand-300 border-t-brand-700" aria-hidden="true" />
          <p class="text-stone-700">กำลังเตรียมบัตร...</p>
        </div>

        <div v-else-if="phase === 'scratch' && pending && pending.projectId === p.id" class="space-y-2">
          <div class="text-center text-sm text-stone-600">บัตรใบที่ {{ pending.number }} จาก {{ p.draws }} · ขูดให้ทั่วเพื่อดูผล</div>
          <ScratchCard :covered="true" label="ขูดตรงนี้" @revealed="onRevealed">
            <div class="flex min-h-44 flex-col items-center justify-center gap-2 bg-linear-to-br from-amber-300 via-amber-400 to-brand-600 p-6 text-center text-white">
              <template v-if="pending.spin.prize && pending.spin.prize.kind !== 'none'">
                <div class="text-sm">ยินดีด้วย คุณได้รับ</div>
                <div class="text-2xl font-bold">{{ pending.spin.prize.name }}</div>
                <div v-if="pending.spin.prize.kind === 'points'" class="text-xs">ได้ {{ pending.spin.prize.points }} คะแนนสะสมในบัญชีแล้ว</div>
                <div v-else class="text-xs">ได้คูปองในบัญชีสมาชิกแล้ว<template v-if="pending.spin.couponExpiresAt"> · ใช้ได้ถึง {{ dateOnly(pending.spin.couponExpiresAt) }}</template></div>
              </template>
              <template v-else>
                <div class="text-xl font-semibold">ยังไม่ได้รางวัล</div>
                <div class="text-sm">ขอบคุณที่ร่วมสนุกค่ะ</div>
              </template>
            </div>
          </ScratchCard>
        </div>

        <button v-else-if="canSpin(p)" type="button" class="btn-primary h-14 w-full text-lg" :disabled="phase !== 'ready'" @click="startCard(p)">
          {{ loggedIn ? `ขูดบัตรใบที่ ${p.draws - p.remaining + 1}` : 'เข้าสู่ระบบเพื่อลุ้น' }}
        </button>
        <p v-else-if="p.state === 'closed' && p.remaining > 0" class="text-center text-sm text-stone-600">โครงการนี้ปิดการลุ้นแล้ว</p>
        <p v-else-if="p.remaining === 0" class="text-center text-sm text-stone-700">ลุ้นครบทุกใบของโครงการนี้แล้ว</p>

        <div v-if="shown[p.id]" class="space-y-1">
          <div class="text-xs font-semibold text-stone-500">รางวัลที่ออกไปแล้ว</div>
          <ul v-if="shown[p.id].length" class="divide-y divide-stone-100">
            <li v-for="a in shown[p.id]" :key="a.id" class="flex items-center justify-between gap-3 py-2 text-sm">
              <span class="text-stone-900">{{ a.name }}</span>
              <span class="shrink-0 font-semibold text-brand-800">ออกแล้ว {{ a.count }} ครั้ง</span>
            </li>
          </ul>
          <p v-else class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีการออกรางวัลในโครงการนี้</p>
        </div>

        <div v-for="{ s, i } in doneSpins(p)" :key="s.at + '-' + i" class="space-y-1 rounded-2xl bg-stone-50 p-3 text-center">
          <div class="text-xs text-stone-500">ผลการลุ้นของคุณ · ใบที่ {{ i + 1 }}</div>
          <template v-if="s.prize && s.prize.kind !== 'none'">
            <p class="text-xl font-semibold text-brand-800">{{ s.prize.name }}</p>
            <p v-if="s.prize.kind === 'points'" class="text-sm text-stone-700">ได้ {{ s.prize.points }} คะแนนสะสมในบัญชีแล้ว</p>
            <p v-else class="text-sm text-stone-700">ได้คูปองในบัญชีสมาชิกแล้ว<template v-if="s.couponExpiresAt"> · ใช้ได้ถึง {{ dateOnly(s.couponExpiresAt) }}</template></p>
          </template>
          <p v-else class="text-stone-700">ยังไม่ได้รางวัล</p>
        </div>
      </section>
    </template>

    <p class="text-center text-xs text-stone-500">คูปองอยู่ในเมนู "คูปอง" และคะแนนสะสมอยู่ในประวัติของบัญชีสมาชิก เมื่อจะใช้คูปองที่ร้านให้กด "ใช้ที่ร้านตอนนี้"</p>
  </main>
</template>
