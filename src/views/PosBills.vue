<script setup>
// บิล POS ที่ปิดแล้วย้อนหลัง · อ่านอย่างเดียว: ดูบิล · ใบเสร็จ · ใบกำกับภาษี (ไม่มีการคืนเงินหรือยกเลิกในหน้านี้)
import { computed, onMounted, ref, watch } from 'vue'
import { db, can } from '../data/store'
import { getSupabase } from '../lib/supabase'
import { loadOrdersInRange } from '../lib/ordersSync'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, toDateStr, orderNo } from '../lib/format'
import { closedPosBillsInRange } from '../lib/posBills'
import AppModal from '../components/AppModal.vue'
import Receipt from '../components/Receipt.vue'
import TaxInvoiceModal from '../components/TaxInvoiceModal.vue'

const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
const items = ref([])
const loading = ref(false)
const error = ref('')
const receipt = ref(null)
const taxFor = ref(null)
let seq = 0

async function load() {
  const my = ++seq
  loading.value = true
  error.value = ''
  const client = await getSupabase()
  let list = []
  if (!client) {
    // โหมดสาธิต (ไม่มีฐานข้อมูล): ใช้ข้อมูลในเครื่อง
    list = closedPosBillsInRange(db.orders, from.value, to.value)
  } else {
    const r = await loadOrdersInRange(client, { from: from.value, to: to.value, onlyPos: true })
    if (my !== seq) return
    if (r.error) {
      error.value = r.error
      items.value = []
      loading.value = false
      return
    }
    list = closedPosBillsInRange(r.items, from.value, to.value)
  }
  if (my !== seq) return
  items.value = list
  loading.value = false
}

// ปุ่มช่วงเวลาด่วน
function setRange(kind) {
  const now = new Date()
  const end = toDateStr(now)
  if (kind === 'today') { from.value = end; to.value = end }
  if (kind === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); from.value = toDateStr(d); to.value = end }
  if (kind === 'month') { from.value = toDateStr(new Date(now.getFullYear(), now.getMonth(), 1)); to.value = end }
}

const live = computed(() => items.value.filter((o) => o.status !== 'cancelled'))
const totalMoney = computed(() => live.value.reduce((s, o) => s + (orderTotals(o).total || 0), 0))
const cancelledCount = computed(() => items.value.length - live.value.length)
const taxable = (o) => can('taxInvoice') && o.status !== 'cancelled' && orderTotals(o).vat > 0

watch([from, to], () => load())
onMounted(() => load())
</script>

<template>
  <div class="mx-auto max-w-3xl space-y-4 px-4 py-4">
    <header class="flex flex-wrap items-center justify-between gap-2">
      <div>
        <h1 class="text-xl font-bold text-stone-900">บิล POS ที่ปิดแล้ว</h1>
        <p class="text-sm text-stone-500">ดูย้อนหลังทุกกะ · อ่านอย่างเดียว</p>
      </div>
      <RouterLink to="/admin/pos" class="btn-outline h-10 px-3 text-sm">← กลับ POS</RouterLink>
    </header>

    <section class="card space-y-3">
      <div class="flex flex-wrap gap-2">
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('today')">วันนี้</button>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('week')">7 วันล่าสุด</button>
        <button type="button" class="btn-outline h-9 px-3 text-sm" @click="setRange('month')">เดือนนี้</button>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <label class="block text-sm">
          <span class="mb-1 block text-stone-600">ตั้งแต่วันที่</span>
          <input v-model="from" type="date" class="input" aria-label="ตั้งแต่วันที่" />
        </label>
        <label class="block text-sm">
          <span class="mb-1 block text-stone-600">ถึงวันที่</span>
          <input v-model="to" type="date" :min="from" class="input" aria-label="ถึงวันที่" />
        </label>
      </div>
    </section>

    <section class="card grid grid-cols-2 gap-3 text-center sm:grid-cols-3">
      <div>
        <div class="text-xs text-stone-500">จำนวนบิล</div>
        <div class="text-lg font-bold tabular-nums">{{ live.length }}</div>
      </div>
      <div>
        <div class="text-xs text-stone-500">ยอดรวม (ไม่รวมยกเลิก)</div>
        <div class="text-lg font-bold tabular-nums">{{ money(totalMoney) }}</div>
      </div>
      <div>
        <div class="text-xs text-stone-500">ยกเลิก</div>
        <div class="text-lg font-bold tabular-nums">{{ cancelledCount }}</div>
      </div>
    </section>

    <section class="card">
      <p v-if="loading" class="py-8 text-center text-sm text-stone-500">กำลังโหลด…</p>
      <p v-else-if="error" class="py-8 text-center text-sm text-rose-700">โหลดบิลไม่สำเร็จ: {{ error }}</p>
      <p v-else-if="!items.length" class="py-8 text-center text-sm text-stone-500">ไม่มีบิลที่ปิดแล้วในช่วงวันที่นี้</p>
      <ul v-else class="divide-y divide-stone-100">
        <li v-for="o in items" :key="o.id" class="flex flex-wrap items-center gap-x-3 gap-y-2 py-3" :class="o.status === 'cancelled' ? 'opacity-60' : ''">
          <div class="min-w-0 flex-1 basis-48">
            <span class="block font-medium text-stone-900">{{ orderNo(o.code) }} <span class="text-xs font-normal text-stone-500">{{ dateTime(o.createdAt) }}</span></span>
            <span class="block truncate text-xs text-stone-500">{{ o.items.map((i) => `${i.name} ×${i.qty}`).join(', ') }}</span>
          </div>
          <span class="shrink-0 text-right text-sm">
            <b class="block text-stone-900">{{ money(orderTotals(o).total) }}</b>
            <span class="text-xs text-stone-500">{{ o.status === 'cancelled' ? 'ยกเลิกแล้ว' : (o.payments?.[0]?.method || '') }}</span>
          </span>
          <button type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="receipt = o">ใบเสร็จ</button>
          <button v-if="taxable(o)" type="button" class="btn-outline h-9 shrink-0 px-2.5 text-xs" @click="taxFor = o">ใบกำกับภาษี</button>
        </li>
      </ul>
    </section>

    <AppModal v-if="receipt" title="ใบเสร็จรับเงิน" @close="receipt = null">
      <Receipt :order="receipt" />
      <template #footer><button class="btn-primary flex-1 sm:flex-none" @click="receipt = null">ปิด</button></template>
    </AppModal>
    <TaxInvoiceModal v-if="taxFor" :order="taxFor" @close="taxFor = null" />
  </div>
</template>
