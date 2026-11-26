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

// ตารางผลิต: งานเรียงตามเวลาที่ต้องเสร็จ · งานที่เลยเวลาขึ้นบนสุด · แตะสรุปด้านบนเพื่อกรองตามสถานะ
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

// สถานะในครัว: รอเริ่ม / กำลังทำ / เสร็จ / รอชำระ (ยังไม่ถึงขั้นเตรียม)
function stateOf(o) {
  if (o.status === 'prepared') return 'done'
  if (o.status === 'preparing') return 'doing'
  if (['payment_confirmed', 'order_confirmed'].includes(o.status)) return 'todo'
  return 'unpaid'
}
// สีขอบซ้ายของการ์ดบอกสถานะ · เสร็จแล้วจางลง
const TONE = {
  todo: 'border-l-stone-300',
  doing: 'border-l-amber-400',
  done: 'border-l-emerald-500 opacity-60',
  unpaid: 'border-l-stone-200',
}
const toneOf = (o) => TONE[stateOf(o)]

const rows = computed(() =>
  inRange.value
    .filter((o) => picked.value.includes(o.status))
    .map((o) => {
      const due = dueAt(o)
      // ออร์เดอร์ที่เตรียมเสร็จแล้วไม่ขึ้นว่าเลยเวลา
      return { o, due, c: findCustomer(o.customerId), state: stateOf(o), late: o.status !== 'prepared' && due.getTime() < now.value }
    })
    .sort((a, b) => a.due - b.due),
)

// แถบสรุป: กดกลุ่มเพื่อดูเฉพาะกลุ่มนั้น กดซ้ำเพื่อดูทั้งหมด
const focus = ref(null)
const counts = computed(() => {
  const c = { todo: 0, doing: 0, done: 0, unpaid: 0, late: 0 }
  for (const r of rows.value) {
    c[r.state]++
    if (r.late) c.late++
  }
  return c
})
const CHIPS = [
  { key: 'todo', label: 'รอเริ่ม', dot: 'bg-stone-400' },
  { key: 'doing', label: 'กำลังทำ', dot: 'bg-amber-400' },
  { key: 'done', label: 'เสร็จแล้ว', dot: 'bg-emerald-500' },
  { key: 'late', label: 'เลยเวลา', dot: 'bg-rose-500' },
  { key: 'unpaid', label: 'รอชำระ', dot: 'bg-stone-300' },
]
const chips = computed(() => CHIPS.filter((c) => c.key !== 'unpaid' || counts.value.unpaid > 0))
const toggleFocus = (k) => { focus.value = focus.value === k ? null : k }
// กลุ่มที่เลือกไว้หายไป (เช่น รอชำระหมดแล้ว) → ไม่กรอง
const activeFocus = computed(() => (chips.value.some((c) => c.key === focus.value) ? focus.value : null))
const shown = computed(() =>
  rows.value.filter((r) => (!activeFocus.value ? true : activeFocus.value === 'late' ? r.late : r.state === activeFocus.value)),
)

// ส่วนแสดงผล: เลยเวลาแล้วก่อนเสมอ · ที่เหลือแบ่งตามวันและชั่วโมงที่ต้องเสร็จ
const sections = computed(() => {
  const out = []
  const late = shown.value.filter((r) => r.late)
  if (late.length) out.push({ key: 'late', late: true, rows: late })
  const map = new Map()
  for (const r of shown.value.filter((x) => !x.late)) {
    const day = toDateStr(r.due)
    const key = `${day} ${pad(r.due.getHours())}`
    if (!map.has(key)) map.set(key, { key, day, hour: `${pad(r.due.getHours())}:00`, rows: [] })
    map.get(key).rows.push(r)
  }
  return [...out, ...map.values()]
})
const showDay = (s, i) => !s.late && (i === 0 || sections.value[i - 1].late || sections.value[i - 1].day !== s.day)

