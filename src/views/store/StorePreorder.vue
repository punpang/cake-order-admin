<script setup>
// สั่งล่วงหน้า (ลูกค้า): เลือกแคมเปญ → เลือกสินค้า วันรับ วิธีรับ → ดูราคา → ยืนยันเบอร์ด้วย OTP
// การสร้างออร์เดอร์อยู่ในขั้นถัดไป · โทเคนเซสชันเก็บโดย callPreorder อัตโนมัติ
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { callPreorder } from '../../lib/preorderRemote'
import { loadTurnstile, turnstileOn, turnstileSiteKey } from '../../lib/turnstile'

const campaigns = ref([])
const loading = ref(true)
const error = ref('')
const chosen = ref(null)
const pickup = ref('')
const fulfillment = ref('pickup')
const qty = reactive({})
const quote = ref(null)
const quoteError = ref('')

// ขั้นยืนยัน OTP
const phone = ref('')
const code = ref('')
const name = ref('')
const consent = ref(false)
const needConsent = ref(false)
const otpSent = ref(false)
const verified = ref(false)
const otpError = ref('')
const busy = ref(false)
const captchaEl = ref(null)
const captchaToken = ref('')
let captchaId = null
// ขั้นสั่งออร์เดอร์
const address = ref('')
const province = ref('')
const placing = ref(false)
const placeError = ref('')
const placed = ref(null)
let attemptOrderId = ''

async function mountCaptcha() {
  if (!turnstileOn()) return
  if (captchaId !== null && captchaEl.value && captchaEl.value.childElementCount) return
  try {
    const ts = await loadTurnstile()
    await nextTick()
    if (!captchaEl.value) return
    captchaId = ts.render(captchaEl.value, {
      sitekey: turnstileSiteKey(),
      callback: (t) => { captchaToken.value = t },
      'expired-callback': () => { captchaToken.value = '' },
      'error-callback': () => { captchaToken.value = '' },
    })
  } catch {
    otpError.value = 'โหลดตัวยืนยันไม่ได้ กรุณารีเฟรชหน้า'
  }
}
function resetCaptcha() {
  captchaToken.value = ''
  if (captchaId !== null && window.turnstile) { try { window.turnstile.reset(captchaId) } catch { /* ไม่เป็นไร */ } }
}

async function sendCode() {
  otpError.value = ''
  if (!captchaToken.value && turnstileOn()) { otpError.value = 'กรุณายืนยันว่าเป็นคนก่อน'; return }
  busy.value = true
  const r = await callPreorder('otp_request', { phone: phone.value.trim(), turnstileToken: captchaToken.value })
  busy.value = false
  resetCaptcha()
  if (r.error) { otpError.value = r.error; return }
  otpSent.value = true
}

async function verifyCode() {
  otpError.value = ''
  busy.value = true
  const r = await callPreorder('otp_verify', { phone: phone.value.trim(), code: code.value.trim(), name: name.value.trim(), consent: consent.value })
  busy.value = false
  if (r.needConsent) { needConsent.value = true; otpError.value = 'ลูกค้าใหม่ต้องยินยอมก่อน (ติ๊กช่องด้านล่างแล้วกดยืนยันอีกครั้ง)'; return }
  if (r.error) { otpError.value = r.error; return }
  verified.value = true
  await nextTick()
  captchaId = null
  mountCaptcha()
}

