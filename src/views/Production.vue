<script setup>
import ThaiDateField from '../components/ThaiDateField.vue'
import DatePresets from '../components/DatePresets.vue'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { db, can, findCustomer, dueAt, setStatus } from '../data/store'
import { MATERIAL_STATUSES, STATUS } from '../lib/constants'
import { describeSelections } from '../lib/pricing'
import { toDateStr, pad, dayLabel, dateOnly, formatPhone } from '../lib/format'
import { askConfirmEx } from '../lib/confirm'
import { showToast } from '../lib/toast'
import { toastSaved } from '../lib/syncStatus'
import { smsChoice } from '../lib/smsChoice'
import { printKitchen } from '../lib/printKitchen'
import { isNative } from '../lib/nativeDevices'
import StatusBadge from '../components/StatusBadge.vue'
import KitchenTabs from '../components/KitchenTabs.vue'
import AppIcon from '../components/AppIcon.vue'

// ตารางผลิต: จัดกลุ่มตามชั่วโมงที่ต้องทำเสร็จ (เวลานัด − เวลาเผื่อในตั้งค่าร้าน) ช่วงวันนับจากวันนัดรับ
const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
const showFilter = ref(false) // ตัวกรองละเอียด (พับไว้ก่อน)
const rangeText = computed(() => (from.value === to.value ? dateOnly(from.value) : `${dateOnly(from.value)} – ${dateOnly(to.value)}`))
function setFrom(v) {
  from.value = v
  if (to.value < v) to.value = v
}

const picked = ref([...MATERIAL_STATUSES])
function toggle(s) {
  const i = picked.value.indexOf(s)
  if (i >= 0) picked.value.splice(i, 1)
  else picked.value.push(s)
}

const inRange = computed(() =>
  db.orders.filter((o) => {
    const day = o.pickupAt.slice(0, 10)
    return MATERIAL_STATUSES.includes(o.status) && day >= from.value && day <= to.value
  }),
)
const countOf = (s) => inRange.value.filter((o) => o.status === s).length

// เวลาปัจจุบันของป้าย "เลยเวลา" · อัปเดตทุกนาที (ไม่งั้นป้ายจะค้างจนกว่าออร์เดอร์จะเปลี่ยน)
const now = ref(Date.now())
let tick = null
onMounted(() => { tick = setInterval(() => { now.value = Date.now() }, 60_000) })
onUnmounted(() => clearInterval(tick))

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const rows = computed(() =>
  inRange.value
    .filter((o) => picked.value.includes(o.status))
    .map((o) => {
      const due = dueAt(o)
      // ออร์เดอร์ที่เตรียมเสร็จแล้วไม่ขึ้นว่าเลยเวลา
      return { o, due, c: findCustomer(o.customerId), late: o.status !== 'prepared' && due.getTime() < now.value }
    })
    .sort((a, b) => a.due - b.due),
)

// กลุ่ม: วัน (ของเวลาที่ต้องเสร็จ) > ชั่วโมง
const groups = computed(() => {
  const map = new Map()
  for (const r of rows.value) {
    const day = toDateStr(r.due)
    const key = `${day} ${pad(r.due.getHours())}`
    if (!map.has(key)) map.set(key, { key, day, hour: `${pad(r.due.getHours())}:00`, rows: [] })
    map.get(key).rows.push(r)
  }
  return [...map.values()]
})
const showDay = (g, i) => i === 0 || groups.value[i - 1].day !== g.day
const details = (it) => describeSelections(it, db.optionGroups)