// เลยกี่นาที (อย่างน้อย 1 นาที) · เกินชั่วโมงแสดงเป็นชั่วโมง
function lateText(r) {
  const m = Math.max(1, Math.floor((now.value - r.due.getTime()) / 60000))
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`
}

// รายการสินค้า: สรุปหนึ่งบรรทัดต่อชั้น · ข้อความบนเค้กไฮไลต์ · รายละเอียดเต็มพับไว้
const details = (it) => describeSelections(it, db.optionGroups)
const isTextGroup = (name) => db.optionGroups.some((g) => g.name === name && g.type === 'text')
function summaryOf(it) {
  const lines = new Map()
  const texts = []
  const tiered = details(it).some((d) => /^ชั้น \d+ · /.test(d.group))
  for (const d of details(it)) {
    const m = d.group.match(/^ชั้น (\d+) · (.+)$/)
    const name = m ? m[2] : d.group
    if (isTextGroup(name)) {
      texts.push({ label: name, value: d.value })
      continue
    }
    const tier = m ? `ชั้น ${m[1]}` : tiered ? 'ทั้งหมด' : ''
    lines.set(tier, [...(lines.get(tier) || []), d.value])
  }
  return { lines: [...lines].map(([tier, vals]) => ({ tier, text: vals.join(' · ') })), texts }
}

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

    <!-- แถบสรุป: แตะเพื่อกรอง แตะซ้ำเพื่อดูทั้งหมด -->
    <div class="no-print mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5" role="group" aria-label="สรุปตามสถานะ">
      <button
        v-for="c in chips"
        :key="c.key"
        type="button"
        class="flex min-h-14 flex-col items-start justify-center rounded-2xl bg-white px-3 py-2 text-left ring-1 transition"
        :class="activeFocus === c.key ? 'ring-2 ring-brand-500' : 'ring-stone-200'"
        :aria-pressed="activeFocus === c.key"
        @click="toggleFocus(c.key)"
      >
        <span class="flex items-center gap-1.5 text-xs font-medium text-stone-600"><span class="h-2 w-2 rounded-full" :class="c.dot"></span>{{ c.label }}</span>
        <span class="text-xl font-bold tabular-nums text-stone-900">{{ counts[c.key] }}</span>
      </button>
    </div>

    <div class="kitchen-print-area">
      <h2 class="mb-2 hidden text-base font-semibold text-stone-900 print:block">ตารางผลิต · {{ rangeText }}</h2>
      <p v-if="!sections.length" class="card py-10 text-center text-stone-500">{{ activeFocus ? 'ไม่มีออร์เดอร์ในกลุ่มนี้ · แตะสรุปอีกครั้งเพื่อดูทั้งหมด' : 'ไม่มีงานในช่วงนี้' }}</p>

      <template v-for="(s, si) in sections" :key="s.key">
        <h2 v-if="showDay(s, si)" class="sticky top-14 z-10 -mx-4 mt-5 mb-2 flex items-baseline gap-2 bg-cream/90 px-5 py-2 backdrop-blur first:mt-0">
          <span class="text-base font-semibold text-stone-900">{{ dayLabel(s.day) }}</span>
        </h2>
        <section class="mb-4">
          <div v-if="s.late" class="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-danger-700">
            <AppIcon name="alert" :size="16" /> เลยเวลาแล้ว
            <span class="ml-auto text-xs font-medium">{{ s.rows.length }} ออร์เดอร์</span>
          </div>
          <div v-else class="mb-2 flex items-center gap-2 px-1 text-xs font-semibold text-stone-500">
            <span>{{ s.hour }} น.</span>
            <span class="h-px flex-1 bg-stone-200"></span>
            <span class="font-medium text-stone-400">{{ s.rows.length }} ออร์เดอร์</span>
          </div>

          <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
            <article v-for="r in s.rows" :key="r.o.id" class="card overflow-hidden border-l-4 p-0 transition" :class="toneOf(r.o)">
              <!-- หัวการ์ดบรรทัดเดียว: เวลาเสร็จ · ชื่อ · รับที่ร้าน/จัดส่ง · ป้ายเลยเวลา -->
              <RouterLink :to="`/admin/orders/${r.o.id}`" class="flex items-center gap-3 px-4 pt-3 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none">
                <div class="flex w-16 shrink-0 flex-col items-center rounded-xl py-1.5" :class="r.late ? 'bg-danger-50 text-danger-700' : 'bg-stone-100 text-stone-800'">
                  <span class="text-[11px] leading-none font-medium">เสร็จ</span>
                  <span class="text-lg leading-tight font-bold tabular-nums">{{ hm(r.due) }}</span>
                </div>
                <div class="flex min-w-0 flex-1 items-center gap-2">
                  <span class="truncate font-semibold text-stone-900">{{ r.c?.name || 'ไม่ระบุชื่อ' }}</span>
                  <span class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-[11px] font-medium text-stone-600">{{ r.o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</span>
                </div>
                <span v-if="r.late" class="shrink-0 rounded-full bg-brand-600 px-2.5 py-1 text-xs font-semibold text-white">เลย {{ lateText(r) }}</span>
              </RouterLink>

              <ul class="space-y-3 px-4 py-3 text-sm">
                <li v-for="it in r.o.items" :key="it.id" class="space-y-1">
                  <div class="font-semibold break-words text-stone-900">{{ it.name }} × {{ it.qty }}</div>
                  <div v-for="line in summaryOf(it).lines" :key="line.tier + line.text" class="break-words text-stone-700">
                    <span v-if="line.tier" class="text-stone-400">{{ line.tier }}:</span> {{ line.text }}
                  </div>
                  <div v-for="t in summaryOf(it).texts" :key="t.label" class="rounded-lg bg-warning-50 px-2 py-1 text-xs break-words text-warning-800">
                    <span class="font-semibold">{{ t.label }}:</span> {{ t.value }}
                  </div>
                  <div v-if="it.note" class="rounded-lg bg-warning-50 px-2 py-1 text-xs break-words text-warning-800">
                    <span class="font-semibold">หมายเหตุ:</span> {{ it.note }}
                  </div>
                  <details v-if="details(it).length" class="text-xs">
                    <summary class="cursor-pointer py-1 font-medium text-brand-700">ดูรายละเอียด</summary>
                    <div class="space-y-0.5 pb-1 text-stone-600">
                      <div v-for="d in details(it)" :key="d.group" class="break-words"><span class="text-stone-400">{{ d.group }}:</span> {{ d.value }}</div>
                    </div>
                  </details>
                </li>
              </ul>

              <!-- ท้ายการ์ด: สถานะ · เลขออร์เดอร์ · ปุ่มขั้นตอนเต็มความกว้าง -->
              <div class="border-t border-stone-100 px-4 py-3">
                <div class="mb-2 flex items-center gap-2 text-xs text-stone-500">
                  <StatusBadge :status="r.o.status" />
                  <span class="truncate">{{ r.o.code }} · นัด {{ r.o.pickupAt.slice(11, 16) }}<span v-if="r.o.pickupAt.slice(0, 10) !== today"> · {{ dateOnly(r.o.pickupAt.slice(0, 10)) }}</span></span>
                </div>
                <button
                  v-if="actionOf(r.o)"
                  type="button"
                  class="no-print flex h-12 w-full items-center justify-center rounded-2xl text-base font-semibold text-white transition active:scale-[0.99]"
                  :class="actionOf(r.o).to === 'prepared' ? 'bg-success-700 hover:bg-success-700' : 'bg-brand-600 hover:bg-brand-700'"
                  @click="act(r)"
                >{{ actionOf(r.o).label }}</button>
              </div>
            </article>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>
