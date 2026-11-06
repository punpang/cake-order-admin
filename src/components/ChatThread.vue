<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { addCakeCodesToDraft, db, findOrder, sendChat, markRead, findQuote, acceptQuote, reviseQuote, fbWindowOpen, convertQuote, chatOrderBlock, findCustomer, linkChat, askCustomer, cancelAsk, applyToDraft, ASK_FIELDS, saveCanned, removeCanned, sendBotDraft, dismissBotDraft, setChatBot, staffReplied, recommendText, addRecommendToDraft } from '../data/store'
import { detectEntities } from '../lib/chatParse'
import { CODE_RE, findCodes } from '../lib/cakeCode'
import { extractIntent, customerText, scoreProducts, intentSummary } from '../lib/chatIntent'
import { orderTotals, discountLines } from '../lib/pricing'
import { STATUS } from '../lib/constants'
import { money, dateTime, timeOnly, dateOnly, formatPhone } from '../lib/format'
import AppIcon from './AppIcon.vue'
import PayDueBadge from './PayDueBadge.vue'
import DiscountDetail from './DiscountDetail.vue'
import AppModal from './AppModal.vue'

// เธรดแชทของศูนย์รวมแชท (ฝั่งพนักงาน) · ข้อความจากลูกค้ามาจาก LINE OA / Facebook (จำลอง)
const props = defineProps({ chat: { type: Object, required: true } })
const emit = defineEmits(['edit-draft', 'link', 'open-panel'])
const text = ref('')
const box = ref(null)
const mine = (m) => m.from === 'staff'
const channelLabel = computed(() => (props.chat.channel === 'facebook' ? 'Facebook' : 'LINE'))
// Facebook เกิน 24 ชม. หลังลูกค้าทักล่าสุด → พิมพ์ตอบไม่ได้ (การ์ดออร์เดอร์/ยอดชำระยังส่งได้)
const canType = computed(() => fbWindowOpen(props.chat))

