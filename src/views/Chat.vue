<script setup>
import { orderNo } from '../lib/format'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { db, can, findCustomer, findChat, draftOf, hasDraft, clearDraft, linkChat, createCustomerFromChat, fbWindowLeft } from '../data/store'
import OrderCreate from './OrderCreate.vue'
import { formatPhone, phoneDigits, phoneValid, timeOnly, dateOnly, toDateStr } from '../lib/format'
import { resolveMemberScan } from '../lib/scan'
import PhoneInput from '../components/PhoneInput.vue'
import AppIcon from '../components/AppIcon.vue'
import AppModal from '../components/AppModal.vue'
import ChatThread from '../components/ChatThread.vue'
import { setChatFastPoll } from '../lib/staffAuth'
import { messagePreview } from '../lib/chatMedia'
import { suggestCustomers, phonesInChat } from '../lib/chatLink'
import { buildChatIndex, chatMatchesQuery, remoteSearchKeys } from '../lib/chatSearch'
import { chatRemote } from '../lib/chatSync'
import { kb } from '../lib/viewportFit'

// ศูนย์รวมแชท Facebook (ข้อความเข้าจาก webhook / ส่งผ่าน API)
// คอม: รายการแชท | เธรด | แผงออร์เดอร์ (เปิดได้) · มือถือ/แท็บเล็ต: ทีละหน้า (รายการ → เธรด → ออร์เดอร์ เต็มจอ)
const props = defineProps({ id: { type: String, default: '' } })
const current = computed(() => (props.id ? findChat(props.id) : null))
// แชทที่เปิดจากลิงก์/การแจ้งเตือน แต่ยังไม่อยู่ในชุดล่าสุดในเครื่อง → ดึงมาก่อน
watch(() => props.id, (id) => { if (id && !findChat(id)) chatRemote.ensure([id]) }, { immediate: true })
const customer = computed(() => (current.value ? findCustomer(current.value.customerId) : null))

const CH = {
  facebook: { l: 'Facebook', cls: 'bg-[#166FE5] text-white' }, // น้ำเงิน Facebook เข้มขึ้นเล็กน้อยให้ตัวขาวอ่านได้ ≥4.5:1
  instagram: { l: 'Instagram', cls: 'bg-gradient-to-tr from-[#f58529] via-[#dd2a7b] to-[#8134af] text-white' },
  web: { l: 'เว็บ/แอป', cls: 'bg-brand-600 text-white', mark: 'W' }, // แชทจากหน้าเว็บของลูกค้า · ไม่มีค่านี้แล้วรายการแชททั้งหมดจะขึ้นไม่ได้
}
const nameOf = (c) => findCustomer(c.customerId)?.name || c.profileName
const initial = (name) => (name || '?').replace(/^คุณ/, '').trim().charAt(0) || '?'
// ชื่อที่แสดงของแชทที่เปิดอยู่ (ลูกค้าที่ผูกแล้ว ถ้าไม่มีใช้ชื่อโปรไฟล์)
const chName = computed(() => (current.value ? customer.value?.name || current.value.profileName : ''))

