<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { db, can, findCustomer, findChat, draftOf, hasDraft, clearDraft, linkChat, createCustomerFromChat, receiveMessage, fbWindowLeft } from '../data/store'
import OrderCreate from './OrderCreate.vue'
import { formatPhone, phoneDigits, phoneValid, timeOnly, dateOnly, toDateStr } from '../lib/format'
import PhoneInput from '../components/PhoneInput.vue'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import ChatThread from '../components/ChatThread.vue'
import { setChatFastPoll } from '../lib/staffAuth'
import { messagePreview } from '../lib/chatMedia'
import { kb } from '../lib/viewportFit'
import { suggestCustomers, phonesInChat } from '../lib/chatLink'
import { buildChatIndex, chatMatchesQuery, remoteSearchKeys } from '../lib/chatSearch'
import { chatRemote } from '../lib/chatSync'

// ศูนย์รวมแชท LINE OA + Facebook (จำลอง: ของจริงรับ webhook / ส่งผ่าน API): ซ้าย = รายการแชท, ขวา = เธรด (มือถือแสดงทีละหน้า)
const router = useRouter()
const props = defineProps({ id: { type: String, default: '' } })
const current = computed(() => (props.id ? findChat(props.id) : null))
// แชทที่เปิดจากลิงก์/การแจ้งเตือน แต่ยังไม่อยู่ในชุดล่าสุดในเครื่อง → ดึงมาก่อน
watch(() => props.id, (id) => { if (id && !findChat(id)) chatRemote.ensure([id]) }, { immediate: true })
const customer = computed(() => (current.value ? findCustomer(current.value.customerId) : null))

const CH = { line: { l: 'LINE', cls: 'bg-[#06C755] text-white' }, facebook: { l: 'Facebook', cls: 'bg-[#1877F2] text-white' } }
const nameOf = (c) => findCustomer(c.customerId)?.name || c.profileName
const q = ref('')
const filter = ref('') // '' | line | facebook | unread | unlinked
const FILTERS = [{ v: '', l: 'ทั้งหมด' }, { v: 'line', l: 'LINE' }, { v: 'facebook', l: 'Facebook' }, { v: 'unread', l: 'ยังไม่อ่าน' }, { v: 'unlinked', l: 'ยังไม่ผูก' }]
// รายการแสดงทีละหน้า (กันโหลดแชททั้งหมดพร้อมกันบนมือถือ) · การค้นครอบคลุมทุกแชท ไม่จำกัดตามหน้าที่แสดง
const PAGE = 40
const shown = ref(PAGE)
watch([q, filter], () => { shown.value = PAGE })
// ค้นแชทนอกชุดล่าสุดบนเซิร์ฟเวอร์ (หน่วง 400 ms หลังพิมพ์ · ดึงมาจำไว้ในเครื่อง)
let searchT = null
watch(q, (v) => {
  clearTimeout(searchT)
  const s = v.trim()
  if (!s) return
  searchT = setTimeout(() => { chatRemote.search({ text: s, ...remoteSearchKeys(s, db.customers, db.orders, db.quotes) }) }, 400)
})
const searchIndex = computed(() => (q.value.trim() ? buildChatIndex(db.chats, db.customers, db.orders, db.quotes) : null))
const matched = computed(() => db.chats.filter((c) => {
  if (filter.value === 'line' || filter.value === 'facebook') { if (c.channel !== filter.value) return false }
  if (filter.value === 'unread' && !c.unreadStaff) return false
  if (filter.value === 'unlinked' && c.customerId) return false
  return !searchIndex.value || chatMatchesQuery(searchIndex.value, c.id, q.value)
}))
const list = computed(() => matched.value.slice(0, shown.value))
const moreCount = computed(() => Math.max(0, matched.value.length - shown.value))
// เปิดหน้าแชท = รีเฟรชแชทถี่ขึ้น (~10 วิ) · ออกจากหน้าคืนเป็นปกติ
onMounted(() => setChatFastPoll(true))
onUnmounted(() => setChatFastPoll(false))
// แนะนำลูกค้าให้แชทที่ยังไม่ผูก (พนักงานกดผูกเอง)
const suggestions = computed(() => (current.value ? suggestCustomers(current.value, db.customers) : []))
const detectedPhone = computed(() => (current.value && !current.value.customerId ? phonesInChat(current.value)[0] || '' : ''))
// Facebook: ตอบได้อีกกี่ชั่วโมง
const fbLeft = computed(() => (current.value?.channel === 'facebook' ? fbWindowLeft(current.value) : null))
const last = (c) => {
  const m = c.messages[c.messages.length - 1]
  if (!m) return { text: 'ยังไม่มีข้อความ', at: c.updatedAt }
  return { text: m.kind === 'order' ? 'สรุปออร์เดอร์' : m.kind === 'quote' ? 'ใบเสนอ' : `${m.from === 'staff' ? 'คุณ: ' : ''}${messagePreview(m)}`, at: m.at }
}
const whenText = (at) => (at.slice(0, 10) === toDateStr(new Date()) ? timeOnly(at) : dateOnly(at))

