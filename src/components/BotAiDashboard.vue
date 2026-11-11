<script setup>
import { computed, onMounted, ref } from 'vue'
import { supabaseEnabled, getSupabase } from '../lib/supabase'
import { AI_STATUS_TH, fetchAiLog, summarizeAiLog, shiftDay, thaiDay } from '../lib/aiStats'

// แผงสถิติบอท AI: ใช้ไปวันนี้เทียบเพดาน · ผลรายวัน 7 วัน · รายการล่าสุด · อ่านจากบันทึก aiLog (ต้องมีสิทธิ์จัดการ)
const props = defineProps({ dailyLimit: { type: Number, default: 0 } })

const loading = ref(false)
const err = ref('')
const stats = ref(null)
const loadedAt = ref('')

const sinceIso = () => new Date(Date.now() - 9 * 86_400_000).toISOString() // เผื่อขอบเขตเวลาไทย

async function load() {
  err.value = ''
  if (!supabaseEnabled) { stats.value = null; err.value = 'ยังไม่ได้เชื่อมฐานข้อมูล จึงยังไม่มีสถิติจากเซิร์ฟเวอร์'; return }
  loading.value = true
  try {
    const client = await getSupabase()
    const rows = await fetchAiLog(client, { sinceIso: sinceIso() })
    stats.value = summarizeAiLog(rows, { days: 7, recentLimit: 30 })
    loadedAt.value = new Date().toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
  } catch {
    stats.value = null
    err.value = 'โหลดสถิติไม่ได้ (ต้องมีสิทธิ์จัดการ หรือเชื่อมต่อฐานข้อมูลไม่สำเร็จ)'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const limit = computed(() => Math.max(0, Math.round(Number(props.dailyLimit) || 0)))
const usedPct = computed(() => {
  if (!stats.value || !limit.value) return 0
  return Math.min(100, Math.round((stats.value.today.used / limit.value) * 100))
})
const fmtDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const fmtTime = (iso) => new Date(iso).toLocaleString('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const statusClass = { ok: 'bg-emerald-100 text-emerald-700', handoff: 'bg-amber-100 text-amber-700', error: 'bg-rose-100 text-rose-700', limit: 'bg-stone-200 text-stone-600' }
const today = computed(() => thaiDay(new Date().toISOString()))
const weekFrom = computed(() => (stats.value ? stats.value.byDay[0].day : shiftDay(today.value, -6)))
</script>

<template>
  <div class="space-y-3 rounded-xl border border-violet-200 bg-white p-3">
    <div class="flex items-center justify-between gap-2">
      <h4 class="font-semibold text-stone-900">สถิติการใช้งานบอท AI</h4>
      <button type="button" class="btn-outline h-8 px-3 text-xs" :disabled="loading" @click="load">{{ loading ? 'กำลังโหลด…' : 'รีเฟรช' }}</button>
    </div>
    <p v-if="err" class="text-sm text-amber-700">{{ err }}</p>

    <template v-if="stats">
      <!-- วันนี้ -->
      <div class="space-y-2 rounded-lg bg-violet-50/50 p-3">
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <div class="text-sm text-stone-700">
            ใช้ไปวันนี้ <span class="text-lg font-semibold text-stone-900">{{ stats.today.used }}</span>
            <span v-if="limit"> / {{ limit }} ครั้ง</span>
            <span v-else class="text-stone-500"> (เพดาน 0 = ไม่เรียกโมเดล)</span>
          </div>
          <div class="text-xs text-stone-500">เวลาตอบเฉลี่ย {{ stats.avgMs != null ? `${(stats.avgMs / 1000).toFixed(1)} วินาที` : '—' }}</div>
        </div>
        <div v-if="limit" class="h-2 w-full overflow-hidden rounded-full bg-stone-200" role="progressbar" :aria-valuenow="usedPct" aria-valuemin="0" aria-valuemax="100">
          <div class="h-full rounded-full bg-violet-500" :style="{ width: usedPct + '%' }" />
        </div>
        <div class="grid grid-cols-2 gap-2 text-center text-xs sm:grid-cols-4">
          <div class="rounded-lg bg-white p-2"><div class="text-stone-500">{{ AI_STATUS_TH.ok }}</div><div class="text-base font-semibold text-emerald-700">{{ stats.today.ok }}</div></div>
          <div class="rounded-lg bg-white p-2"><div class="text-stone-500">{{ AI_STATUS_TH.handoff }}</div><div class="text-base font-semibold text-amber-700">{{ stats.today.handoff }}</div></div>
          <div class="rounded-lg bg-white p-2"><div class="text-stone-500">{{ AI_STATUS_TH.error }}</div><div class="text-base font-semibold text-rose-700">{{ stats.today.error }}</div></div>
          <div class="rounded-lg bg-white p-2"><div class="text-stone-500">{{ AI_STATUS_TH.limit }}</div><div class="text-base font-semibold text-stone-600">{{ stats.today.limit }}</div></div>
        </div>
      </div>

      <!-- 7 วันล่าสุด -->
      <div>
        <div class="mb-1 text-xs font-medium text-stone-500">7 วันล่าสุด ({{ fmtDay(weekFrom) }} – {{ fmtDay(today) }})</div>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-xs">
            <thead class="text-stone-500">
              <tr><th class="py-1 font-medium">วันที่</th><th class="py-1 text-right font-medium">ตอบแล้ว</th><th class="py-1 text-right font-medium">ส่งต่อ</th><th class="py-1 text-right font-medium">ผิดพลาด</th><th class="py-1 text-right font-medium">ครบเพดาน</th><th class="py-1 text-right font-medium">รวม</th></tr>
            </thead>
            <tbody class="divide-y divide-stone-100">
              <tr v-for="d in stats.byDay" :key="d.day" :class="d.day === today ? 'font-semibold text-stone-900' : 'text-stone-700'">
                <td class="py-1">{{ fmtDay(d.day) }}{{ d.day === today ? ' (วันนี้)' : '' }}</td>
                <td class="py-1 text-right">{{ d.ok }}</td>
                <td class="py-1 text-right">{{ d.handoff }}</td>
                <td class="py-1 text-right">{{ d.error }}</td>
                <td class="py-1 text-right">{{ d.limit }}</td>
                <td class="py-1 text-right">{{ d.total }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- รายการล่าสุด -->
      <div>
        <div class="mb-1 text-xs font-medium text-stone-500">รายการล่าสุด 30 รายการ</div>
        <p v-if="!stats.recent.length" class="py-3 text-center text-sm text-stone-400">ยังไม่มีการเรียกบอท AI</p>
        <ul v-else class="divide-y divide-stone-100">
          <li v-for="r in stats.recent" :key="r.id" class="py-2 text-xs">
            <div class="flex flex-wrap items-center gap-2">
              <span class="text-stone-500">{{ fmtTime(r.at) }}</span>
              <span class="rounded-full px-2 py-0.5 font-medium" :class="statusClass[r.status]">{{ AI_STATUS_TH[r.status] }}</span>
              <span v-if="r.model" class="text-stone-400">{{ r.model }}</span>
              <span v-if="r.ms != null" class="text-stone-400">{{ (r.ms / 1000).toFixed(1) }} วิ</span>
            </div>
            <p class="mt-1 whitespace-pre-line text-stone-700">{{ r.customer || '—' }}</p>
          </li>
        </ul>
      </div>

      <p class="text-xs text-stone-400">
        อัปเดตเมื่อ {{ loadedAt }} · ข้อความลูกค้าในบันทึกผ่านการตัดข้อมูลส่วนตัวแล้ว และตัดให้เหลือ 200 ตัวอักษร · บันทึกไม่มีจำนวนโทเคนหรือค่าใช้จ่าย ดูยอดได้ที่ผู้ให้บริการ AI
      </p>
    </template>
  </div>
</template>