function newOrderId() {
  const b = crypto.getRandomValues(new Uint8Array(16))
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

// สั่งออร์เดอร์: รหัสออร์เดอร์สร้างครั้งเดียวต่อความพยายาม เพื่อให้กดซ้ำไม่สร้างซ้ำ
async function placeOrder() {
  placeError.value = ''
  if (!captchaToken.value && turnstileOn()) { placeError.value = 'กรุณายืนยันว่าเป็นคนก่อน'; return }
  if (!attemptOrderId) attemptOrderId = newOrderId()
  placing.value = true
  const r = await callPreorder('create', {
    campaignId: chosen.value.id,
    pickupDate: pickup.value,
    fulfillment: fulfillment.value,
    lines: lines.value,
    orderId: attemptOrderId,
    turnstileToken: captchaToken.value,
    address: address.value,
    province: province.value,
  })
  placing.value = false
  resetCaptcha()
  if (r.error) { placeError.value = r.error; return }
  placed.value = r
  attemptOrderId = ''
}

const days = computed(() => {
  const c = chosen.value
  if (!c) return []
  const out = []
  const end = c.pickupTo
  for (let d = c.pickupFrom; d <= end && out.length < 62; ) {
    out.push(d)
    const t = new Date(`${d}T00:00:00Z`).getTime() + 86400000
    d = new Date(t).toISOString().slice(0, 10)
  }
  return out
})
const lines = computed(() => (chosen.value?.items ?? []).filter((i) => Number(qty[i.retailId]) > 0).map((i) => ({ retailId: i.retailId, qty: Number(qty[i.retailId]) })))
// ขั้นตอนที่ลูกค้าอยู่ตอนนี้ (1 เลือกสินค้า · 2 ดูราคาแล้ว · 3 ยืนยันเบอร์แล้ว · 4 สั่งสำเร็จ)
const step = computed(() => (placed.value ? 4 : verified.value ? 3 : quote.value ? 2 : 1))
const STEPS = ['เลือกสินค้า', 'ดูราคา', 'ยืนยันเบอร์', 'สั่งสินค้า']
// ปุ่มบวกลบจำนวน (ขั้นต่ำ 0 สูงสุด 999)
function bump(id, d) { qty[id] = Math.max(0, Math.min(999, (Number(qty[id]) || 0) + d)) }

async function load() {
  loading.value = true
  const r = await callPreorder('campaigns')
  loading.value = false
  if (r.error) { error.value = r.error; return }
  campaigns.value = r.campaigns || []
}

function choose(c) {
  chosen.value = c
  quote.value = null
  quoteError.value = ''
  pickup.value = c.pickupFrom
  fulfillment.value = 'pickup'
  for (const k of Object.keys(qty)) delete qty[k]
}

async function seeQuote() {
  quote.value = null
  quoteError.value = ''
  if (!lines.value.length) { quoteError.value = 'เลือกสินค้าอย่างน้อย 1 รายการ'; return }
  const r = await callPreorder('quote', { campaignId: chosen.value.id, pickupDate: pickup.value, fulfillment: fulfillment.value, lines: lines.value })
  if (r.error) { quoteError.value = r.error; return }
  quote.value = r
  if (!otpSent.value && !verified.value) mountCaptcha()
}

onMounted(load)
onBeforeUnmount(() => { if (captchaId !== null && window.turnstile) { try { window.turnstile.remove(captchaId) } catch { /* ไม่เป็นไร */ } } })
</script>

<template>
  <section class="mx-auto max-w-2xl px-4 pb-10 pt-6">
    <header class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="text-xs text-stone-500">ร้านเค้กตัวอย่าง</p>
        <h1 class="mt-0.5 text-2xl font-semibold text-stone-900">สั่งล่วงหน้า</h1>
      </div>
    </header>

    <p v-if="loading" class="mt-8 text-sm text-stone-500">กำลังโหลดแคมเปญ…</p>
    <p v-else-if="error" class="mt-8 text-sm text-rose-700" role="alert">{{ error }}</p>
    <div v-else-if="!campaigns.length" class="mt-8 rounded-2xl border border-dashed border-stone-300 p-6 text-center">
      <p class="font-medium text-stone-800">ตอนนี้ยังไม่มีแคมเปญเปิดรับสั่ง</p>
      <p class="mt-1 text-sm text-stone-500">กลับมาดูใหม่เมื่อร้านเปิดรับสั่งล่วงหน้า</p>
    </div>

    <!-- เลือกแคมเปญ -->
    <ul v-if="!chosen && campaigns.length" class="mt-6 space-y-3">
      <li v-for="c in campaigns" :key="c.id" class="rounded-2xl border border-stone-200 bg-white p-4">
        <div class="text-lg font-semibold text-stone-900">{{ c.name }}</div>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-stone-600">
          <dt class="text-stone-500">รับสินค้า</dt><dd>{{ c.pickupFrom }} ถึง {{ c.pickupTo }}</dd>
          <dt class="text-stone-500">มัดจำขั้นต่ำ</dt><dd>{{ c.depositPercent }}%</dd>
        </dl>
        <button type="button" class="btn-primary mt-4 h-12 w-full" @click="choose(c)">เลือกแคมเปญนี้</button>
      </li>
    </ul>

    <div v-if="chosen" class="mt-5 space-y-5">
      <div class="flex items-center justify-between gap-3">
        <button type="button" class="btn-outline h-10 px-3 text-sm" @click="chosen = null">← แคมเปญอื่น</button>
        <span class="min-w-0 truncate text-sm font-medium text-stone-700">{{ chosen.name }}</span>
      </div>

      <!-- ความคืบหน้า: บอกว่าอยู่ขั้นไหนและเหลืออีกกี่ขั้น -->
      <ol class="grid grid-cols-4 gap-1.5" aria-label="ขั้นตอนการสั่ง" data-steps>
        <li v-for="(label, n) in STEPS" :key="label" class="min-w-0" :aria-current="step === n + 1 ? 'step' : undefined">
          <div class="h-1.5 rounded-full" :class="step >= n + 1 ? 'bg-brand-500' : 'bg-stone-200'"></div>
          <div class="mt-1.5 truncate text-[11px]" :class="step === n + 1 ? 'font-semibold text-stone-900' : 'text-stone-500'">{{ n + 1 }} {{ label }}</div>
        </li>
      </ol>

      <!-- ขั้น 1: จำนวนสินค้า -->
      <section class="space-y-2" aria-labelledby="pre-items-h">
        <h2 id="pre-items-h" class="text-base font-semibold text-stone-900">เลือกจำนวนสินค้า</h2>
        <div v-for="i in chosen.items" :key="i.retailId" class="flex items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3">
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-stone-900">{{ i.name }}</div>
            <div class="text-sm text-stone-500">{{ i.price }} บาท / ชิ้น</div>
          </div>
          <div class="flex shrink-0 items-center gap-1.5">
            <button type="button" class="btn-outline h-11 w-11 px-0 text-lg" :aria-label="`ลด ${i.name}`" :disabled="!(qty[i.retailId] > 0)" @click="bump(i.retailId, -1)">−</button>
            <input v-model.number="qty[i.retailId]" type="number" min="0" max="999" inputmode="numeric" class="input h-11 w-14 px-1 text-center tabular-nums" :aria-label="`จำนวน ${i.name}`" />
            <button type="button" class="btn-outline h-11 w-11 px-0 text-lg" :aria-label="`เพิ่ม ${i.name}`" @click="bump(i.retailId, 1)">+</button>
          </div>
        </div>
      </section>

      <!-- ขั้น 2: วันรับและวิธีรับ -->
      <section class="space-y-3" aria-labelledby="pre-how-h">
        <h2 id="pre-how-h" class="text-base font-semibold text-stone-900">รับสินค้าแบบไหน</h2>
        <div>
          <label class="label" for="pre-pickup">วันรับสินค้า</label>
          <select id="pre-pickup" v-model="pickup" class="input h-12 w-full">
            <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
          </select>
        </div>
        <fieldset>
          <legend class="label">วิธีรับ</legend>
          <div class="grid gap-2" :class="chosen.parcelEnabled ? 'grid-cols-2' : 'grid-cols-1'">
            <label class="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-stone-200 bg-white px-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <input v-model="fulfillment" type="radio" value="pickup" class="h-5 w-5 accent-brand-600" />
              <span class="font-medium text-stone-900">รับที่ร้าน</span>
            </label>
            <label v-if="chosen.parcelEnabled" class="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border-2 border-stone-200 bg-white px-4 has-[:checked]:border-brand-500 has-[:checked]:bg-brand-50">
              <input v-model="fulfillment" type="radio" value="delivery" class="h-5 w-5 accent-brand-600" />
              <span class="font-medium text-stone-900">ส่งพัสดุ</span>
            </label>
          </div>
        </fieldset>
        <p v-if="fulfillment === 'delivery'" class="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900" data-full-payment>การจัดส่งต้องชำระเต็มจำนวนตอนสั่ง</p>
        <p v-if="fulfillment === 'delivery' && chosen.shipping" class="text-sm text-stone-600" data-ship>จัดส่งระหว่าง {{ chosen.shipping.shipFrom }} ถึง {{ chosen.shipping.shipTo }}</p>
      </section>

      <button type="button" class="btn-primary h-12 w-full" @click="seeQuote">ดูราคา</button>
      <p v-if="quoteError" class="text-sm text-rose-700" role="alert">{{ quoteError }}</p>

      <!-- ยอดรวมที่เซิร์ฟเวอร์คิด -->
      <div v-if="quote" class="rounded-2xl bg-stone-900 p-4 text-white" data-quote>
        <div class="text-sm text-stone-300">ยอดรวม {{ quote.total }} บาท</div>
        <div v-if="quote.shippingFee" class="mt-1 text-sm text-stone-300">ค่าส่ง {{ quote.shippingFee }} บาท</div>
        <div v-if="quote.deposit" class="mt-2 text-xs text-stone-400">มัดจำ {{ quote.deposit }} บาท ชำระตอนสั่ง</div>
      </div>

      <!-- ขั้น 3: ยืนยันเบอร์ -->
      <div v-if="quote && !verified" class="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-otp>
        <h2 class="text-base font-semibold text-stone-900">ยืนยันเบอร์โทรเพื่อสั่งสินค้า</h2>
        <div v-if="!otpSent" class="space-y-3">
          <div>
            <label class="label" for="pre-phone">เบอร์โทรศัพท์</label>
            <input id="pre-phone" v-model="phone" type="tel" inputmode="tel" autocomplete="tel" class="input h-12 w-full" placeholder="08xxxxxxxx" />
          </div>
          <div v-if="turnstileOn()" ref="captchaEl"></div>
          <button type="button" class="btn-primary h-12 w-full" :disabled="busy || !phone" @click="sendCode">{{ busy ? 'กำลังส่ง…' : 'ส่งรหัส OTP' }}</button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-sm text-stone-600">ส่งรหัสไปที่ {{ phone }} แล้ว รหัสใช้ได้ 5 นาที</p>
          <div>
            <label class="label" for="pre-code">รหัส OTP 6 หลัก</label>
            <input id="pre-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="input h-12 w-full text-center text-lg tracking-[0.3em] tabular-nums" />
          </div>
          <div v-if="needConsent" class="space-y-2">
            <label class="label" for="pre-name">ชื่อผู้สั่ง</label>
            <input id="pre-name" v-model="name" type="text" autocomplete="name" maxlength="80" class="input h-12 w-full" />
            <label class="flex items-start gap-2 text-sm text-stone-700"><input v-model="consent" type="checkbox" class="mt-1 h-5 w-5 accent-brand-600" /> ยินยอมให้ร้านเก็บและใช้ข้อมูลส่วนตัวเพื่อการสั่งสินค้า (นโยบายความเป็นส่วนตัว)</label>
          </div>
          <button type="button" class="btn-primary h-12 w-full" :disabled="busy || code.length !== 6" @click="verifyCode">{{ busy ? 'กำลังตรวจ…' : 'ยืนยัน' }}</button>
          <button type="button" class="btn-outline h-11 w-full text-sm" @click="otpSent = false; code = ''">เปลี่ยนเบอร์ หรือส่งรหัสใหม่</button>
        </div>
        <p v-if="otpError" class="text-sm text-rose-700" role="alert">{{ otpError }}</p>
      </div>

      <!-- ขั้น 4: ยืนยันการสั่ง -->
      <div v-if="verified && !placed" class="space-y-3 rounded-2xl border border-stone-200 bg-white p-4" data-place>
        <p class="text-sm font-medium text-emerald-800">ยืนยันเบอร์แล้ว</p>
        <div v-if="fulfillment === 'delivery'" class="space-y-3">
          <div>
            <label class="label" for="pre-address">ที่อยู่จัดส่ง</label>
            <textarea id="pre-address" v-model="address" rows="3" maxlength="300" class="input w-full"></textarea>
          </div>
          <div>
            <label class="label" for="pre-province">จังหวัด</label>
            <input id="pre-province" v-model="province" type="text" maxlength="40" class="input h-12 w-full" />
          </div>
        </div>
        <div v-if="turnstileOn()" ref="captchaEl"></div>
        <button type="button" class="btn-primary h-12 w-full" :disabled="placing" @click="placeOrder">{{ placing ? 'กำลังสั่ง…' : 'ยืนยันสั่งสินค้า' }}</button>
        <p v-if="placeError" class="text-sm text-rose-700" role="alert">{{ placeError }}</p>
      </div>

      <!-- สำเร็จ -->
      <div v-if="placed" class="space-y-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4" data-placed>
        <div class="text-base font-semibold text-emerald-900">สั่งสินค้าสำเร็จ รหัส {{ placed.code }}</div>
        <div class="text-sm text-emerald-900">ยอดรวม {{ placed.total }} บาท · มัดจำ {{ placed.deposit }} บาท</div>
        <div class="text-xs text-emerald-800">ชำระมัดจำภายในเวลาที่กำหนด ดูสถานะได้ที่ออร์เดอร์ของฉัน</div>
      </div>
    </div>
  </section>
</template>
