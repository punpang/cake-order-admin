<script setup>
import { computed, onMounted, ref } from 'vue'
import { db, can, ensureOrders } from '../../data/store'
import { STATUS } from '../../lib/constants'
import { computeDashboard } from '../../lib/dashboardStats'
import { fetchPageViews } from '../../lib/pageViews'
import { shiftDay } from '../../lib/aiStats'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import ManageShell from '../../components/ManageShell.vue'

// ภาพรวมระบบหลังบ้าน: ตัวชี้วัดจากข้อมูลที่โหลดอยู่ + การเข้าชมหน้าเว็บลูกค้า (จากฐานข้อมูล ถ้าเปิดการนับแล้ว)
const now = ref(new Date())
const d = computed(() => computeDashboard({
  now: now.value,
  orders: db.orders,
  chats: can('chat') ? db.chats : null,
  quotes: db.quotes,
  photoRequests: db.photoRequests,
  reviews: db.reviews,
  deletionRequests: db.deletionRequests,
}))

const views = ref(null) // [{ day, n }] 7 วันล่าสุด
const viewsErr = ref('')
async function loadViews() {
  viewsErr.value = ''
  if (!supabaseEnabled) { views.value = null; viewsErr.value = 'ยังไม่ได้เชื่อมฐานข้อมูล จึงยังไม่มีการนับการเข้าชม'; return }
  try {
    const c = await getSupabase()
    const rows = await fetchPageViews(c, d.value.weekFrom, d.value.today)
    const map = Object.fromEntries(rows.map((r) => [r.day_key, Number(r.views) || 0]))
    views.value = Array.from({ length: 7 }, (_, i) => {
      const day = shiftDay(d.value.weekFrom, i)
      return { day, n: map[day] || 0 }
    })
  } catch {
    views.value = null
    viewsErr.value = 'ยังไม่ได้เปิดการนับการเข้าชม (รอติดตั้งฐานข้อมูล) หรือไม่มีสิทธิ์ดูสถิติ'
  }
}
onMounted(loadViews)
// ดึงเฉพาะที่แดชบอร์ดใช้ (แทนประวัติทั้งหมด): นัดรับวันนี้ (ทุกสถานะ) · ออร์เดอร์ 8 วันล่าสุด · ออร์เดอร์ก่อนหน้าของลูกค้ากลุ่มนั้น (ตัดสินว่าเป็นลูกค้าใหม่ไหม)
onMounted(async () => {
  const today = d.value.today
  ensureOrders({ pickupFrom: today, pickupTo: today })
  const since = new Date(Date.now() - 8 * 86400e3).toISOString()
  await ensureOrders({ createdSince: since })
  const ids = [...new Set(db.orders.filter((o) => o.customerId && String(o.createdAt || '') >= since).map((o) => o.customerId))].sort()
  for (let i = 0; i < ids.length; i += 100) ensureOrders({ customerIds: ids.slice(i, i + 100), createdBefore: since })
})

const viewsToday = computed(() => (views.value ? views.value[views.value.length - 1].n : null))
const views7 = computed(() => (views.value ? views.value.reduce((s, x) => s + x.n, 0) : null))
const maxView = computed(() => Math.max(1, ...(views.value || []).map((x) => x.n)))
const fmtDay = (s) => `${s.slice(8, 10)}/${s.slice(5, 7)}`

const statusRows = computed(() => Object.entries(d.value.orders.byStatus)
  .map(([k, n]) => ({ key: k, label: STATUS[k]?.label || k, n }))
  .sort((a, b) => b.n - a.n))
const pendingRows = computed(() => [
  { key: 'paymentReported', label: 'รอตรวจยอดโอน', n: d.value.pending.paymentReported },
  { key: 'quotes', label: 'ใบเสนอรอลูกค้าตอบ', n: d.value.pending.quotes },
  { key: 'photoRequests', label: 'คำขอไม่ให้ใช้รูปงาน', n: d.value.pending.photoRequests },
  { key: 'reviews', label: 'รีวิวรออนุมัติ', n: d.value.pending.reviews },
  { key: 'deletionRequests', label: 'คำขอลบข้อมูล', n: d.value.pending.deletionRequests },
])

function refresh() {
  now.value = new Date()
  loadViews()
}
</script>

