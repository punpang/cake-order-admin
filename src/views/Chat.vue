<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, can, findCustomer, findChat, chatOf } from '../data/store'
import { formatPhone, phoneDigits, timeOnly, dateOnly, toDateStr } from '../lib/format'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import ChatThread from '../components/ChatThread.vue'

// แชทกับลูกค้า (จำลองในเครื่อง): ซ้าย = รายการแชท, ขวา = เธรด (มือถือแสดงทีละหน้า)
const router = useRouter()
const props = defineProps({ id: { type: String, default: '' } })
const current = computed(() => (props.id ? findChat(props.id) : null))
const customer = computed(() => (current.value ? findCustomer(current.value.customerId) : null))

const q = ref('')
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  const d = phoneDigits(s)
  return db.chats.filter((c) => {
    if (!s) return true
    const cu = findCustomer(c.customerId)
    return cu?.name.toLowerCase().includes(s) || (d && cu?.phone?.includes(d))
  })
})
const last = (c) => {
  const m = c.messages[c.messages.length - 1]
  if (!m) return { text: 'ยังไม่มีข้อความ', at: c.updatedAt }
  return { text: m.kind === 'order' ? 'สรุปออร์เดอร์' : `${m.from === 'staff' ? 'คุณ: ' : ''}${m.text}`, at: m.at }
}
const whenText = (at) => (at.slice(0, 10) === toDateStr(new Date()) ? timeOnly(at) : dateOnly(at))

// ออร์เดอร์ที่ยังไม่ปิดของลูกค้า
const openOrders = computed(() =>
  customer.value ? db.orders.filter((o) => o.customerId === customer.value.id && o.channel !== 'pos' && !['delivered', 'cancelled'].includes(o.status)) : [],
)
const ordersOpen = ref(false)

// เริ่มแชทกับลูกค้า
const pickOpen = ref(false)
const pq = ref('')
const pickList = computed(() => {
  const s = pq.value.trim().toLowerCase()
  const d = phoneDigits(s)
  return db.customers.filter((c) => c.active !== false && (!s || c.name.toLowerCase().includes(s) || (d && c.phone?.includes(d)))).slice(0, 30)
})
function startWith(c) {
  pickOpen.value = false
  router.push(`/chat/${chatOf(c.id).id}`)
}
</script>