// ออร์เดอร์ที่ยังไม่ปิดของลูกค้า
const openOrders = computed(() =>
  customer.value ? db.orders.filter((o) => o.customerId === customer.value.id && o.channel !== 'pos' && !['delivered', 'cancelled'].includes(o.status)) : [],
)
const ordersOpen = ref(false)

// แผงลงออร์เดอร์ในแชท: คอม = แผงขวาคู่กับแชท · มือถือ = แท็บ แชท | ออร์เดอร์ · ร่างเก็บต่อแชทใน store (สลับไปมาไม่หาย)
const panelOpen = ref(false)
const mtab = ref('chat')
function openPanel() {
  panelOpen.value = true
  mtab.value = 'order'
}
function togglePanel() {
  if (window.matchMedia('(min-width: 1024px)').matches) panelOpen.value = !panelOpen.value
  else mtab.value = mtab.value === 'order' ? 'chat' : 'order'
}
function onCreated() {
  clearDraft(current.value.id)
  panelOpen.value = false
  mtab.value = 'chat'
}
const onQuoted = () => (mtab.value = 'chat')

// ผูกแชทกับลูกค้า (จำ LINE userId / FB PSID)
const linkOpen = ref(false)
const lq = ref('')
const linkList = computed(() => {
  const s = lq.value.trim().toLowerCase()
  const d = phoneDigits(s)
  return db.customers.filter((c) => c.active !== false && (!s || c.name.toLowerCase().includes(s) || (d && c.phone?.includes(d)))).slice(0, 30)
})
const newName = ref('')
const newPhone = ref('')
const linkError = ref('')
function openLink() {
  lq.value = ''
  newName.value = current.value?.profileName || ''
  newPhone.value = detectedPhone.value
  linkError.value = ''
  linkOpen.value = true
}
function doLink(c) {
  linkChat(current.value.id, c.id)
  linkOpen.value = false
}
// สร้างลูกค้าใหม่จากแชท: เบอร์โทรบังคับ
function doCreate() {
  if (!newName.value.trim()) return (linkError.value = 'กรอกชื่อ')
  if (!phoneValid(newPhone.value)) return (linkError.value = 'กรอกเบอร์โทรให้ถูกต้อง (บังคับ)')
  const r = createCustomerFromChat(current.value.id, newPhone.value, newName.value)
  if (r?.error) return (linkError.value = r.error)
  linkOpen.value = false
}

// จำลองข้อความเข้า (แทน webhook จนกว่าจะต่อจริง)
const simOpen = ref(false)
const sim = ref({ channel: 'line', name: '', text: '' })
function openSim(forCurrent) {
  sim.value = forCurrent && current.value ? { channel: current.value.channel, name: current.value.profileName, text: '', chat: current.value } : { channel: 'line', name: '', text: '', chat: null }
  simOpen.value = true
}
function doSim() {
  const v = sim.value
  if (!v.text.trim()) return
  const ext = v.chat ? v.chat.externalId : `${v.channel === 'line' ? 'U' : 'PSID'}-sim-${Date.now()}`
  const c = receiveMessage(v.channel, ext, v.chat ? v.chat.profileName : v.name.trim() || 'ลูกค้าใหม่', v.text)
  simOpen.value = false
  if (!v.chat) router.push(`/admin/chat/${c.id}`)
}
</script>