// ปุ่มเปลี่ยนสถานะ = สถานะเดียวกับหน้าออร์เดอร์ (เริ่มเตรียม → เตรียมเสร็จ) ตามสิทธิ์ของผู้ใช้
const STEP = {
  preparing: { label: 'เริ่มเตรียม', text: 'เริ่มเตรียมสินค้า', perm: 'startPreparing' },
  prepared: { label: 'เตรียมเสร็จ', text: 'เตรียมสินค้าเสร็จแล้ว', perm: 'markPrepared' },
}
function actionOf(o) {
  const next = ['payment_confirmed', 'order_confirmed'].includes(o.status) ? 'preparing' : o.status === 'preparing' ? 'prepared' : null
  return next && can(STEP[next].perm) ? { to: next, ...STEP[next] } : null
}
// กล่องยืนยันเหมือนหน้าออร์เดอร์ (ติ๊กแจ้งลูกค้า/SMS ไว้ตามค่าเริ่มต้น) · ไม่ติ๊ก = ไม่ส่งข้อความถึงลูกค้า
async function act(r) {
  const a = actionOf(r.o)
  if (!a) return
  const c = r.c
  const tells = !!c && r.o.channel !== 'pos'
  const ok = await askConfirmEx({
    title: a.label, message: `ออร์เดอร์ ${r.o.code}`, okText: a.label,
    ...(tells ? { checkbox: { label: 'แจ้งลูกค้า', hint: 'ไม่ติ๊ก = ไม่ส่งข้อความถึงลูกค้า (ทีมยังได้รับตามปกติ)', value: true } } : {}),
    ...(tells && smsChoice(c) ? { checkbox2: { label: 'ส่ง SMS ด้วย', hint: formatPhone(c.phone), value: true } } : {}),
  })
  if (!ok.ok) return
  const sr = setStatus(r.o, a.to, a.text, { notify: tells ? ok.checked : true, sms: ok.checked2 !== false })
  if (sr?.error) return showToast(sr.error, 6000)
  toastSaved(`${a.label} แล้ว · ${r.o.code}`)
}
</script>