<template>
  <div v-if="!can('chat')" class="card py-10 text-center text-stone-500">บทบาทนี้ใช้แชทไม่ได้</div>

  <div v-else class="mx-auto max-w-5xl">
    <div class="grid min-h-[420px] grid-cols-1 overflow-hidden rounded-2xl border border-stone-200 bg-white md:h-[calc(100dvh-9rem)] md:grid-cols-[300px_1fr]"
      :class="current ? 'h-[calc(100dvh-9rem)]' : 'h-[calc(100dvh-12.5rem)]'">
      <!-- รายการแชท -->
      <aside class="flex min-h-0 flex-col border-stone-200 md:border-r" :class="current ? 'hidden md:flex' : 'flex'">
        <div class="flex items-center gap-2 border-b border-stone-200 p-3">
          <h1 class="flex-1 text-lg font-semibold text-stone-900">แชท</h1>
          <button type="button" class="btn-soft h-9 px-3" @click="pickOpen = true; pq = ''"><AppIcon name="plus" :size="16" /> เริ่มแชท</button>
        </div>
        <div class="border-b border-stone-200 p-2">
          <label class="relative block">
            <span class="sr-only">ค้นหาแชท</span>
            <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input h-10 pl-9" placeholder="ค้นหาชื่อ / เบอร์" />
          </label>
        </div>
        <ul class="min-h-0 flex-1 overflow-y-auto">
          <li v-if="!list.length" class="p-6 text-center text-sm text-stone-400">ยังไม่มีแชท</li>
          <li v-for="c in list" :key="c.id">
            <RouterLink :to="`/chat/${c.id}`" class="flex items-center gap-3 border-b border-stone-100 px-3 py-3 hover:bg-stone-50" :class="current?.id === c.id ? 'bg-brand-50' : ''">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">{{ (findCustomer(c.customerId)?.name || '?').replace(/^คุณ/, '').trim().charAt(0) }}</span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ findCustomer(c.customerId)?.name }}</span>
                  <span class="shrink-0 text-[11px] text-stone-400">{{ whenText(last(c).at) }}</span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm" :class="c.unreadStaff ? 'font-medium text-stone-900' : 'text-stone-500'">{{ last(c).text }}</span>
                  <span v-if="c.unreadStaff" class="shrink-0 rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{{ c.unreadStaff }}</span>
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </aside>

      <!-- เธรด -->
      <section v-if="current" class="flex min-h-0 flex-col bg-stone-50">
        <div class="flex items-center gap-2 border-b border-stone-200 bg-white p-2.5">
          <RouterLink to="/chat" class="flex h-9 w-9 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 md:hidden" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
          <div class="min-w-0 flex-1">
            <div class="truncate font-semibold text-stone-900">{{ customer?.name }}</div>
            <div class="truncate text-xs text-stone-500">{{ customer?.phone ? formatPhone(customer.phone) : '' }}<template v-if="customer?.line"> · LINE {{ customer.line }}</template></div>
          </div>
          <button v-if="openOrders.length" type="button" class="btn-outline h-9 px-3 text-sm" @click="ordersOpen = true">ออร์เดอร์ {{ openOrders.length }}</button>
          <RouterLink v-if="can('createOrder')" :to="`/orders/new?customer=${current.customerId}&chat=${current.id}`" class="btn-primary h-9 px-3 text-sm"><AppIcon name="plus" :size="16" /> <span class="hidden sm:inline">สร้างออร์เดอร์</span><span class="sm:hidden">ออร์เดอร์</span></RouterLink>
        </div>
        <ChatThread :key="current.id" :chat="current" side="staff" class="min-h-0 flex-1" />
      </section>
      <section v-else class="hidden items-center justify-center bg-stone-50 text-sm text-stone-400 md:flex">เลือกแชททางซ้าย</section>
    </div>
    <p class="mt-2 text-center text-xs text-stone-400">จำลองในเครื่อง · ลองแชทฝั่งลูกค้าได้ที่ จัดการ → หน้าลูกค้า (จำลอง) → แท็บแชท</p>

    <!-- ออร์เดอร์ของลูกค้า -->
    <AppModal v-if="ordersOpen" title="ออร์เดอร์ที่ยังไม่ปิด" @close="ordersOpen = false">
      <div class="space-y-2">
        <RouterLink v-for="o in openOrders" :key="o.id" :to="`/orders/${o.id}`" class="flex items-center justify-between gap-2 rounded-xl border border-stone-200 p-3 hover:border-brand-300">
          <span class="min-w-0">
            <span class="block font-medium text-stone-900">{{ o.code }}</span>
            <span class="block truncate text-xs text-stone-500">{{ o.items[0]?.name }}</span>
          </span>
          <AppIcon name="next" class="text-stone-300" />
        </RouterLink>
      </div>
    </AppModal>

    <!-- เริ่มแชท -->
    <AppModal v-if="pickOpen" title="เริ่มแชทกับลูกค้า" @close="pickOpen = false">
      <input v-model="pq" type="search" class="input mb-3" placeholder="ค้นหาชื่อ / เบอร์" />
      <div class="space-y-1.5">
        <button v-for="c in pickList" :key="c.id" type="button" class="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200 p-3 text-left hover:border-brand-300" @click="startWith(c)">
          <span class="min-w-0">
            <span class="block truncate font-medium text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">{{ c.phone ? formatPhone(c.phone) : '-' }}</span>
          </span>
          <AppIcon name="chat" class="text-stone-400" />
        </button>
      </div>
    </AppModal>
  </div>
</template>