function scrollEnd() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}
function send() {
  if (!text.value.trim() || !canType.value) return
  const t = text.value
  sendChat(props.chat.id, 'staff', t, { replyTo: replyTo.value?.id })
  staffReplied(props.chat.id, t) // เรียนรู้คู่ ถาม→ตอบ + นับสถิติบอท
  text.value = ''
  replyTo.value = null
}
function onKey(e) {
  // Enter ส่ง · Shift+Enter ขึ้นบรรทัด
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
const count = computed(() => props.chat.messages.length)
watch(count, () => {
  markRead(props.chat.id)
  scrollEnd()
})
onMounted(() => {
  markRead(props.chat.id)
  scrollEnd()
})

// การ์ดออร์เดอร์
const card = (m) => {
  const o = findOrder(m.orderId)
  if (!o) return null
  const t = orderTotals(o)
  return { o, t, first: o.items[0]?.name || '', more: o.items.length - 1 }
}
// ใบเสนอ
const QUOTE_STATUS = {
  pending: { t: 'รอลูกค้ายืนยัน', cls: 'bg-amber-50 text-amber-700' },
  accepted: { t: 'ยืนยันแล้ว', cls: 'bg-emerald-50 text-emerald-700' },
  revise: { t: 'ลูกค้าขอแก้', cls: 'bg-rose-50 text-rose-600' },
  need_phone: { t: 'ลูกค้ายืนยัน · รอเบอร์โทร', cls: 'bg-orange-50 text-orange-700' },
  superseded: { t: 'มีใบใหม่แล้ว', cls: 'bg-stone-100 text-stone-500' },
}
function quoteView(m) {
  const q = findQuote(m.quoteId)
  if (!q) return null
  const t = orderTotals({ ...q.payload, payments: [], adjustment: null, couponsUsed: [] })
  const lines = q.payload.items.flatMap((i) => discountLines(i.discounts, i.qty))
  return { q, t, lines }
}
const reviseFor = ref(null)
const reviseText = ref('')
const quoteError = ref('')
function accept(q) {
  const r = acceptQuote(q.id)
  quoteError.value = r.error || ''
}
// ลูกค้ายืนยันแล้วแต่ยังไม่ผูก/ไม่มีเบอร์ → พนักงานผูก/ใส่เบอร์แล้วสร้างออร์เดอร์
const block = computed(() => chatOrderBlock(props.chat.id))
const convertError = ref('')
function convert(q) {
  const r = convertQuote(q.id)
  convertError.value = r.error || ''
}
function sendRevise(q) {
  reviseQuote(q.id, reviseText.value.trim())
  reviseFor.value = null
  reviseText.value = ''
}
// ---------- จับข้อมูลในข้อความลูกค้า (เบอร์ / วันที่ / เวลา) → กดกรอกลงร่าง ----------
const ENT = { phone: { icon: 'phone', label: 'เบอร์' }, date: { icon: 'calendar', label: 'วันนัด' }, time: { icon: 'clock', label: 'เวลา' } }
const entities = (m) => (m.from === 'customer' && m.kind === 'text' && !m.answerFor ? detectEntities(m.text.replace(CODE_RE, ' ')) : [])
// รหัสเค้กสั่งทำที่ลูกค้าคัดลอกจากหน้าเว็บ → กดเพิ่มลงร่างออร์เดอร์
const hasCode = (m) => m.from === 'customer' && m.kind === 'text' && findCodes(m.text).length > 0
const codeResult = ref({})
function addCode(m) {
  codeResult.value = { ...codeResult.value, [m.id]: addCakeCodesToDraft(props.chat.id, m.text) }
}
const entText = (e) => (e.type === 'phone' ? formatPhone(e.value) : e.type === 'date' ? dateOnly(e.value) : e.value)
const notice = ref(null) // { done, suggest }
function fill(e) {
  notice.value = applyToDraft(props.chat.id, { [e.type]: e.value })
}
const suggestName = computed(() => (notice.value?.suggest ? findCustomer(notice.value.suggest)?.name : ''))
function linkSuggest() {
  linkChat(props.chat.id, notice.value.suggest)
  notice.value = null
}
// ข้อความที่ถูกอ้างอิง (ตอบกลับ / คำถาม)
const byId = (id) => props.chat.messages.find((x) => x.id === id)
const snippet = (m) => (!m ? '' : m.kind === 'order' ? 'สรุปออร์เดอร์' : m.kind === 'quote' ? 'ใบเสนอ' : m.text.length > 60 ? `${m.text.slice(0, 60)}…` : m.text)

// ---------- ตอบกลับข้อความ ----------
const replyTo = ref(null)
const input = ref(null)
function startReply(m) {
  replyTo.value = m
  nextTick(() => input.value?.focus())
}

// ---------- บอทตอบแชท: ร่างคำตอบ (โหมดแนะนำ) ----------
const botDraft = computed(() => props.chat.botDraft || null)
function editBotDraft() {
  const d = { ...botDraft.value }
  text.value = d.text
  props.chat.botDraft = { ...d, editing: true } // ซ่อนแถบร่าง · พอพนักงานกดส่ง staffReplied จะเทียบกับร่างเดิมแล้วนับเป็น "แก้"
  nextTick(() => input.value?.focus())
}
const SOURCE_LABEL = { rule: 'กฎ', faq: 'FAQ', hours: 'เวลาเปิด', price: 'ราคา/แนะนำสินค้า', learned: 'เรียนรู้จากพนักงาน', order: 'สถานะออร์เดอร์', closed: 'แจ้งร้านปิด', ask: 'ขอข้อมูล', offhours: 'นอกเวลา', handoff: 'ส่งต่อพนักงาน', order_unverified: 'ยืนยันตัวตนไม่ได้' }

// ---------- แนะนำสินค้าจากแชท ----------
const recOpen = ref(false)
const recIntent = computed(() => extractIntent(customerText(props.chat)))
const recs = computed(() => scoreProducts(recIntent.value, db))
const recNote = ref('')
function sendRec() {
  sendChat(props.chat.id, 'staff', recommendText(recs.value), {})
  recNote.value = 'ส่งข้อความแนะนำแล้ว'
}
function addRec(r) {
  const x = addRecommendToDraft(props.chat.id, r)
  recNote.value = x.error || `เพิ่ม ${r.name} ลงร่างแล้ว`
}

// ---------- ปุ่มถาม (คำตอบถัดไปกรอกลงร่างอัตโนมัติ) ----------
const ask = (field) => askCustomer(props.chat.id, field)

// ---------- ข้อความสำเร็จรูป ----------
const cannedOpen = ref(false)
const cannedEdit = ref(null) // { id, title, text }
function useCanned(c) {
  text.value = text.value ? `${text.value}\n${c.text}` : c.text
  cannedOpen.value = false
  nextTick(() => input.value?.focus())
}
function saveC() {
  if (!cannedEdit.value.title.trim() || !cannedEdit.value.text.trim()) return
  saveCanned(cannedEdit.value)
  cannedEdit.value = null
}

// แสดงวันที่คั่นเมื่อเปลี่ยนวัน
const showDay = (i) => i === 0 || props.chat.messages[i - 1].at.slice(0, 10) !== props.chat.messages[i].at.slice(0, 10)
</script>

<template>
  <div class="flex h-full min-h-0 flex-col">
    <div ref="box" class="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-1 py-3">
      <p v-if="!chat.messages.length" class="py-10 text-center text-sm text-stone-400">ยังไม่มีข้อความ</p>
      <template v-for="(m, i) in chat.messages" :key="m.id">
        <div v-if="showDay(i)" class="py-1 text-center text-xs text-stone-400">{{ dateOnly(m.at) }}</div>
        <div class="flex" :class="mine(m) ? 'justify-end' : 'justify-start'">
          <!-- การ์ดออร์เดอร์ -->
          <div v-if="m.kind === 'order' && card(m)" class="w-72 max-w-[85%] rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-brand-700">สรุปออร์เดอร์ {{ card(m).o.code }}</span>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="STATUS[card(m).o.status]?.cls">{{ STATUS[card(m).o.status]?.label }}</span>
              <PayDueBadge :order="card(m).o" short />
            </div>
            <div class="mt-1 text-sm font-medium break-words text-stone-900">{{ card(m).first }}<span v-if="card(m).more > 0" class="text-stone-500"> +{{ card(m).more }} รายการ</span></div>
            <div class="mt-0.5 text-xs text-stone-500">{{ card(m).o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }} · {{ dateTime(card(m).o.pickupAt) }}<template v-if="card(m).o.placeName"> · {{ card(m).o.placeName }}</template></div>
            <div class="mt-2 flex items-end justify-between gap-2 border-t border-stone-100 pt-2">
              <span class="text-xs text-stone-500">ยอดรวม <b class="block text-base text-stone-900">{{ money(card(m).t.total) }}</b></span>
              <span class="text-right text-xs" :class="card(m).t.balance > 0 ? 'text-amber-700' : 'text-brand-700'">{{ card(m).t.balance > 0 ? `ค้าง ${money(card(m).t.balance)}` : 'ชำระครบ' }}</span>
            </div>
            <RouterLink :to="`/admin/orders/${card(m).o.id}`" class="btn-soft mt-2 h-9 w-full text-sm">เปิดออร์เดอร์</RouterLink>
          </div>
          <!-- ใบเสนอ -->
          <div v-else-if="m.kind === 'quote' && quoteView(m)" class="w-80 max-w-[90%] rounded-2xl border-2 border-brand-200 bg-white p-3 shadow-sm" :class="quoteView(m).q.status === 'superseded' ? 'opacity-60' : ''">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-brand-700">ใบเสนอ {{ quoteView(m).q.code }}</span>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-medium" :class="QUOTE_STATUS[quoteView(m).q.status].cls">{{ QUOTE_STATUS[quoteView(m).q.status].t }}</span>
            </div>
            <ul class="mt-2 space-y-1 text-sm">
              <li v-for="it in quoteView(m).q.payload.items" :key="it.id" class="flex justify-between gap-2">
                <span class="min-w-0 break-words text-stone-900">{{ it.name }}<span v-if="it.qty > 1" class="text-stone-500"> × {{ it.qty }}</span></span>
                <span class="shrink-0 text-stone-700">{{ money(it.unitPrice * it.qty) }}</span>
              </li>
            </ul>
            <div class="mt-1.5 text-xs text-stone-500">{{ quoteView(m).q.payload.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }} · {{ dateTime(quoteView(m).q.payload.pickupAt) }}<template v-if="quoteView(m).q.payload.shippingFee"> · ค่าส่ง {{ money(quoteView(m).q.payload.shippingFee) }}</template><template v-if="quoteView(m).q.payload.placeName"> · {{ quoteView(m).q.payload.placeName }}</template><template v-if="quoteView(m).q.payload.distanceKm != null"> · {{ quoteView(m).q.payload.distanceKm }} กม.</template></div>
            <div class="mt-2 flex items-start justify-between gap-2 border-t border-stone-100 pt-2">
              <span class="text-xs text-stone-500">ยอดรวม</span>
              <DiscountDetail :full="quoteView(m).t.fullAll" :final="quoteView(m).t.total" :lines="quoteView(m).lines" />
            </div>
            <div v-if="quoteView(m).t.vatMode" class="mt-1 text-right text-[11px] text-stone-400">{{ quoteView(m).t.vatMode === 'exclusive' ? `ยอดรวม VAT ${quoteView(m).t.vatRate}% (บวกเพิ่ม ${money(quoteView(m).t.vat)}) แล้ว` : `ราคารวม VAT ${quoteView(m).t.vatRate}% แล้ว (${money(quoteView(m).t.vat)})` }}</div>
            <!-- ปุ่มที่ลูกค้าเห็นใน LINE/FB (ของจริงกดแล้วส่ง postback ผ่าน webhook) · ตอนนี้จำลองให้พนักงานกดแทน -->
            <template v-if="quoteView(m).q.status === 'pending'">
              <div class="mt-2 grid grid-cols-2 gap-2 opacity-70">
                <span class="flex h-9 items-center justify-center rounded-lg border border-stone-200 text-sm text-stone-600">ขอแก้</span>
                <span class="flex h-9 items-center justify-center rounded-lg bg-brand-600 text-sm font-semibold text-white">ยืนยันสั่ง</span>
              </div>
              <div class="mt-2 rounded-lg border border-dashed border-amber-300 bg-amber-50 p-2">
              <div class="mb-1.5 text-[11px] font-semibold text-amber-700">จำลองลูกค้ากดใน {{ channelLabel }}</div>
              <div v-if="reviseFor === quoteView(m).q.id" class="mt-2 space-y-2">
                <input v-model="reviseText" class="input h-10" placeholder="อยากแก้อะไร (ไม่บังคับ)" />
                <div class="flex gap-2">
                  <button type="button" class="btn-outline h-9 flex-1" @click="reviseFor = null">ยกเลิก</button>
                  <button type="button" class="btn-primary h-9 flex-1" @click="sendRevise(quoteView(m).q)">ส่งคำขอแก้</button>
                </div>
              </div>
              <div v-else class="mt-2 flex gap-2">
                <button type="button" class="btn-outline h-10 flex-1" @click="reviseFor = quoteView(m).q.id; reviseText = ''">ขอแก้</button>
                <button type="button" class="btn-primary h-10 flex-[1.4]" @click="accept(quoteView(m).q)"><AppIcon name="check" :size="16" /> ยืนยันสั่ง</button>
              </div>
              <p v-if="quoteError" class="mt-1 text-xs text-rose-600">{{ quoteError }}</p>
              </div>
            </template>
            <!-- พนักงาน -->
            <template v-if="true">
              <RouterLink v-if="quoteView(m).q.orderId" :to="`/admin/orders/${quoteView(m).q.orderId}`" class="btn-soft mt-2 h-9 w-full text-sm">เปิดออร์เดอร์</RouterLink>
              <template v-else-if="quoteView(m).q.status === 'need_phone'">
                <p v-if="block" class="mt-2 text-xs text-orange-700">{{ block }} · <button type="button" class="font-medium underline" @click="emit('link')">ผูก/สร้างลูกค้า</button></p>
                <button type="button" class="btn-primary mt-2 h-9 w-full text-sm" :disabled="!!block" @click="convert(quoteView(m).q)">สร้างออร์เดอร์</button>
                <p v-if="convertError" class="mt-1 text-xs text-rose-600">{{ convertError }}</p>
              </template>
              <button v-else-if="['pending', 'revise'].includes(quoteView(m).q.status)" type="button" class="btn-outline mt-2 h-9 w-full text-sm" @click="emit('edit-draft')">แก้ร่างแล้วส่งใหม่</button>
            </template>
          </div>
          <!-- ข้อความ -->
          <div v-else class="group max-w-[80%]">
            <div class="rounded-2xl px-3.5 py-2 text-[15px] break-words whitespace-pre-line" :class="mine(m) ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-stone-900 ring-1 ring-stone-200'">
              <!-- อ้างอิงข้อความที่ตอบ -->
              <div v-if="m.replyTo && byId(m.replyTo)" class="mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs" :class="mine(m) ? 'border-white/60 bg-white/15 text-white/90' : 'border-brand-400 bg-stone-50 text-stone-500'">{{ snippet(byId(m.replyTo)) }}</div>
              {{ m.text }}
            </div>
            <!-- คำตอบของปุ่มถาม -->
            <div v-if="m.answerFor" class="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
              <span class="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">ตอบ: {{ ASK_FIELDS[m.answerFor]?.label }}</span>
              <span v-if="m.filled?.done?.length" class="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">กรอกแล้ว: {{ m.filled.done.map((d) => d.label).join(', ') }}</span>
              <span v-else class="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">อ่านค่าไม่ได้ กรอกเอง</span>
            </div>
            <!-- รหัสเค้กสั่งทำจากหน้าเว็บ → เพิ่มลงร่าง -->
            <div v-if="hasCode(m)" class="mt-1 space-y-1">
              <button type="button" class="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100" @click="addCode(m)"><AppIcon name="cake" :size="13" /> เพิ่มเค้กนี้ลงร่างออร์เดอร์</button>
              <template v-if="codeResult[m.id]">
                <p v-if="codeResult[m.id].added.length" class="text-[11px] font-medium text-emerald-700" role="status">เพิ่มแล้ว: {{ codeResult[m.id].added.join(', ') }}</p>
                <p v-for="(w, k) in codeResult[m.id].warnings" :key="'w' + k" class="text-[11px] text-amber-700">⚠ {{ w }}</p>
                <p v-for="(er, k) in codeResult[m.id].errors" :key="'e' + k" class="text-[11px] text-rose-600" role="alert">{{ er }}</p>
              </template>
            </div>
            <!-- ข้อมูลที่จับได้ → กดกรอก -->
            <div v-if="entities(m).length" class="mt-1 flex flex-wrap gap-1">
              <button v-for="e in entities(m)" :key="e.type + e.value" type="button" class="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-0.5 text-[11px] font-medium text-brand-800 hover:bg-brand-50" :title="`กรอก${ENT[e.type].label}ลงร่าง`" @click="fill(e)">
                <AppIcon :name="ENT[e.type].icon" :size="12" /> {{ entText(e) }} <span class="text-brand-500">กรอก</span>
              </button>
            </div>
            <div class="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-stone-400" :class="mine(m) ? 'justify-end' : ''">
              <span>{{ timeOnly(m.at) }}<template v-if="m.from === 'staff'"> · ส่งทาง {{ channelLabel }} (จำลอง)<template v-if="m.by === 'ระบบ'"> · อัตโนมัติ</template></template><template v-if="m.ask"> · ถาม{{ ASK_FIELDS[m.ask]?.label.replace('ขอ', '') }}</template></span>
              <button v-if="canType" type="button" class="font-medium text-stone-500 hover:text-brand-700 sm:opacity-0 sm:group-hover:opacity-100" @click="startReply(m)">ตอบกลับ</button>
            </div>
          </div>
        </div>
      </template>
    </div>

    <!-- แจ้งผลการกรอก -->
    <div v-if="notice" class="flex flex-wrap items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
      <AppIcon name="check" :size="16" />
      <span class="min-w-0 flex-1">กรอกลงร่างแล้ว: {{ notice.done.map((d) => `${d.label} ${d.value}`).join(' · ') }}</span>
      <button v-if="notice.suggest" type="button" class="btn-soft h-8 px-2.5 text-xs" @click="linkSuggest">ผูกกับ {{ suggestName }}</button>
      <button type="button" class="btn-outline h-8 px-2.5 text-xs" @click="emit('open-panel'); notice = null">เปิดแผงออร์เดอร์</button>
      <button type="button" class="text-emerald-700" aria-label="ปิด" @click="notice = null"><AppIcon name="x" :size="16" /></button>
    </div>

    <!-- ร่างคำตอบจากบอท -->
    <div v-if="botDraft && !botDraft.editing && canType" class="border-t border-violet-200 bg-violet-50 px-3 py-2 text-sm">
      <div class="mb-1 flex flex-wrap items-center gap-1.5 text-xs text-violet-800">
        <span class="font-semibold">{{ botDraft.handoff ? 'บอทส่งต่อให้พนักงาน' : 'ร่างคำตอบจากบอท' }}</span>
        <span class="rounded-full bg-white px-2 py-0.5">{{ SOURCE_LABEL[botDraft.source] || botDraft.source }}<template v-if="botDraft.confidence"> · {{ Math.round(botDraft.confidence * 100) }}%</template></span>
        <span class="text-violet-600">{{ botDraft.reason }}</span>
      </div>
      <p v-if="botDraft.prefix" class="mb-1 rounded-lg bg-white/70 px-2 py-1 text-xs whitespace-pre-line text-violet-800"><b>ส่งก่อน (แจ้งร้านปิด):</b> {{ botDraft.prefix }}</p>
      <p class="whitespace-pre-line text-stone-800">{{ botDraft.text }}</p>
      <div class="mt-2 flex gap-2">
        <button type="button" class="btn-primary h-8 px-3 text-xs" @click="sendBotDraft(chat.id)">ส่งเลย</button>
        <button type="button" class="btn-outline h-8 px-3 text-xs" @click="editBotDraft">แก้ก่อนส่ง</button>
        <button type="button" class="btn-outline h-8 px-3 text-xs" @click="dismissBotDraft(chat.id)">ทิ้ง</button>
      </div>
    </div>
    <div v-else-if="chat.botHandoff && !botDraft" class="border-t border-violet-200 bg-violet-50 px-3 py-1.5 text-xs text-violet-800">บอทไม่แน่ใจ/ไม่ตอบเรื่องนี้ — ส่งต่อให้พนักงานตอบ</div>

    <!-- แนะนำสินค้า -->
    <div v-if="recs.length && canType" class="border-t border-stone-200 bg-white px-3 py-1.5 text-sm">
      <button type="button" class="flex w-full items-center justify-between gap-2 text-left text-xs font-medium text-brand-700" @click="recOpen = !recOpen">
        <span>แนะนำสินค้า ({{ recs.length }}) · {{ intentSummary(recIntent).join(' · ') }}</span>
        <span>{{ recOpen ? 'ซ่อน' : 'ดู' }}</span>
      </button>
      <div v-if="recOpen" class="mt-2 space-y-1.5">
        <div v-for="r in recs" :key="r.kind + r.id" class="flex items-center gap-2 rounded-xl border border-stone-200 p-2">
          <div class="min-w-0 flex-1">
            <div class="truncate font-medium text-stone-900">{{ r.name }} <span class="text-xs font-normal text-stone-500">{{ r.kind === 'ready' ? 'สำเร็จ' : 'สั่งทำ' }}</span></div>
            <div class="truncate text-xs text-stone-500">{{ r.kind === 'custom' && r.from ? 'เริ่มต้น ' : '' }}{{ money(r.price) }} · {{ r.reasons.join(' · ') }}</div>
          </div>
          <button v-if="r.kind === 'ready'" type="button" class="btn-soft h-8 shrink-0 px-2.5 text-xs" @click="addRec(r)">เพิ่มลงร่าง</button>
        </div>
        <div class="flex items-center gap-2">
          <button type="button" class="btn-outline h-8 px-3 text-xs" @click="sendRec">ส่งข้อความแนะนำ</button>
          <span v-if="recNote" class="text-xs text-emerald-700">{{ recNote }}</span>
        </div>
      </div>
    </div>

    <!-- ปุ่มถาม + ข้อความสำเร็จรูป -->
    <div v-if="canType" class="flex items-center gap-1.5 overflow-x-auto border-t border-stone-200 bg-white px-2 py-1.5 [scrollbar-width:none]">
      <span v-if="chat.pendingAsk" class="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800">
        รอลูกค้าตอบ: {{ ASK_FIELDS[chat.pendingAsk.field]?.label }}
        <button type="button" aria-label="ยกเลิกคำถาม" @click="cancelAsk(chat.id)"><AppIcon name="x" :size="12" /></button>
      </span>
      <button v-for="(f, k) in ASK_FIELDS" :key="k" type="button" class="chip chip-off shrink-0 px-2.5 py-1 text-xs whitespace-nowrap" @click="ask(k)">{{ f.label }}</button>
      <button type="button" class="chip chip-off shrink-0 px-2.5 py-1 text-xs whitespace-nowrap" @click="cannedOpen = true">ข้อความสำเร็จรูป</button>
      <button v-if="db.bot.enabled" type="button" class="chip shrink-0 px-2.5 py-1 text-xs whitespace-nowrap" :class="chat.botOff ? 'chip-off' : 'chip-on'" @click="setChatBot(chat.id, !!chat.botOff)">บอท: {{ chat.botOff ? 'ปิดในแชทนี้' : 'เปิด' }}</button>
    </div>

    <!-- ช่องพิมพ์ -->
    <div v-if="replyTo && canType" class="flex items-center gap-2 border-t border-stone-200 bg-stone-50 px-3 py-1.5 text-xs text-stone-600">
      <span class="min-w-0 flex-1 truncate">ตอบกลับ: {{ snippet(replyTo) }}</span>
      <button type="button" aria-label="ยกเลิกตอบกลับ" @click="replyTo = null"><AppIcon name="x" :size="14" /></button>
    </div>
    <p v-if="!canType" class="border-t border-stone-200 bg-amber-50 p-3 text-center text-sm text-amber-800">เกิน 24 ชม. หลังลูกค้าทักล่าสุด Facebook ไม่ให้ตอบข้อความทั่วไป (การ์ดออร์เดอร์/ยอดชำระยังส่งได้) รอให้ลูกค้าทักกลับ</p>
    <form v-else class="flex items-end gap-2 border-t border-stone-200 bg-white p-2" @submit.prevent="send">
      <textarea ref="input" v-model="text" rows="1" class="input max-h-32 min-h-11 flex-1 resize-none py-2.5" :placeholder="`ตอบทาง ${channelLabel}`" @keydown="onKey" />
      <button type="submit" class="btn-primary h-11 w-11 shrink-0 px-0" :disabled="!text.trim()" aria-label="ส่ง"><AppIcon name="send" :size="18" /></button>
    </form>

    <!-- ข้อความสำเร็จรูป -->
    <AppModal v-if="cannedOpen" title="ข้อความสำเร็จรูป" @close="cannedOpen = false; cannedEdit = null">
      <div v-if="cannedEdit" class="space-y-3">
        <div><label class="label">ชื่อ</label><input v-model="cannedEdit.title" class="input" placeholder="เช่น เลขบัญชีโอน" /></div>
        <div><label class="label">ข้อความ</label><textarea v-model="cannedEdit.text" rows="4" class="input" /></div>
        <div class="flex gap-2">
          <button type="button" class="btn-outline flex-1" @click="cannedEdit = null">ยกเลิก</button>
          <button type="button" class="btn-primary flex-1" @click="saveC">บันทึก</button>
        </div>
      </div>
      <div v-else class="space-y-2">
        <div v-for="c in db.cannedReplies" :key="c.id" class="flex gap-1 rounded-xl border border-stone-200 p-1">
          <button type="button" class="min-w-0 flex-1 rounded-lg p-2 text-left hover:bg-stone-50" @click="useCanned(c)">
            <span class="block font-medium text-stone-900">{{ c.title }}</span>
            <span class="block truncate text-xs text-stone-500">{{ c.text }}</span>
          </button>
          <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg text-stone-400 hover:bg-stone-100" aria-label="แก้ไข" @click="cannedEdit = { ...c }"><AppIcon name="edit" :size="16" /></button>
          <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-600" aria-label="ลบ" @click="removeCanned(c.id)"><AppIcon name="trash" :size="16" /></button>
        </div>
        <button type="button" class="btn-soft w-full" @click="cannedEdit = { id: null, title: '', text: '' }"><AppIcon name="plus" :size="16" /> เพิ่มข้อความ</button>
      </div>
    </AppModal>
  </div>
</template>