<template>
  <div v-if="!can('chat')" class="card py-10 text-center text-stone-500">บทบาทนี้ใช้แชทไม่ได้</div>

  <div v-else class="flex h-full min-h-0 flex-col">
    <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-2xl border border-stone-200 bg-white"
      :class="[panelOpen ? 'md:grid-cols-[300px_minmax(0,1fr)] lg:grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)]' : 'md:grid-cols-[300px_minmax(0,1fr)]']">
      <!-- รายการแชท -->
      <aside class="flex min-h-0 flex-col border-stone-200 md:border-r" :class="[current ? 'hidden md:flex' : 'flex', panelOpen ? 'lg:hidden xl:flex' : '']">
        <div class="flex items-center gap-2 border-b border-stone-200 p-3">
          <h1 class="page-title flex-1">แชท <span class="text-xs font-normal text-stone-400">LINE OA · Facebook</span></h1>
          <button type="button" class="h-9 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800" @click="openSim(false)">จำลองข้อความเข้า</button>
        </div>
        <div class="border-b border-stone-200 p-2">
          <label class="relative block">
            <span class="sr-only">ค้นหาแชท</span>
            <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input h-10 pl-9" placeholder="ค้นหาชื่อ เบอร์ ออร์เดอร์ ชื่อ Facebook" />
          </label>
          <div class="mt-2 flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
            <button v-for="f in FILTERS" :key="f.v" type="button" class="chip shrink-0 px-2.5 py-1 text-xs" :class="filter === f.v ? 'chip-on' : 'chip-off'" @click="filter = f.v">{{ f.l }}</button>
          </div>
        </div>
        <ul class="min-h-0 flex-1 overflow-y-auto">
          <li v-if="!list.length" class="p-6 text-center text-sm text-stone-400">{{ q.trim() ? 'ไม่พบแชทที่ตรงกับคำค้น' : 'ยังไม่มีแชท' }}</li>
          <li v-if="moreCount" class="p-3"><button type="button" class="btn-outline h-9 w-full text-sm" @click="shown += PAGE">โหลดเพิ่ม (อีก {{ moreCount }} แชท)</button></li>
          <li v-for="c in list" :key="c.id">
            <RouterLink :to="`/admin/chat/${c.id}`" class="flex items-center gap-3 border-b border-stone-100 px-3 py-3 hover:bg-stone-50" :class="current?.id === c.id ? 'bg-brand-50' : ''">
              <span class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">
                {{ (nameOf(c) || '?').replace(/^คุณ/, '').trim().charAt(0) }}
                <span class="absolute -right-1 -bottom-1 rounded px-1 text-xs leading-4 font-bold" :class="CH[c.channel].cls">{{ c.channel === 'line' ? 'L' : 'f' }}</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="min-w-0 flex-1 truncate font-medium text-stone-900">{{ nameOf(c) }}<span v-if="!c.customerId" class="ml-1 rounded bg-amber-50 px-1 text-xs font-medium text-amber-700">ยังไม่ผูก</span></span>
                  <span class="shrink-0 text-xs text-stone-400">{{ whenText(last(c).at) }}</span>
                </span>
                <span class="flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm" :class="c.unreadStaff ? 'font-medium text-stone-900' : 'text-stone-500'">{{ last(c).text }}</span>
                  <span v-if="c.botHandoff" class="shrink-0 rounded bg-violet-50 px-1 text-xs font-medium text-violet-700">บอทส่งต่อ</span>
                  <span v-else-if="c.botDraft && !c.botDraft.editing" class="shrink-0 rounded bg-violet-50 px-1 text-xs font-medium text-violet-700">มีร่างบอท</span>
                  <span v-if="c.unreadStaff" class="shrink-0 rounded-full bg-rose-500 px-1.5 text-xs font-semibold text-white">{{ c.unreadStaff }}</span>
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </aside>

      <!-- เธรด -->
      <section v-if="current" class="flex min-h-0 min-w-0 flex-col bg-stone-50">
        <div class="flex items-center gap-2 border-b border-stone-200 bg-white p-2.5">
          <RouterLink to="/admin/chat" class="flex h-9 w-9 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100 md:hidden" aria-label="กลับ"><AppIcon name="back" :size="20" /></RouterLink>
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-1.5">
              <span class="shrink-0 rounded px-1.5 text-xs leading-5 font-bold" :class="CH[current.channel].cls">{{ CH[current.channel].l }}</span>
              <span class="truncate font-semibold text-stone-900">{{ customer?.name || current.profileName }}</span>
            </div>
            <div class="truncate text-xs text-stone-500">
              <button type="button" class="underline" :class="customer ? 'text-stone-500' : 'font-medium text-amber-700'" @click="openLink">{{ customer ? 'เปลี่ยนลูกค้า' : 'ยังไม่ผูก · ผูกลูกค้า' }}</button>
              <template v-if="customer"> · {{ current.profileName }}<template v-if="customer.phone"> · {{ formatPhone(customer.phone) }}</template></template>
              <template v-if="fbLeft !== null"> · <span :class="fbLeft > 0 ? 'text-stone-500' : 'text-rose-600'">{{ fbLeft > 0 ? `ตอบได้อีก ${Math.ceil(fbLeft / 3600e3)} ชม.` : 'เกิน 24 ชม.' }}</span></template>
            </div>
          </div>
          <button type="button" class="hidden h-9 rounded-xl border border-dashed border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 sm:inline-flex sm:items-center" @click="openSim(true)">จำลองลูกค้าพิมพ์</button>
          <button v-if="openOrders.length" type="button" class="btn-outline h-9 px-3 text-sm" @click="ordersOpen = true">ออร์เดอร์ {{ openOrders.length }}</button>
          <button v-if="can('createOrder')" type="button" class="relative hidden h-9 px-3 text-sm lg:inline-flex" :class="panelOpen ? 'btn-outline' : 'btn-primary'" @click="togglePanel">
            <AppIcon :name="panelOpen ? 'x' : 'plus'" :size="16" /> {{ panelOpen ? 'ปิดแผงออร์เดอร์' : 'ลงออร์เดอร์' }}
            <span v-if="hasDraft(current.id) && !panelOpen" class="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" />
          </button>
        </div>
        <!-- มือถือ: แท็บ แชท | ออร์เดอร์ -->
        <div v-if="can('createOrder') && !kb.open" class="grid grid-cols-2 gap-1 border-b border-stone-200 bg-white p-1.5 lg:hidden">
          <button type="button" class="h-9 rounded-lg text-sm font-medium" :class="mtab === 'chat' ? 'bg-brand-50 text-brand-800' : 'text-stone-500'" @click="mtab = 'chat'">แชท</button>
          <button type="button" class="relative h-9 rounded-lg text-sm font-medium" :class="mtab === 'order' ? 'bg-brand-50 text-brand-800' : 'text-stone-500'" @click="mtab = 'order'">
            ลงออร์เดอร์<span v-if="hasDraft(current.id)" class="ml-1 text-amber-700">(ร่าง)</span>
          </button>
        </div>
        <div v-if="suggestions.length" class="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span class="font-medium">ลูกค้าที่น่าจะใช่:</span>
          <button v-for="x in suggestions" :key="x.customer.id" type="button" class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-amber-100" @click="doLink(x.customer)">
            {{ x.customer.name }}<span class="text-amber-700"> · {{ x.why === 'phone' ? 'เบอร์ตรงกับที่พิมพ์ในแชท' : 'ชื่อคล้ายโปรไฟล์' }}</span> <span class="font-semibold text-brand-700">ผูก</span>
          </button>
        </div>
        <div class="flex min-h-0 flex-1">
          <ChatThread :key="current.id" :chat="current" @link="openLink" @open-panel="openPanel" class="min-h-0 min-w-0 flex-1" :class="mtab === 'order' ? 'hidden lg:flex' : 'flex'" @edit-draft="openPanel" />
          <div
            v-if="can('createOrder') && (panelOpen || mtab === 'order')"
            class="min-h-0 w-full overflow-y-auto bg-stone-50 px-3 pt-3 lg:w-[440px] lg:shrink-0 lg:border-l lg:border-stone-200"
            :class="mtab === 'order' ? 'block' : 'hidden lg:block'"
          >
            <OrderCreate :key="current.id" embedded :draft="draftOf(current.id)" :chat-id="current.id" @created="onCreated" @quoted="onQuoted" />
          </div>
        </div>
      </section>
      <section v-else class="hidden items-center justify-center bg-stone-50 text-sm text-stone-400 md:flex">เลือกแชททางซ้าย</section>
    </div>
    <p v-show="!kb.open" class="mt-1.5 shrink-0 text-center text-xs text-stone-400">
      <template v-if="db.integrations.line.status !== 'connected' && db.integrations.facebook.status !== 'connected'">ยังไม่ได้เชื่อม LINE OA / Facebook · <RouterLink v-if="can('manage')" to="/admin/settings/integrations" class="text-brand-700 underline">ไปเชื่อม</RouterLink> · </template>
      <template v-else>เชื่อมแล้ว: {{ [db.integrations.line.status === 'connected' ? `LINE ${db.integrations.line.accountName}` : '', db.integrations.facebook.status === 'connected' ? `Facebook ${db.integrations.facebook.accountName}` : ''].filter(Boolean).join(' · ') }} · </template>
      จำลอง (ทดสอบด้วยปุ่ม "จำลองข้อความเข้า")
    </p>

    <!-- ออร์เดอร์ของลูกค้า -->
    <AppModal v-if="ordersOpen" title="ออร์เดอร์ที่ยังไม่ปิด" @close="ordersOpen = false">
      <div class="space-y-2">
        <RouterLink v-for="o in openOrders" :key="o.id" :to="`/admin/orders/${o.id}`" class="flex items-center justify-between gap-2 rounded-xl border border-stone-200 p-3 hover:border-brand-300">
          <span class="min-w-0">
            <span class="block font-medium text-stone-900">{{ o.code }}</span>
            <span class="block truncate text-xs text-stone-500">{{ o.items[0]?.name }}</span>
          </span>
          <AppIcon name="next" class="text-stone-300" />
        </RouterLink>
      </div>
    </AppModal>

    <!-- ผูกลูกค้า -->
    <AppModal v-if="linkOpen && current" :title="`ผูกแชท ${current.profileName}`" @close="linkOpen = false">
      <p class="mb-3 text-sm text-stone-500">เลือกลูกค้าที่เป็นเจ้าของ {{ CH[current.channel].l }} นี้ ระบบจะจำไว้และผูกอัตโนมัติครั้งต่อไป</p>
      <div class="mb-3 space-y-2 rounded-xl border border-stone-200 p-3">
        <div class="text-sm font-semibold text-stone-800">สร้างลูกค้าใหม่</div>
        <input v-model="newName" class="input" placeholder="ชื่อ" />
        <PhoneInput v-model="newPhone" />
        <p v-if="linkError" class="text-sm text-rose-600">{{ linkError }}</p>
        <button type="button" class="btn-soft w-full" @click="doCreate"><AppIcon name="plus" :size="16" /> สร้างและผูก</button>
        <p class="text-xs text-stone-400">ยังไม่มีเบอร์? ปิดไว้ก่อนได้ ลงออร์เดอร์/ส่งใบเสนอในแชทได้ แต่บันทึกออร์เดอร์ต้องมีเบอร์</p>
      </div>
      <div class="mb-1.5 text-sm font-semibold text-stone-800">หรือเลือกลูกค้าเดิม</div>
      <input v-model="lq" type="search" class="input mb-3" placeholder="ค้นหาลูกค้าเดิม ชื่อ / เบอร์" />
      <div class="space-y-1.5">
        <button v-for="c in linkList" :key="c.id" type="button" class="flex w-full items-center justify-between gap-2 rounded-xl border p-3 text-left hover:border-brand-300" :class="current.customerId === c.id ? 'border-brand-500 bg-brand-50' : 'border-stone-200'" @click="doLink(c)">
          <span class="min-w-0">
            <span class="block truncate font-medium text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">{{ c.phone ? formatPhone(c.phone) : '-' }}</span>
          </span>
          <AppIcon v-if="current.customerId === c.id" name="check" class="text-brand-600" />
        </button>
      </div>
    </AppModal>

    <!-- จำลองข้อความเข้า -->
    <AppModal v-if="simOpen" :title="sim.chat ? `จำลอง: ${sim.chat.profileName} พิมพ์` : 'จำลองข้อความเข้า'" @close="simOpen = false">
      <div class="space-y-3">
        <p class="rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">ของจริงข้อความจะเข้ามาเองจาก LINE OA / Facebook (webhook)</p>
        <template v-if="!sim.chat">
          <div class="grid grid-cols-2 gap-1 seg-grid">
            <button v-for="(c, k) in CH" :key="k" type="button" class="h-9 rounded-lg text-sm font-medium" :class="sim.channel === k ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="sim.channel = k">{{ c.l }}</button>
          </div>
          <div><label class="label">ชื่อโปรไฟล์</label><input v-model="sim.name" class="input" placeholder="เช่น Ploy" /></div>
        </template>
        <div><label class="label">ข้อความ</label><textarea v-model="sim.text" rows="2" class="input" /></div>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="simOpen = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!sim.text.trim()" @click="doSim">ส่งเข้า</button>
      </template>
    </AppModal>
  </div>
</template>