const q = ref('')
const filter = ref('') // '' | facebook | instagram | web | unread | unlinked
const FILTERS = [
  { v: '', l: 'ทั้งหมด' },
  { v: 'facebook', l: 'Facebook' },
  { v: 'instagram', l: 'Instagram' },
  { v: 'web', l: 'เว็บ/แอป' },
  { v: 'unread', l: 'ยังไม่อ่าน' },
  { v: 'unlinked', l: 'ยังไม่ผูก' },
]
// จำนวนต่อตัวกรอง (นับจากแชทที่โหลดในเครื่อง)
const counts = computed(() => {
  const all = db.chats
  return {
    '': all.length,
    facebook: all.filter((c) => c.channel === 'facebook').length,
    web: all.filter((c) => c.channel === 'web').length,
    instagram: all.filter((c) => c.channel === 'instagram').length,
    unread: all.filter((c) => c.unreadStaff).length,
    unlinked: all.filter((c) => !c.customerId).length,
  }
})
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
  if (filter.value === 'facebook' || filter.value === 'instagram' || filter.value === 'web') { if (c.channel !== filter.value) return false }
  if (filter.value === 'unread' && !c.unreadStaff) return false
  if (filter.value === 'unlinked' && c.customerId) return false
  return !searchIndex.value || chatMatchesQuery(searchIndex.value, c.id, q.value)
}))
const list = computed(() => matched.value.slice(0, shown.value))
const moreCount = computed(() => Math.max(0, matched.value.length - shown.value))
// สถานะช่องทาง (แสดงที่หัวรายการแทนแถบข้อความท้ายหน้า)
const fbOn = computed(() => db.integrations.facebook.status === 'connected')
// เปิดหน้าแชท = รีเฟรชแชทถี่ขึ้น (~10 วิ) · ออกจากหน้าคืนเป็นปกติ
onMounted(() => setChatFastPoll(true))
onUnmounted(() => setChatFastPoll(false))
// แนะนำลูกค้าให้แชทที่ยังไม่ผูก (พนักงานกดผูกเอง)
const suggestions = computed(() => (current.value ? suggestCustomers(current.value, db.customers) : []))
const detectedPhone = computed(() => (current.value && !current.value.customerId ? phonesInChat(current.value)[0] || '' : ''))
// Facebook: ตอบได้อีกกี่ชั่วโมง
const fbLeft = computed(() => (['facebook', 'instagram'].includes(current.value?.channel) ? fbWindowLeft(current.value) : null))
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

// แผงลงออร์เดอร์ (ตัวเดียวทั้งคอมและมือถือ): คอม = แผงขวาคู่กับเธรด · มือถือ = เต็มจอ มีปุ่มกลับไปแชท
// ร่างออร์เดอร์เก็บต่อแชทใน store (สลับไปมาแล้วไม่หาย)
const orderOpen = ref(false)
const detailsOpen = ref(false)
const isWide = () => window.matchMedia('(min-width: 1024px)').matches
function openPanel() {
  orderOpen.value = true
}
function togglePanel() {
  orderOpen.value = !orderOpen.value
}
function onCreated() {
  clearDraft(current.value.id)
  orderOpen.value = false
}
// ส่งใบเสนอจากแผงแล้ว: มือถือกลับไปหน้าแชท · คอมคงแผงไว้
function onQuoted() {
  if (!isWide()) orderOpen.value = false
}
// ออกจากแชท (กลับไปรายการ) → ปิดแผงและรายละเอียด
watch(current, (c) => {
  if (!c) {
    orderOpen.value = false
    detailsOpen.value = false
  }
})

// คลาสตามสถานะ: รายการแชท / เธรด / แผงออร์เดอร์
const gridCls = computed(() => (orderOpen.value
  ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] xl:grid-cols-[300px_minmax(0,1fr)_440px]'
  : 'md:grid-cols-[280px_minmax(0,1fr)]'))
const asideCls = computed(() => {
  if (orderOpen.value) return 'hidden xl:flex'
  return current.value ? 'hidden md:flex' : 'flex'
})
// ไม่มีกรอบ/มุมโค้ง/เงา ใช้พื้นที่เต็มจอชิดขอบทุกขนาดจอ (เหมือนตอนแป้นพิมพ์เปิดบนมือถือ)
const cardCls = 'min-h-0 min-w-0 flex-col overflow-hidden bg-white'