<template>
  <div v-if="!can('viewMaterials')" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="user" :size="28" /></span>
    <div class="font-semibold text-stone-800">เฉพาะแอดมินและคนทำเค้ก</div>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else>
    <KitchenTabs />
    <h1 class="page-title mb-4">ตารางผลิต</h1>

    <section class="card mb-4 space-y-3" aria-label="ตัวกรอง">
      <!-- แถวสรุป + ปุ่มลัด (ตัวกรองละเอียดพับไว้: คนครัวเห็นงานวันนี้ได้ทันทีโดยไม่ต้องเลื่อน) -->
      <div class="flex items-center gap-2">
        <p class="min-w-0 flex-1 text-sm text-stone-600">{{ rangeText }} · สถานะ {{ picked.length }}/{{ MATERIAL_STATUSES.length }}</p>
        <button v-if="!isNative()" type="button" class="btn-outline h-10 shrink-0 px-3 text-sm" @click="printKitchen">พิมพ์</button>
        <button type="button" class="btn-outline h-10 shrink-0 px-3 text-sm" :aria-expanded="showFilter" aria-controls="kitchen-filter" @click="showFilter = !showFilter"><AppIcon name="filter" :size="16" /> {{ showFilter ? 'ซ่อนตัวกรอง' : 'ตัวกรอง' }}</button>
      </div>
      <DatePresets :from="from" :to="to" :presets="['today', 'tomorrow', 'next7']" @set="([f, t]) => { from = f; to = t }" />
      <div v-show="showFilter" id="kitchen-filter" class="space-y-3 border-t border-stone-100 pt-3">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="label">ตั้งแต่วันที่</label><ThaiDateField :model-value="from" label="ตั้งแต่วันที่" @update:model-value="setFrom" /></div>
          <div><label class="label">ถึงวันที่</label><ThaiDateField v-model="to" :min="from" label="ถึงวันที่" /></div>
        </div>
        <div>
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div class="label mb-0">สถานะออร์เดอร์ <span class="font-normal text-stone-500">· เลือก {{ picked.length }}/{{ MATERIAL_STATUSES.length }}</span></div>
            <button type="button" class="h-9 rounded-lg px-2 text-sm font-medium text-brand-700 underline" @click="picked = picked.length === MATERIAL_STATUSES.length ? [] : [...MATERIAL_STATUSES]">{{ picked.length === MATERIAL_STATUSES.length ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด' }}</button>
          </div>
          <div class="flex flex-wrap gap-2">
            <button v-for="s in MATERIAL_STATUSES" :key="s" type="button" class="chip" :class="picked.includes(s) ? 'chip-on' : 'chip-off'" :aria-pressed="picked.includes(s)" @click="toggle(s)">
              <span v-if="picked.includes(s)" aria-hidden="true">✓</span>
              <span v-else class="h-2 w-2 rounded-full" :class="STATUS[s].dot"></span>
              {{ STATUS[s].label }} ({{ countOf(s) }})
            </button>
          </div>
        </div>
        <p class="text-xs text-stone-500">นับจากวันนัดรับ · ต้องเสร็จก่อนนัด: รับที่ร้าน {{ db.shop.leadPickup }} นาที / จัดส่ง {{ db.shop.leadDelivery }} นาที</p>
      </div>
    </section>

    <div class="kitchen-print-area">
      <h2 class="mb-2 hidden text-base font-semibold text-stone-900 print:block">ตารางผลิต · {{ rangeText }}</h2>
      <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีงานในช่วงนี้</p>

      <template v-for="(g, gi) in groups" :key="g.key">
        <h2 v-if="showDay(g, gi)" class="sticky top-14 z-10 -mx-4 mt-5 mb-2 flex items-baseline gap-2 bg-cream/90 px-5 py-2 backdrop-blur first:mt-0">
          <span class="text-base font-semibold text-stone-900">{{ dayLabel(g.day) }}</span>
        </h2>
        <section class="mb-4">
          <div class="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-brand-800">
            <AppIcon name="clock" :size="16" /> ต้องเสร็จช่วง {{ g.hour }} น.
            <span class="ml-auto text-xs font-medium text-stone-400">{{ g.rows.length }} ออร์เดอร์</span>
          </div>
          <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <div v-for="r in g.rows" :key="r.o.id" class="card p-3.5 transition hover:border-brand-300" :class="[r.late ? 'border-rose-300' : '', r.o.status === 'prepared' ? 'opacity-60' : '']">
              <RouterLink :to="`/admin/orders/${r.o.id}`" class="block rounded-lg focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none">
                <div class="flex items-start gap-3">
                  <div class="flex w-16 shrink-0 flex-col items-center rounded-xl py-2" :class="r.late ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-800'">
                    <span class="text-xs font-medium">เสร็จก่อน</span>
                    <span class="text-base leading-tight font-semibold tabular-nums">{{ hm(r.due) }}</span>
                  </div>
                  <div class="min-w-0 flex-1">
                    <div class="flex items-start justify-between gap-2">
                      <div class="min-w-0">
                        <div class="truncate font-semibold text-stone-900">{{ r.c?.name }}</div>
                        <div class="text-xs text-stone-500">{{ r.o.code }} · นัด {{ r.o.pickupAt.slice(11, 16) }} · {{ r.o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
                      </div>
                      <StatusBadge :status="r.o.status" />
                    </div>
                    <div v-if="r.late" class="mt-1 text-xs font-semibold text-rose-700">เลยเวลาที่ต้องเสร็จแล้ว</div>
                  </div>
                </div>
                <ul class="mt-3 space-y-2 border-t border-stone-100 pt-3 text-sm">
                  <li v-for="it in r.o.items" :key="it.id">
                    <div class="font-medium break-words text-stone-900">{{ it.name }} × {{ it.qty }}</div>
                    <div v-for="d in details(it)" :key="d.group" class="text-xs break-words text-stone-600"><span class="text-stone-400">{{ d.group }}:</span> {{ d.value }}</div>
                    <div v-if="it.note" class="text-xs break-words text-stone-600"><span class="text-stone-400">หมายเหตุ:</span> {{ it.note }}</div>
                  </li>
                </ul>
              </RouterLink>
              <div v-if="actionOf(r.o)" class="no-print mt-3 flex justify-end border-t border-stone-100 pt-3">
                <button type="button" class="btn-primary h-11 px-5 text-sm" @click="act(r)">{{ actionOf(r.o).label }}</button>
              </div>
            </div>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
