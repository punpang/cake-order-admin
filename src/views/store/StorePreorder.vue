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
  <section class="mx-auto max-w-2xl px-4 py-6">
    <h1 class="text-xl font-semibold text-stone-900">สั่งล่วงหน้า</h1>
    <p v-if="loading" class="mt-4 text-sm text-stone-500">กำลังโหลด…</p>
    <p v-else-if="error" class="mt-4 text-sm text-rose-700" role="alert">{{ error }}</p>
    <p v-else-if="!campaigns.length" class="mt-4 text-sm text-stone-500">ขณะนี้ยังไม่มีแคมเปญเปิดรับสั่ง</p>

    <ul v-if="!chosen && campaigns.length" class="mt-4 space-y-3">
      <li v-for="c in campaigns" :key="c.id" class="card p-4">
        <div class="font-medium text-stone-900">{{ c.name }}</div>
        <div class="text-xs text-stone-500">รับสินค้า {{ c.pickupFrom }} ถึง {{ c.pickupTo }} · มัดจำขั้นต่ำ {{ c.depositPercent }}%</div>
        <button type="button" class="btn-primary mt-3 h-11 w-full" @click="choose(c)">เลือกแคมเปญนี้</button>
      </li>
    </ul>

    <div v-if="chosen" class="mt-4 space-y-4">
      <button type="button" class="btn-outline h-10 px-3 text-sm" @click="chosen = null">← กลับไปเลือกแคมเปญ</button>
      <h2 class="text-base font-semibold text-stone-900">{{ chosen.name }}</h2>

      <div class="space-y-2">
        <div v-for="i in chosen.items" :key="i.retailId" class="flex items-center justify-between gap-3 rounded-xl border border-stone-200 p-3">
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ i.name }}</div>
            <div class="text-xs text-stone-500">{{ i.price }} บาท</div>
          </div>
          <input v-model.number="qty[i.retailId]" type="number" min="0" max="999" inputmode="numeric" class="input h-11 w-24" :aria-label="`จำนวน ${i.name}`" />
        </div>
      </div>

      <div>
        <label class="label" for="pre-pickup">วันรับสินค้า</label>
        <select id="pre-pickup" v-model="pickup" class="input h-11 w-full">
          <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>

      <fieldset>
        <legend class="label">วิธีรับ</legend>
        <div class="flex gap-2">
          <label class="flex h-11 items-center gap-2 rounded-xl border border-stone-200 px-3 text-sm"><input v-model="fulfillment" type="radio" value="pickup" /> รับที่ร้าน</label>
          <label v-if="chosen.parcelEnabled" class="flex h-11 items-center gap-2 rounded-xl border border-stone-200 px-3 text-sm"><input v-model="fulfillment" type="radio" value="delivery" /> ส่งพัสดุ</label>
        </div>
      </fieldset>
      <p v-if="fulfillment === 'delivery'" class="text-sm font-medium text-amber-800" data-full-payment>การจัดส่งต้องชำระเต็มจำนวนตอนสั่ง</p>
      <p v-if="fulfillment === 'delivery' && chosen.shipping" class="text-sm text-stone-600" data-ship>จัดส่งระหว่าง {{ chosen.shipping.shipFrom }} ถึง {{ chosen.shipping.shipTo }}</p>

      <button type="button" class="btn-primary h-11 w-full" @click="seeQuote">ดูราคา</button>
      <p v-if="quoteError" class="text-sm text-rose-700" role="alert">{{ quoteError }}</p>
      <div v-if="quote" class="card p-4 text-sm" data-quote>
        <div>ยอดรวม {{ quote.total }} บาท</div>
        <div v-if="quote.shippingFee">ค่าส่ง {{ quote.shippingFee }} บาท</div>
      </div>

      <div v-if="quote && !verified" class="card space-y-3 p-4" data-otp>
        <h3 class="text-sm font-semibold text-stone-900">ยืนยันเบอร์โทรเพื่อสั่งสินค้า</h3>
        <div v-if="!otpSent" class="space-y-3">
          <div>
            <label class="label" for="pre-phone">เบอร์โทรศัพท์</label>
            <input id="pre-phone" v-model="phone" type="tel" inputmode="tel" autocomplete="tel" class="input h-11 w-full" placeholder="08xxxxxxxx" />
          </div>
          <div v-if="turnstileOn()" ref="captchaEl"></div>
          <button type="button" class="btn-primary h-11 w-full" :disabled="busy || !phone" @click="sendCode">{{ busy ? 'กำลังส่ง…' : 'ส่งรหัส OTP' }}</button>
        </div>
        <div v-else class="space-y-3">
          <p class="text-xs text-stone-500">ส่งรหัสไปที่ {{ phone }} แล้ว รหัสใช้ได้ 5 นาที</p>
          <div>
            <label class="label" for="pre-code">รหัส OTP 6 หลัก</label>
            <input id="pre-code" v-model="code" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" class="input h-11 w-full" />
          </div>
          <div v-if="needConsent">
            <label class="label" for="pre-name">ชื่อผู้สั่ง</label>
            <input id="pre-name" v-model="name" type="text" autocomplete="name" maxlength="80" class="input h-11 w-full" />
            <label class="mt-2 flex items-start gap-2 text-sm"><input v-model="consent" type="checkbox" class="mt-1 h-4 w-4" /> ยินยอมให้ร้านเก็บและใช้ข้อมูลส่วนตัวเพื่อการสั่งสินค้า (นโยบายความเป็นส่วนตัว)</label>
          </div>
          <button type="button" class="btn-primary h-11 w-full" :disabled="busy || code.length !== 6" @click="verifyCode">{{ busy ? 'กำลังตรวจ…' : 'ยืนยัน' }}</button>
          <button type="button" class="btn-outline h-10 w-full text-sm" @click="otpSent = false; code = ''">เปลี่ยนเบอร์ / ส่งรหัสใหม่</button>
        </div>
        <p v-if="otpError" class="text-sm text-rose-700" role="alert">{{ otpError }}</p>
      </div>
      <div v-if="verified && !placed" class="card space-y-3 p-4" data-place>
        <p class="text-sm text-emerald-800">ยืนยันเบอร์แล้ว</p>
        <div v-if="fulfillment === 'delivery'" class="space-y-3">
          <div>
            <label class="label" for="pre-address">ที่อยู่จัดส่ง</label>
            <textarea id="pre-address" v-model="address" rows="3" maxlength="300" class="input w-full"></textarea>
          </div>
          <div>
            <label class="label" for="pre-province">จังหวัด</label>
            <input id="pre-province" v-model="province" type="text" maxlength="40" class="input h-11 w-full" />
          </div>
        </div>
        <div v-if="turnstileOn()" ref="captchaEl"></div>
        <button type="button" class="btn-primary h-11 w-full" :disabled="placing" @click="placeOrder">{{ placing ? 'กำลังสั่ง…' : 'ยืนยันสั่งสินค้า' }}</button>
        <p v-if="placeError" class="text-sm text-rose-700" role="alert">{{ placeError }}</p>
      </div>
      <div v-if="placed" class="card space-y-1 p-4 text-sm" data-placed>
        <div class="font-medium text-stone-900">สั่งสินค้าสำเร็จ รหัส {{ placed.code }}</div>
        <div>ยอดรวม {{ placed.total }} บาท · มัดจำ {{ placed.deposit }} บาท</div>
        <div class="text-xs text-stone-500">ชำระมัดจำภายในเวลาที่กำหนด (การชำระจะเปิดในขั้นถัดไป)</div>
      </div>
    </div>
  </section>
</template>
