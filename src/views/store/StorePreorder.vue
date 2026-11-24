<script setup>
// สั่งล่วงหน้า (ลูกค้า) · ขั้นที่ 1: เลือกแคมเปญ → เลือกสินค้า วันรับ วิธีรับ → ดูราคา (คิดที่เซิร์ฟเวอร์)
// ขั้น OTP และการสร้างออร์เดอร์อยู่ในขั้นถัดไป
import { computed, onMounted, reactive, ref } from 'vue'
import { callPreorder } from '../../lib/preorderRemote'

const campaigns = ref([])
const loading = ref(true)
const error = ref('')
const chosen = ref(null)
const pickup = ref('')
const fulfillment = ref('pickup')
const qty = reactive({})
const quote = ref(null)
const quoteError = ref('')

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
}

onMounted(load)
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

      <button type="button" class="btn-primary h-11 w-full" @click="seeQuote">ดูราคา</button>
      <p v-if="quoteError" class="text-sm text-rose-700" role="alert">{{ quoteError }}</p>
      <div v-if="quote" class="card p-4 text-sm" data-quote>
        <div>ยอดรวม {{ quote.total }} บาท</div>
        <div v-if="quote.shippingFee">ค่าส่งพัสดุ {{ quote.shippingFee }} บาท</div>
      </div>
    </div>
  </section>
</template>