<template>
  <ManageShell title="ภาพรวมระบบ" :subtitle="`ข้อมูล ณ วันที่ ${fmtDay(d.today)}`" perm="viewAllOrders" :toolbar="false">
    <div class="mb-3 flex justify-end">
      <button type="button" class="btn-outline h-10 px-3 text-sm" @click="refresh">รีเฟรช</button>
    </div>

    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <!-- การเข้าชมหน้าเว็บลูกค้า (ข้อมูลประกอบ ไว้ท้าย · ยังไม่มีข้อมูลย่อเหลือบรรทัดเดียว) -->
      <section class="card order-5 rounded-2xl" :class="views ? 'space-y-3' : 'py-3'">
        <h2 class="text-sm font-semibold text-stone-700">การเข้าชมหน้าเว็บลูกค้า</h2>
        <template v-if="views">
          <div class="flex items-end gap-6">
            <div><div class="text-xs text-stone-500">วันนี้</div><div class="text-3xl font-semibold text-stone-900">{{ viewsToday }}</div></div>
            <div><div class="text-xs text-stone-500">7 วันล่าสุด</div><div class="text-xl font-semibold text-stone-800">{{ views7 }}</div></div>
          </div>
          <div class="flex h-20 items-end gap-1" aria-label="กราฟการเข้าชม 7 วัน">
            <div v-for="x in views" :key="x.day" class="flex flex-1 flex-col items-center gap-1">
              <div class="w-full rounded-t bg-brand-400" :style="{ height: Math.max(4, Math.round((x.n / maxView) * 64)) + 'px' }" :title="`${fmtDay(x.day)}: ${x.n}`" />
              <span class="text-xs text-stone-500">{{ fmtDay(x.day) }}</span>
            </div>
          </div>
        </template>
        <p v-else class="text-xs text-stone-500">{{ viewsErr }}</p>
      </section>

      <!-- ลูกค้าในเพจ (Facebook) -->
      <section class="card order-4 space-y-3 rounded-2xl">
        <h2 class="text-sm font-semibold text-stone-700">ลูกค้าในเพจ (ทักแชท Facebook)</h2>
        <template v-if="d.chats">
          <div><div class="text-xs text-stone-500">ทั้งหมด</div><div class="text-3xl font-semibold text-stone-900">{{ d.chats.facebookTotal }}</div></div>
          <div class="text-sm text-stone-700">ทักใหม่ 7 วันล่าสุด <b>{{ d.chats.facebookNew7d }}</b> คน</div>
        </template>
        <p v-else class="text-sm text-stone-500">ไม่มีสิทธิ์ดูแชท</p>
      </section>

      <!-- แชทรอตอบ -->
      <section class="card order-2 space-y-3 rounded-2xl">
        <h2 class="text-sm font-semibold text-stone-700">แชทที่รอตอบ</h2>
        <template v-if="d.chats">
          <div><div class="text-xs text-stone-500">รวมทุกช่องทาง</div><div class="text-3xl font-semibold text-stone-900">{{ d.chats.awaitingReply }}</div></div>
          <div class="text-sm text-stone-700">Facebook {{ d.chats.awaitingFacebook }}</div>
        </template>
        <p v-else class="text-sm text-stone-500">ไม่มีสิทธิ์ดูแชท</p>
      </section>

      <!-- ออร์เดอร์ (งานวันนี้ อยู่บนสุด) -->
      <section class="card order-1 space-y-3 rounded-2xl">
        <h2 class="text-sm font-semibold text-stone-700">ออร์เดอร์ที่ยังไม่ปิด</h2>
        <div class="flex items-end gap-6">
          <div><div class="text-xs text-stone-500">ทั้งหมด</div><div class="text-3xl font-semibold text-stone-900">{{ d.orders.open }}</div></div>
          <div><div class="text-xs text-stone-500">นัดรับวันนี้</div><div class="text-xl font-semibold text-stone-800">{{ d.orders.pickupToday }}</div></div>
          <div><div class="text-xs text-stone-500">ลูกค้าใหม่ 7 วัน</div><div class="text-xl font-semibold text-stone-800">{{ d.orders.newCustomers7d }}</div></div>
        </div>
        <ul class="divide-y divide-stone-100 text-sm">
          <li v-for="r in statusRows" :key="r.key" class="flex justify-between py-1.5"><span class="text-stone-700">{{ r.label }}</span><b>{{ r.n }}</b></li>
          <li v-if="!statusRows.length" class="py-2 text-stone-400">ไม่มีออร์เดอร์ที่ยังไม่ปิด</li>
        </ul>
      </section>

      <!-- งานค้าง -->
      <section class="card order-3 space-y-3 rounded-2xl md:col-span-2 xl:col-span-3">
        <h2 class="text-sm font-semibold text-stone-700">งานค้างที่ต้องตรวจ</h2>
        <ul class="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
          <li v-for="r in pendingRows" :key="r.key" class="rounded-xl p-3" :class="r.n > 0 ? 'bg-amber-50 text-amber-900' : 'bg-stone-50 text-stone-500'">
            <div class="text-xs">{{ r.label }}</div>
            <div class="text-2xl font-semibold">{{ r.n }}</div>
          </li>
        </ul>
      </section>
    </div>

    <p class="mt-6 text-xs text-stone-400">
      ตัวเลขลูกค้าใหม่นับจากออร์เดอร์แรกของลูกค้า · การเข้าชมนับรวมต่อวันโดยไม่ระบุตัวตนผู้เข้าชม · แชทที่รอตอบนับรวมที่ยังมีข้อความค้าง
    </p>
  </ManageShell>
</template>