// ผูกแชทกับลูกค้า (จำ FB PSID)
const linkOpen = ref(false)
const lq = ref('')
// สแกนรหัสสมาชิกในช่องค้นหา = กรองให้เหลือลูกค้าคนนั้น (พนักงานกดผูกเอง)
watch(lq, (v) => { const c = resolveMemberScan(v, db.customers); if (c) lq.value = c.phone || c.name })
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
// จากหน้า "ข้อมูลลูกค้า" → ปิดหน้านั้นก่อนเปิดหน้าผูก (ไม่ซ้อนกล่อง)
function linkFromDetails() {
  detailsOpen.value = false
  openLink()
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

</script>

<template>
  <div v-if="!can('chat')" class="card py-10 text-center text-stone-500">บทบาทนี้ใช้แชทไม่ได้</div>

  <div v-else class="flex h-full min-h-0 flex-col">
    <div class="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 lg:gap-4" :class="gridCls">
      <!-- รายการแชท -->
      <aside :class="[cardCls, asideCls]" aria-label="รายการแชท">
        <div class="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2.5">
          <h1 class="page-title">แชท</h1>
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium" :class="fbOn ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'" :title="fbOn ? `Facebook ${db.integrations.facebook.accountName}` : 'ยังไม่ได้เชื่อม Facebook'">
              <span class="h-1.5 w-1.5 rounded-full" :class="fbOn ? 'bg-emerald-500' : 'bg-stone-300'" />Facebook
            </span>
          </div>
        </div>
        <p v-if="!fbOn" class="px-4 pb-2 text-xs text-stone-500">
          ยังไม่ได้เชื่อม Facebook
          <RouterLink v-if="can('manage')" to="/admin/settings/integrations" class="font-medium text-brand-700 underline">ไปเชื่อม</RouterLink>
        </p>

        <div class="px-3 pb-2">
          <label class="relative block">
            <span class="sr-only">ค้นหาแชท</span>
            <AppIcon name="search" :size="18" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
            <input v-model="q" type="search" class="input h-10 rounded-full bg-stone-50 pl-10" placeholder="ค้นหาชื่อ เบอร์ เลขออร์เดอร์" />
          </label>
        </div>
        <!-- มือถือ: ตัวกรองแถวเดียวเลื่อนแนวนอน เห็นรายการแชทได้มากขึ้น · md ขึ้นไปห่อบรรทัด -->
        <div class="flex gap-1.5 overflow-x-auto px-3 pb-2.5 [scrollbar-width:none] md:flex-wrap md:overflow-visible" role="group" aria-label="ตัวกรองแชท">
          <button v-for="f in FILTERS" :key="f.v" type="button" class="chip h-8 shrink-0 px-3 text-xs" :class="filter === f.v ? 'chip-on' : 'chip-off'" :aria-pressed="filter === f.v" @click="filter = f.v">
            {{ f.l }}
            <span class="font-normal tabular-nums" :class="filter === f.v ? 'text-white' : 'text-stone-500'">{{ counts[f.v] }}</span>
          </button>
        </div>

        <ul class="min-h-0 flex-1 divide-y divide-stone-100 overflow-y-auto overscroll-contain border-t border-stone-100">
          <li v-if="!list.length" class="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <AppIcon name="chat" :size="32" class="text-stone-300" />
            <template v-if="q.trim()">
              <p class="text-sm font-medium text-stone-700">ไม่พบแชทที่ตรงกับ “{{ q.trim() }}”</p>
              <p class="text-xs text-stone-500">ลองค้นด้วยชื่อ เบอร์ หรือเลขออร์เดอร์</p>
            </template>
            <template v-else-if="filter">
              <p class="text-sm font-medium text-stone-700">ไม่มีแชทในตัวกรองนี้</p>
            </template>
            <template v-else>
              <p class="text-sm font-medium text-stone-700">ยังไม่มีแชท</p>
              <p class="text-xs text-stone-500">ข้อความจาก Facebook จะขึ้นที่นี่อัตโนมัติ</p>
              <RouterLink v-if="!fbOn && can('manage')" to="/admin/settings/integrations" class="btn-soft mt-2 h-9 text-sm">เชื่อมช่องทาง</RouterLink>
            </template>
          </li>
          <li v-if="moreCount" class="p-3"><button type="button" class="btn-outline h-9 w-full text-sm" @click="shown += PAGE">โหลดเพิ่ม (อีก {{ moreCount }} แชท)</button></li>
          <li v-for="c in list" :key="c.id" class="relative">
            <RouterLink :to="`/admin/chat/${c.id}`" class="flex items-center gap-3 px-3.5 py-3 transition hover:bg-stone-50" :class="current?.id === c.id ? 'bg-brand-50/70' : ''">
              <span v-if="current?.id === c.id" class="absolute inset-y-2 left-0 w-1 rounded-r-full bg-brand-500" aria-hidden="true" />
              <span class="relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-base font-semibold text-brand-800">
                {{ initial(nameOf(c)) }}
                <span class="absolute -right-1 -bottom-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold ring-2 ring-white" :class="CH[c.channel].cls">{{ CH[c.channel].mark || 'f' }}</span>
              </span>
              <span class="min-w-0 flex-1">
                <span class="flex items-baseline gap-2">
                  <span class="flex min-w-0 flex-1 items-center gap-1.5">
                    <span class="truncate text-[15px]" :class="c.unreadStaff ? 'font-semibold text-stone-900' : 'font-medium text-stone-800'">{{ nameOf(c) }}</span>
                    <span v-if="!c.customerId" class="shrink-0 rounded bg-amber-50 px-1.5 text-xs leading-5 font-medium text-amber-700">ยังไม่ผูก</span>
                  </span>
                  <span class="shrink-0 text-xs tabular-nums" :class="c.unreadStaff ? 'font-semibold text-brand-700' : 'text-stone-400'">{{ whenText(last(c).at) }}</span>
                </span>
                <span class="mt-0.5 flex items-center gap-2">
                  <span class="min-w-0 flex-1 truncate text-sm" :class="c.unreadStaff ? 'font-medium text-stone-900' : 'text-stone-500'">{{ last(c).text }}</span>
                  <span v-if="c.botHandoff" class="shrink-0 rounded bg-violet-50 px-1.5 text-xs leading-5 font-medium text-violet-700">บอทส่งต่อ</span>
                  <span v-else-if="c.botDraft && !c.botDraft.editing" class="shrink-0 rounded bg-violet-50 px-1.5 text-xs leading-5 font-medium text-violet-700">มีร่างบอท</span>
                  <span v-if="c.unreadStaff" class="shrink-0 rounded-full bg-brand-600 px-1.5 text-[11px] leading-5 font-semibold text-white tabular-nums">{{ c.unreadStaff }}</span>
                </span>
              </span>
            </RouterLink>
          </li>
        </ul>
      </aside>

      <!-- เธรด -->
      <section v-if="current" :class="[cardCls, orderOpen ? 'hidden lg:flex' : 'flex']" :aria-label="`แชทกับ ${chName}`">
        <header class="flex items-center gap-1 border-b border-stone-200 bg-white px-2 lg:gap-2 lg:px-4 lg:py-2.5" :class="kb.open ? 'py-1' : 'py-2'">
          <RouterLink to="/admin/chat" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 md:hidden" aria-label="กลับไปรายการแชท">
            <AppIcon name="back" :size="22" />
          </RouterLink>
          <button type="button" class="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl px-1.5 text-left hover:bg-stone-50" :class="kb.open ? 'py-0' : 'py-1'" :aria-label="`ข้อมูลลูกค้า ${chName}`" @click="detailsOpen = true">
            <span class="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800">
              {{ initial(chName) }}
              <span class="absolute -right-1 -bottom-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold ring-2 ring-white" :class="CH[current.channel].cls">{{ CH[current.channel].mark || 'f' }}</span>
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex min-w-0 items-center gap-2">
                <span class="truncate font-semibold text-stone-900">{{ chName }}</span>
                <span class="hidden shrink-0 rounded px-1.5 text-xs leading-5 font-semibold sm:inline-block" :class="CH[current.channel].cls">{{ CH[current.channel].l }}</span>
                <AppIcon name="next" :size="14" class="shrink-0 text-stone-400" />
              </span>
              <span class="mt-0.5 flex min-w-0 items-center gap-x-2 gap-y-1 text-xs text-stone-500" :class="kb.open ? 'flex-nowrap overflow-hidden' : 'flex-wrap'">
                <span v-if="!customer" class="shrink-0 font-medium text-amber-700">ยังไม่ผูกลูกค้า</span>
                <span v-else-if="customer.phone && !kb.open" class="shrink-0 tabular-nums">{{ formatPhone(customer.phone) }}</span>
                <span v-if="fbLeft !== null" class="shrink-0 rounded-full px-2 py-px font-medium" :class="fbLeft > 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'">{{ fbLeft > 0 ? `ตอบได้อีก ${Math.ceil(fbLeft / 3600e3)} ชม.` : 'เกิน 24 ชม.' }}</span>
                <span v-if="openOrders.length && !kb.open" class="shrink-0 font-medium text-stone-600">ออร์เดอร์เปิด {{ openOrders.length }}</span>
              </span>
            </span>
          </button>
          <button v-if="!customer" type="button" class="btn-soft hidden h-9 shrink-0 px-3 text-sm lg:inline-flex" @click="openLink">ผูกลูกค้า</button>
          <button
            v-if="can('createOrder')"
            type="button"
            class="relative h-10 w-10 shrink-0 px-0 text-sm lg:w-auto lg:px-3.5"
            :class="orderOpen ? 'btn-outline' : 'btn-primary'"
            :aria-label="orderOpen ? 'ปิดแผงออร์เดอร์' : 'ลงออร์เดอร์ในแชทนี้'"
            @click="togglePanel"
          >
            <AppIcon :name="orderOpen ? 'x' : 'plus'" :size="16" />
            <span class="hidden lg:inline">{{ orderOpen ? 'ปิดแผงออร์เดอร์' : 'ลงออร์เดอร์' }}</span>
            <span v-if="hasDraft(current.id) && !orderOpen" class="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-amber-400 ring-2 ring-white" aria-hidden="true" />
          </button>
        </header>
        <div v-if="suggestions.length && !kb.open" class="flex flex-wrap items-center gap-2 border-b border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span class="font-medium">ลูกค้าที่น่าจะใช่:</span>
          <button v-for="x in suggestions" :key="x.customer.id" type="button" class="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-white px-2.5 py-1 text-xs font-medium hover:bg-amber-100" @click="doLink(x.customer)">
            {{ x.customer.name }}<span class="text-amber-700"> · {{ x.why === 'phone' ? 'เบอร์ตรงกับที่พิมพ์ในแชท' : 'ชื่อคล้ายโปรไฟล์' }}</span> <span class="font-semibold text-brand-700">ผูก</span>
          </button>
        </div>
        <ChatThread :key="current.id" :chat="current" class="min-h-0 flex-1" @link="openLink" @open-panel="openPanel" @edit-draft="openPanel" />
      </section>
      <section v-else class="hidden flex-col items-center justify-center gap-2 rounded-2xl border border-stone-200 bg-white px-6 text-center md:flex">
        <AppIcon name="chat" :size="36" class="text-stone-300" />
        <p class="text-sm font-medium text-stone-700">เลือกแชททางซ้ายเพื่อเริ่มตอบ</p>
        <p v-if="counts.unread" class="text-xs font-medium text-brand-700">มีแชทที่ยังไม่อ่าน {{ counts.unread }} แชท</p>
      </section>

      <!-- แผงลงออร์เดอร์ -->
      <section v-if="current && orderOpen && can('createOrder')" :class="[cardCls, 'flex']" aria-label="ลงออร์เดอร์ในแชท">
        <header class="flex items-center gap-2 border-b border-stone-200 bg-white px-2 py-2 lg:px-4 lg:py-2.5">
          <button type="button" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 lg:hidden" aria-label="กลับไปแชท" @click="orderOpen = false">
            <AppIcon name="back" :size="22" />
          </button>
          <div class="min-w-0 flex-1 px-1 lg:px-0">
            <h2 class="truncate text-[15px] font-semibold text-stone-900">ลงออร์เดอร์</h2>
            <p class="truncate text-xs text-stone-500">{{ chName }} · {{ CH[current.channel].l }}</p>
          </div>
          <button type="button" class="hidden h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-stone-600 hover:bg-stone-100 lg:inline-flex" @click="orderOpen = false">
            <AppIcon name="x" :size="16" /> ปิดแผง
          </button>
        </header>
        <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-stone-50 px-3 pt-3">
          <OrderCreate :key="current.id" embedded :draft="draftOf(current.id)" :chat-id="current.id" @created="onCreated" @quoted="onQuoted" />
        </div>
      </section>
    </div>

    <!-- รายละเอียดลูกค้า: สถานะการผูก เบอร์ ช่วงตอบ FB และออร์เดอร์ที่เปิดอยู่ -->
    <AppModal v-if="detailsOpen && current" title="ข้อมูลลูกค้า" @close="detailsOpen = false">
      <div class="space-y-3">
        <div class="rounded-2xl border border-stone-200 bg-white p-4">
          <div class="flex items-center gap-3">
            <span class="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-lg font-semibold text-brand-800">
              {{ initial(chName) }}
              <span class="absolute -right-1 -bottom-1 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] leading-none font-bold ring-2 ring-white" :class="CH[current.channel].cls">{{ CH[current.channel].mark || 'f' }}</span>
            </span>
            <div class="min-w-0 flex-1">
              <div class="truncate text-base font-semibold text-stone-900">{{ chName }}</div>
              <div class="truncate text-xs text-stone-500">{{ CH[current.channel].l }} · โปรไฟล์ {{ current.profileName }}</div>
            </div>
          </div>
          <dl class="mt-3 space-y-2 text-sm">
            <div class="flex justify-between gap-3">
              <dt class="text-stone-500">ลูกค้า</dt>
              <dd class="text-right font-medium" :class="customer ? 'text-stone-900' : 'text-amber-700'">{{ customer ? 'ผูกแล้ว' : 'ยังไม่ผูก' }}</dd>
            </div>
            <div class="flex justify-between gap-3">
              <dt class="text-stone-500">เบอร์โทร</dt>
              <dd class="text-right" :class="customer?.phone ? 'text-stone-900' : 'text-stone-500'">{{ customer?.phone ? formatPhone(customer.phone) : detectedPhone ? `${formatPhone(detectedPhone)} (พบในแชท)` : 'ยังไม่มี' }}</dd>
            </div>
            <div v-if="current.channel === 'facebook' || current.channel === 'instagram'" class="flex justify-between gap-3">
              <dt class="text-stone-500">ตอบได้</dt>
              <dd class="text-right" :class="fbLeft > 0 ? 'text-stone-900' : 'font-medium text-rose-700'">{{ fbLeft > 0 ? `อีก ${Math.ceil(fbLeft / 3600e3)} ชม.` : 'เกิน 24 ชม. แล้ว' }}</dd>
            </div>
          </dl>
          <button type="button" class="btn-outline mt-3 w-full" @click="linkFromDetails">{{ customer ? 'เปลี่ยนลูกค้า' : 'ผูกกับลูกค้า' }}</button>
        </div>

        <div>
          <h3 class="mb-1.5 text-sm font-semibold text-stone-800">ออร์เดอร์ที่ยังไม่ปิด</h3>
          <p v-if="!openOrders.length" class="rounded-xl bg-white p-3 text-sm text-stone-500 ring-1 ring-stone-200">{{ customer ? 'ไม่มีออร์เดอร์ที่ยังไม่ปิด' : 'ผูกลูกค้าก่อนเพื่อดูออร์เดอร์' }}</p>
          <div v-else class="space-y-2">
            <RouterLink v-for="o in openOrders" :key="o.id" :to="`/admin/orders/${o.id}`" class="flex items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-3 hover:border-brand-300">
              <span class="min-w-0">
                <span class="block font-medium text-stone-900">{{ orderNo(o.code) }}</span>
                <span class="block truncate text-xs text-stone-500">{{ o.items[0]?.name }}</span>
              </span>
              <AppIcon name="next" class="text-stone-300" />
            </RouterLink>
          </div>
        </div>

        <button v-if="can('createOrder')" type="button" class="btn-primary w-full" @click="detailsOpen = false; openPanel()">ลงออร์เดอร์ในแชทนี้</button>
        <p v-if="current.channel === 'facebook'" class="text-xs leading-relaxed text-stone-500">Facebook ให้ตอบข้อความทั่วไปได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด · เกินเวลานี้ตอบได้เฉพาะการ์ดออร์เดอร์และยอดชำระ</p>
        <p v-else-if="current.channel === 'instagram'" class="text-xs leading-relaxed text-stone-500">Instagram ตอบได้เฉพาะข้อความตัวอักษรภายใน 24 ชม. หลังลูกค้าทักล่าสุด · ไม่รองรับการ์ดออร์เดอร์หรือรูปภาพ</p>
      </div>
    </AppModal>

    <!-- ผูกลูกค้า -->
    <AppModal v-if="linkOpen && current" :title="`ผูกแชท ${current.profileName}`" @close="linkOpen = false">
      <p class="mb-3 text-sm text-stone-500">เลือกลูกค้าที่เป็นเจ้าของ {{ CH[current.channel].l }} นี้ ระบบจะจำไว้และผูกอัตโนมัติครั้งต่อไป</p>
      <div class="mb-3 space-y-2 rounded-xl border border-stone-200 bg-white p-3">
        <div class="text-sm font-semibold text-stone-800">สร้างลูกค้าใหม่</div>
        <input v-model="newName" class="input" placeholder="ชื่อ" />
        <PhoneInput v-model="newPhone" />
        <p v-if="linkError" class="text-sm text-rose-700" role="alert">{{ linkError }}</p>
        <button type="button" class="btn-soft w-full" @click="doCreate"><AppIcon name="plus" :size="16" /> สร้างและผูก</button>
        <p class="text-xs text-stone-500">ยังไม่มีเบอร์? ปิดไว้ก่อนได้ ลงออร์เดอร์/ส่งใบเสนอในแชทได้ แต่บันทึกออร์เดอร์ต้องมีเบอร์</p>
      </div>
      <div class="mb-1.5 text-sm font-semibold text-stone-800">หรือเลือกลูกค้าเดิม</div>
      <input v-model="lq" type="search" class="input mb-3" placeholder="ค้นหาลูกค้าเดิม ชื่อ / เบอร์" />
      <div class="space-y-1.5">
        <button v-for="c in linkList" :key="c.id" type="button" class="flex w-full items-center justify-between gap-2 rounded-xl border bg-white p-3 text-left hover:border-brand-300" :class="current.customerId === c.id ? 'border-brand-500 bg-brand-50' : 'border-stone-200'" @click="doLink(c)">
          <span class="min-w-0">
            <span class="block truncate font-medium text-stone-900">{{ c.name }}</span>
            <span class="block text-xs text-stone-500">{{ c.phone ? formatPhone(c.phone) : '-' }}</span>
          </span>
          <AppIcon v-if="current.customerId === c.id" name="check" class="text-brand-600" />
        </button>
      </div>
    </AppModal>
  </div>
</template>
