<script setup>
import { computed, ref } from 'vue'
import { db, can, findCustomer, dueAt } from '../data/store'
import { MATERIAL_STATUSES, STATUS } from '../lib/constants'
import { describeSelections } from '../lib/pricing'
import { toDateStr, pad, dayLabel, dateOnly } from '../lib/format'
import StatusBadge from '../components/StatusBadge.vue'
import KitchenTabs from '../components/KitchenTabs.vue'
import AppIcon from '../components/AppIcon.vue'

// ตารางผลิต: จัดกลุ่มตามชั่วโมงที่ต้องทำเสร็จ (เวลานัด − เวลาเผื่อในตั้งค่าร้าน) ช่วงวันนับจากวันนัดรับ
const today = toDateStr(new Date())
const from = ref(today)
const to = ref(today)
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

const hm = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const rows = computed(() =>
  inRange.value
    .filter((o) => picked.value.includes(o.status))
    .map((o) => {
      const due = dueAt(o)
      return { o, due, c: findCustomer(o.customerId), late: due < new Date() }
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
</script>

<template>
  <div v-if="!can('viewMaterials')" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-stone-100 text-stone-400"><AppIcon name="user" :size="28" /></span>
    <div class="font-semibold text-stone-800">เฉพาะแอดมินและคนทำเค้ก</div>
    <RouterLink to="/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else class="mx-auto max-w-4xl">
    <KitchenTabs />
    <h1 class="mb-4 text-xl font-semibold tracking-tight text-stone-900">ตารางผลิต</h1>

    <section class="card mb-4 space-y-3">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">ตั้งแต่วันที่</label><input :value="from" type="date" class="input" @input="setFrom($event.target.value)" /></div>
        <div><label class="label">ถึงวันที่</label><input v-model="to" type="date" :min="from" class="input" /></div>
      </div>
      <div>
        <div class="label">สถานะออร์เดอร์</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="s in MATERIAL_STATUSES" :key="s" type="button" class="chip" :class="picked.includes(s) ? 'chip-on' : 'chip-off'" @click="toggle(s)">
            <span class="h-2 w-2 rounded-full" :class="STATUS[s].dot"></span>
            {{ STATUS[s].label }} ({{ countOf(s) }})
          </button>
        </div>
      </div>
      <p class="text-xs text-stone-500">นับจากวันนัดรับ · ต้องเสร็จก่อนนัด: รับที่ร้าน {{ db.shop.leadPickup }} นาที / จัดส่ง {{ db.shop.leadDelivery }} นาที</p>
    </section>

    <p v-if="!rows.length" class="card py-10 text-center text-stone-500">ไม่มีงานในช่วงนี้</p>

    <template v-for="(g, gi) in groups" :key="g.key">
      <h2 v-if="showDay(g, gi)" class="sticky top-14 z-10 -mx-4 mt-5 mb-2 flex items-baseline gap-2 bg-cream/90 px-5 py-2 backdrop-blur first:mt-0">
        <span class="text-base font-semibold text-stone-900">{{ dayLabel(g.day) }}</span>
        <span v-if="dayLabel(g.day) !== dateOnly(g.day)" class="text-sm text-stone-500">{{ dateOnly(g.day) }}</span>
      </h2>
      <section class="mb-4">
        <div class="mb-2 flex items-center gap-2 px-1 text-sm font-semibold text-brand-800">
          <AppIcon name="clock" :size="16" /> ต้องเสร็จช่วง {{ g.hour }} น.
          <span class="ml-auto text-xs font-medium text-stone-400">{{ g.rows.length }} ออร์เดอร์</span>
        </div>
        <div class="grid grid-cols-1 gap-2.5 lg:grid-cols-2">
          <RouterLink v-for="r in g.rows" :key="r.o.id" :to="`/orders/${r.o.id}`" class="card block p-3.5 transition hover:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.99]" :class="r.late ? 'border-rose-300' : ''">
            <div class="flex items-start gap-3">
              <div class="flex w-16 shrink-0 flex-col items-center rounded-xl py-2" :class="r.late ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-800'">
                <span class="text-[10px] font-medium">เสร็จก่อน</span>
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
                <div v-if="r.late" class="mt-1 text-xs font-semibold text-rose-600">เลยเวลาที่ต้องเสร็จแล้ว</div>
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
        </div>
      </section>
    </template>
  </div>
</template>
