<script setup>
import { orderNo } from '../lib/format'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { cancelChatSlip, addCakeCodesToDraft, can, postOrderCard, db, findOrder, sendChat, markRead, findQuote, fbWindowOpen, convertQuote, chatOrderBlock, findCustomer, linkChat, askCustomer, cancelAsk, applyToDraft, ASK_FIELDS, saveCanned, removeCanned, sendBotDraft, dismissBotDraft, setChatBot, staffReplied, recommendText, addRecommendToDraft, slipChatChoices } from '../data/store'
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
import OrderPayModal from './OrderPayModal.vue'
import ChatAttachment from './ChatAttachment.vue'
import { messagePreview } from '../lib/chatMedia'
import { payAccountsOf } from '../lib/payAccounts'
import { slipAccountCheck } from '../lib/slipAccount'
import { kb } from '../lib/viewportFit'
import { showToast } from '../lib/toast'
import { askConfirmEx } from '../lib/confirm'
import { notifyBoxOf, notifyOf } from '../lib/notifyBox'
import { prepareChatImage, uploadChatImage, MAX_CHAT_IMAGES } from '../lib/chatImage'
import { imageErrorMessage } from '../lib/imageResize'
import { getSupabase } from '../lib/supabase'
import { isTypingNow, msOf, pingDue, PRESENCE_POLL_MS, readReceiptId } from '../lib/chatPresence'
import { watchTable } from '../lib/liveWatch'

// เธรดแชทของศูนย์รวมแชท (ฝั่งพนักงาน) · ข้อความจากลูกค้ามาจาก LINE OA / Facebook
// ผังล่าง: ข้อความ (เลื่อนได้) → แถบร่างบอท/แจ้งผล → เครื่องมือ → ช่องพิมพ์
const props = defineProps({ chat: { type: Object, required: true } })
const emit = defineEmits(['edit-draft', 'link', 'open-panel'])
const text = ref('')
const box = ref(null)
const input = ref(null)
const mine = (m) => m.from === 'staff'
const channelLabel = computed(() => (props.chat.channel === 'facebook' ? 'Facebook' : props.chat.channel === 'instagram' ? 'Instagram' : props.chat.channel === 'web' ? 'เว็บ/แอป' : 'LINE'))
// บัญชีของร้านที่ใช้เทียบเลขผู้รับบนสลิป: บัญชีธนาคารและพร้อมเพย์ทุกบัญชีที่ตั้งไว้ (แสดงเครื่องหมายถูกหรือเตือนเท่านั้น)
const shopAccts = computed(() => payAccountsOf(db.shop?.payment))
const slipAcctState = (acc) => slipAccountCheck(acc, {
  bank: shopAccts.value.filter((a) => a.kind === 'bank').map((a) => a.accountNo),
  promptpay: shopAccts.value.filter((a) => a.kind === 'promptpay').map((a) => a.promptpayId),
})
// สถานะการส่ง (Facebook/Instagram ส่งจริงและมีสถานะ · LINE ไม่มีสถานะการส่ง)
function sendState(m) {
  if (props.chat.channel === 'facebook' || props.chat.channel === 'instagram') {
    if (m.delivery === 'sending') return 'กำลังส่ง…'
    if (m.delivery === 'sent') return 'ส่งสำเร็จ'
    if (m.delivery === 'failed') return `ส่งไม่สำเร็จ${m.deliveryError ? `: ${m.deliveryError}` : ''}`
  }
  return `ส่งทาง ${channelLabel.value}`
}
const failed = (m) => mine(m) && (props.chat.channel === 'facebook' || props.chat.channel === 'instagram') && m.delivery === 'failed'
// ผลตรวจสลิป QR ในรูปที่ลูกค้าส่ง (สถานะจาก _shared/slipjob.ts) · ยอดรอพนักงานตรวจ (ยกเว้นยืนยันอัตโนมัติ)
const SLIP_CHIP = {
  matched: ['สลิปจับคู่กับออร์เดอร์แล้ว · รอตรวจยอด', 'bg-emerald-50 text-emerald-700'],
  merged: ['สลิปรวมกับรายการที่ยืนยันแล้ว · เก็บไว้ที่รายการเดิม', 'bg-emerald-50 text-emerald-700'],
  auto_confirmed: ['สลิปยืนยันชำระอัตโนมัติแล้ว · ยังไม่ได้ตรวจกับธนาคาร', 'bg-emerald-50 text-emerald-700'],
  duplicate: ['สลิปนี้เคยส่งแล้ว · ไม่แนบซ้ำ', 'bg-rose-50 text-rose-700'],
  no_order: ['สลิป QR · ยังไม่มีออร์เดอร์ในแชท (เลือกออร์เดอร์แล้วรับชำระได้)', 'bg-amber-50 text-amber-700'],
  received: ['สลิป QR · รับชำระจากสลิปแล้ว', 'bg-emerald-50 text-emerald-700'],
  order_missing: ['สลิป QR · ไม่พบออร์เดอร์ที่คุยล่าสุด', 'bg-amber-50 text-amber-700'],
  order_inactive: ['สลิป QR · ออร์เดอร์เป็นร่างหรือถูกยกเลิก', 'bg-amber-50 text-amber-700'],
  order_paid: ['สลิป QR · ออร์เดอร์ชำระครบแล้ว', 'bg-amber-50 text-amber-700'],
  pending_exists: ['สลิป QR · มียอดรอตรวจของออร์เดอร์นี้อยู่แล้ว', 'bg-amber-50 text-amber-700'],
  upload_failed: ['สลิป QR · บันทึกไฟล์ไม่สำเร็จ ให้ลูกค้าส่งใหม่', 'bg-rose-50 text-rose-700'],
  busy: ['สลิป QR · ออร์เดอร์กำลังถูกแก้ไข ให้ลูกค้าส่งใหม่', 'bg-amber-50 text-amber-700'],
  manual: ['สลิป QR · รอร้านรับชำระ', 'bg-sky-50 text-sky-700'],
  cancelled: ['สลิป QR · ยกเลิกแล้ว', 'bg-stone-100 text-stone-600'],
}
// หัวข้อ + จุดสีของการ์ดสลิป: สีจากโทนของสถานะ (เขียว = สำเร็จ · แดง = ผิดพลาด/ซ้ำ · เหลือง = ต้องดูเอง · เทา = ไม่รู้สถานะ)
function slipChip(s) {
  const [t, cls] = SLIP_CHIP[s?.status === 'matched' && s?.autoConfirmed ? 'auto_confirmed' : s?.status] || ['สลิป QR · ตรวจไม่ได้', 'bg-stone-100 text-stone-600']
  const dot = cls.includes('emerald') ? 'bg-emerald-500' : cls.includes('rose') ? 'bg-rose-500' : cls.includes('amber') ? 'bg-amber-500' : 'bg-stone-400'
  return { title: t, sub: s?.orderCode ? `ออร์เดอร์ ${s.orderCode}` : '', dot }
}
// โหมดแมนนวล: ร้านผูกสลิปที่ลูกค้าส่งกับออร์เดอร์เอง (ที่แนะนำ = ออร์เดอร์ที่คุยล่าสุด หรือออร์เดอร์อื่นของลูกค้าคนเดียวกัน) ในหน้าแชทนี้
const canBindSlip = (m) => can('reportPayment') && m.slipCheck?.status === 'manual' && !!m.slipCheck.slipRef
const slipCheckList = (m) => (Array.isArray(m.slipCheck?.checks) ? m.slipCheck.checks : [])
async function doCancelSlip(m) {
  const customer = m.slipCheck?.orderId ? findCustomer(props.chat.customerId) : null
  const r = await askConfirmEx({ title: 'ยกเลิกสลิปนี้', message: 'สลิปนี้จะไม่ผูกกับออร์เดอร์ และลูกค้าส่งรูปเดิมซ้ำได้', okText: 'ยกเลิกสลิป', danger: true, reason: { label: 'เหตุผลที่ยกเลิก', required: true }, ...notifyBoxOf(customer) })
  if (!r.ok) return
  const res = cancelChatSlip(props.chat.id, m.id, { reason: r.reason, ...notifyOf(r) })
  if (res.error) showToast(res.error, 4000, 'error')
}
const slipChoicesOf = (m) => slipChatChoices(props.chat.id, m.id)
const slipPick = ref(null) // ข้อความสลิปที่กำลังเลือกออร์เดอร์อื่น
const slipBind = ref(null) // { order, target } ของโมดัลผูกสลิป
const slipPickList = computed(() => {
  if (!slipPick.value) return []
  const c = slipChatChoices(props.chat.id, slipPick.value.id)
  return [...(c.suggested ? [c.suggested] : []), ...c.others]
})
function openSlipBind(m, order) {
  slipPick.value = null
  slipBind.value = { order, target: { chatId: props.chat.id, msgId: m.id, at: m.at, slip: m.slipCheck.slipRef, bankCode: m.slipCheck.bankCode, bankName: m.slipCheck.bankName, ref: m.slipCheck.ref, ocrAmount: m.slipCheck.ocrAmount, ocrPaidAt: m.slipCheck.ocrPaidAt } }
}
// Facebook เกิน 24 ชม. หลังลูกค้าทักล่าสุด → พิมพ์ตอบไม่ได้ (การ์ดออร์เดอร์/ยอดชำระยังส่งได้)
const canType = computed(() => fbWindowOpen(props.chat))

// ---------- สถานะพิมพ์/อ่านแล้ว (ตาราง punpang_chat_presence · แยกจากแถวแชท จึงไม่ชนการซิงก์ข้อความ) ----------
const custTypingAt = ref(null) // เวลาที่ลูกค้าพิมพ์ล่าสุด (ISO)
const custReadAt = ref(null) // เวลาที่ลูกค้าเปิดอ่านล่าสุด (ISO)
const nowMs = ref(Date.now())
const custTyping = computed(() => isTypingNow(msOf(custTypingAt.value), nowMs.value))
const custReadId = computed(() => readReceiptId(props.chat.messages, 'staff', custReadAt.value)) // ข้อความของร้านที่ลูกค้าอ่านแล้ว
// เขียนสถานะของพนักงาน (ไม่กระทบการส่ง/อ่านข้อความ)
async function writePresence(patch) {
  const id = props.chat.id
  try {
    const c = await getSupabase()
    if (c) await c.from('punpang_chat_presence').upsert({ chat_id: id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'chat_id' })
  } catch { /* สถานะเป็นของเสริม */ }
}
// ร้านเปิดอ่านแชทแล้ว (เปิดแชท / ข้อความใหม่ตอนอยู่ล่างสุด) → ลูกค้าเห็น "ร้านอ่านแล้ว"
const readNow = () => writePresence({ staff_read_at: new Date().toISOString() })
// พิมพ์อยู่ → แจ้งลูกค้าไม่ถี่กว่าทุก 3 วินาที · ช่องว่าง = ยกเลิกสถานะ
let typingOn = false // ส่งสถานะพิมพ์ไปแล้วและยังไม่ได้ยกเลิก
let typingAt = 0
function onTyping(e) {
  if (!e.target.value.trim()) return clearTyping()
  const now = Date.now()
  if (!pingDue(typingAt, now)) return
  typingAt = now
  typingOn = true
  writePresence({ staff_typing_at: new Date(now).toISOString() })
}
function clearTyping() {
  if (!typingOn) return
  typingOn = false
  typingAt = 0
  writePresence({ staff_typing_at: null })
}
// สถานะลูกค้า: Realtime บนตาราง punpang_chat_presence ของแชทนี้ (เปลี่ยนแล้วได้ทันที) · ไม่มี Realtime = โพลล์ทุก 3 วินาที · มี = โพลล์สำรองทุก 30 วินาที
let presenceWatch = null
let presenceWatchSeq = 0
let presenceTimer = null
let presenceOff = true
let nowTimer = null
function presenceLoop(ms) {
  clearTimeout(presenceTimer)
  if (!presenceOff) presenceTimer = setTimeout(pollPresence, ms)
}
function applyCustomerRow(r, id) {
  if (id !== props.chat.id) return
  nowMs.value = Date.now()
  custTypingAt.value = r?.customer_typing_at || null
  custReadAt.value = r?.customer_read_at || null
}
async function pollPresence() {
  const id = props.chat.id
  if (typeof document === 'undefined' || !document.hidden) {
    try {
      const c = await getSupabase()
      const r = c ? await c.from('punpang_chat_presence').select('customer_typing_at,customer_read_at').eq('chat_id', id).maybeSingle() : null
      if (r && !r.error) applyCustomerRow(r.data, id)
    } catch { /* ไม่กระทบแชท */ }
  }
  presenceLoop(presenceWatch?.isLive() ? 30000 : PRESENCE_POLL_MS)
}
// เริ่มฟังสถานะของแชทนี้ (แชทเปลี่ยน = เลิกฟังแชทเดิม) · อ่านค่าปัจจุบันทันทีด้วย
async function startPresenceWatch() {
  const seq = ++presenceWatchSeq
  const id = props.chat.id
  presenceWatch?.stop()
  presenceWatch = null
  const w = await watchTable({ table: 'punpang_chat_presence', event: '*', filter: `chat_id=eq.${id}` }, (payload) => applyCustomerRow(payload?.new, id))
  if (seq === presenceWatchSeq && !presenceOff) presenceWatch = w
  else w.stop()
  presenceLoop(0)
}
watch(() => props.chat.id, () => {
  custTypingAt.value = null
  custReadAt.value = null
  typingOn = false
  typingAt = 0
  startPresenceWatch()
})

// ---------- เลื่อนลงล่าง / ข้อความใหม่ ----------
function scrollEnd() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}
// อยู่ล่างสุดไหม: ถ้าเลื่อนขึ้นไปอ่านของเก่า ข้อความใหม่จะไม่เลื่อนทับ แต่ขึ้นปุ่ม "ข้อความใหม่" แทน
const atBottom = ref(true)
const unseen = ref(0)
function onScroll() {
  const el = box.value
  if (!el) return
  atBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
  if (atBottom.value) {
    unseen.value = 0
    if (props.chat.unreadStaff) { markRead(props.chat.id); readNow() }
  }
}
function jumpEnd() {
  atBottom.value = true
  unseen.value = 0
  scrollEnd()
  markRead(props.chat.id)
  readNow()
}

// ---------- รูปที่จะส่ง: เลือกจากอัลบั้มหรือถ่ายใหม่ → ดูตัวอย่างก่อนส่ง (ส่งพร้อมคำบรรยายได้) ----------
const pics = ref([]) // { id, blob, url (พรีวิว), width, height }
const picBusy = ref(false) // กำลังย่อรูป
const sendingPics = ref(false) // กำลังอัปโหลด/ส่ง
const albumInput = ref(null)
const camInput = ref(null)
const canSend = computed(() => canType.value && (!!text.value.trim() || pics.value.length > 0) && !picBusy.value && !sendingPics.value)
function clearPics() {
  pics.value.forEach((p) => URL.revokeObjectURL(p.url))
  pics.value = []
}
function removePic(id) {
  const p = pics.value.find((x) => x.id === id)
  if (p) URL.revokeObjectURL(p.url)
  pics.value = pics.value.filter((x) => x.id !== id)
}
async function addPics(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = '' // เลือกรูปเดิมซ้ำได้
  if (!files.length) return
  const room = MAX_CHAT_IMAGES - pics.value.length
  if (room <= 0) return showToast(`ส่งรูปได้ครั้งละไม่เกิน ${MAX_CHAT_IMAGES} รูป`, 5000, 'error')
  picBusy.value = true
  try {
    for (const f of files.slice(0, room)) {
      try {
        const p = await prepareChatImage(f)
        pics.value.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...p })
      } catch (err) {
        showToast(imageErrorMessage(err), 6000, 'error')
      }
    }
    if (files.length > room) showToast(`เพิ่มได้อีก ${room} รูปเท่านั้น (ไม่เกิน ${MAX_CHAT_IMAGES} รูปต่อครั้ง)`, 5000, 'error')
  } finally {
    picBusy.value = false
  }
}
watch(() => props.chat.id, () => clearPics()) // เปลี่ยนแชท = ไม่ให้รูปของแชทเดิมค้างอยู่
onBeforeUnmount(clearPics)

function send() {
  if (!canSend.value) return
  if (pics.value.length) return sendPics()
  const t = text.value
  sendChat(props.chat.id, 'staff', t, { replyTo: replyTo.value?.id })
  clearTyping() // ส่งแล้ว = หยุดพิมพ์
  staffReplied(props.chat.id, t) // เรียนรู้คู่ ถาม→ตอบ + นับสถิติบอท
  text.value = ''
  replyTo.value = null
  jumpEnd()
}
async function sendPics() {
  sendingPics.value = true
  try {
    const attachments = []
    for (const p of pics.value) attachments.push(await uploadChatImage(props.chat, p.blob, p))
    const t = text.value
    sendChat(props.chat.id, 'staff', t, { replyTo: replyTo.value?.id, attachments })
    clearTyping()
    if (t.trim()) staffReplied(props.chat.id, t)
    clearPics()
    text.value = ''
    replyTo.value = null
    jumpEnd()
  } catch (err) {
    showToast(err?.message || 'ส่งรูปไม่สำเร็จ', 6000, 'error')
  } finally {
    sendingPics.value = false
  }
}
function onKey(e) {
  // Enter ส่ง · Shift+Enter ขึ้นบรรทัด
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    send()
  }
}
// ช่องพิมพ์ยืดตามข้อความ (สูงสุดตาม max-h ใน class)
function fitInput() {
  const el = input.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${el.scrollHeight}px`
}
watch(text, () => nextTick(fitInput))

const count = computed(() => props.chat.messages.length)
watch(count, (n, o) => {
  if (atBottom.value) {
    scrollEnd()
    if (props.chat.unreadStaff) { markRead(props.chat.id); readNow() }
  } else if (n > o) {
    unseen.value += n - o
  }
})
// แป้นพิมพ์มือถือเปิด/ปิด → เลื่อนให้ข้อความล่าสุดอยู่เหนือช่องพิมพ์
watch(() => kb.open, () => scrollEnd())
onMounted(() => {
  markRead(props.chat.id)
  readNow()
  scrollEnd()
  presenceOff = false
  startPresenceWatch()
  nowTimer = setInterval(() => { nowMs.value = Date.now() }, 1000) // ตัวนับเวลา: สถานะพิมพ์หมดช่วงเองแม้ไม่มีสัญญาณใหม่
})
onBeforeUnmount(() => {
  clearTyping()
  presenceOff = true
  clearTimeout(presenceTimer)
  presenceWatch?.stop()
  presenceWatch = null
  clearInterval(nowTimer)
})

// ---------- ข้อความต่อเนื่อง: ผู้ส่งเดียวกันภายใน 5 นาที (วันเดียวกัน) = กลุ่มเดียว ----------
const msgs = computed(() => props.chat.messages)
const RUN_MS = 5 * 60e3
function sameRun(a, b) {
  if (!a || !b) return false
  if (a.from !== b.from || a.by !== b.by) return false
  if (a.kind === 'order' || a.kind === 'quote' || b.kind === 'order' || b.kind === 'quote') return false
  if (a.ask || a.answerFor || b.ask || b.answerFor) return false
  if (a.at.slice(0, 10) !== b.at.slice(0, 10)) return false
  return Date.parse(b.at) - Date.parse(a.at) < RUN_MS
}
const isHead = (i) => !sameRun(msgs.value[i - 1], msgs.value[i])
const isTail = (i) => !sameRun(msgs.value[i], msgs.value[i + 1])
// แสดงวันที่คั่นเมื่อเปลี่ยนวัน
const showDay = (i) => i === 0 || msgs.value[i - 1].at.slice(0, 10) !== msgs.value[i].at.slice(0, 10)
const gapCls = (i) => (showDay(i) ? '' : isHead(i) ? 'mt-3' : 'mt-0.5')
const bubble = (m) => (mine(m)
  ? 'rounded-2xl rounded-br-md bg-brand-600 text-white'
  : 'rounded-2xl rounded-bl-md bg-white text-stone-900 shadow-sm ring-1 ring-stone-200/80')

// ส่งการ์ดสรุปออร์เดอร์ของลูกค้ารายนี้ (ปุ่มในแถบเครื่องมือ): 1 ใบ → ส่งเลย · หลายใบ → เลือกก่อน
const sumOpen = ref(false)
const custOrders = computed(() => (props.chat.customerId ? db.orders.filter((o) => o.customerId === props.chat.customerId && o.channel !== 'pos' && o.status !== 'draft') : []))
function sendSummary(o) {
  sumOpen.value = false
  postOrderCard(o, props.chat)
  showToast(`ส่งสรุปออร์เดอร์ ${o.code} แล้ว`)
}
function openSummary() {
  const l = custOrders.value
  if (l.length === 1) sendSummary(l[0])
  else if (l.length) sumOpen.value = true
}

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
  revise: { t: 'ลูกค้าขอแก้', cls: 'bg-rose-50 text-rose-700' },
  need_phone: { t: 'ลูกค้ายืนยัน · รอเบอร์โทร', cls: 'bg-orange-50 text-orange-700' },
  customer_ok: { t: 'ลูกค้ากดยืนยัน · รอสร้างออร์เดอร์', cls: 'bg-orange-50 text-orange-700' },
  converting: { t: 'กำลังสร้างออร์เดอร์', cls: 'bg-orange-50 text-orange-700' },
  superseded: { t: 'มีใบใหม่แล้ว', cls: 'bg-stone-100 text-stone-500' },
}
function quoteView(m) {
  const q = findQuote(m.quoteId)
  if (!q) return null
  const t = orderTotals({ ...q.payload, payments: [], adjustment: null, couponsUsed: [] })
  const lines = q.payload.items.flatMap((i) => discountLines(i.discounts, i.qty))
  return { q, t, lines }
}
// ลูกค้ายืนยันแล้วแต่ยังไม่ผูก/ไม่มีเบอร์ → พนักงานผูก/ใส่เบอร์แล้วสร้างออร์เดอร์
const block = computed(() => chatOrderBlock(props.chat.id))
const convertError = ref('')
function convert(q) {
  const r = convertQuote(q.id)
  convertError.value = r.error || ''
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
const snippet = (m) => { if (!m) return ''; if (m.kind === 'order') return 'สรุปออร์เดอร์'; if (m.kind === 'quote') return 'ใบเสนอ'; const t = messagePreview(m); return t.length > 60 ? `${t.slice(0, 60)}…` : t }

// ---------- ตอบกลับข้อความ ----------
const replyTo = ref(null)
function startReply(m) {
  replyTo.value = m
  nextTick(() => input.value?.focus())
}

// ---------- บอทตอบแชท: ร่างคำตอบ (โหมดแนะนำ) ----------
const botDraft = computed(() => props.chat.botDraft || null)
const showDraft = computed(() => !!botDraft.value && !botDraft.value.editing && canType.value)
const botExpanded = ref(false)
const botLong = computed(() => (botDraft.value?.text || '').length > 140)
watch(() => botDraft.value?.text, () => { botExpanded.value = false })
const confPct = (d) => Math.round(d.confidence * 100)
function editBotDraft() {
  const d = { ...botDraft.value }
  text.value = d.text
  props.chat.botDraft = { ...d, editing: true } // ซ่อนแถบร่าง · พอพนักงานกดส่ง staffReplied จะเทียบกับร่างเดิมแล้วนับเป็น "แก้"
  nextTick(() => input.value?.focus())
}
const SOURCE_LABEL = { ai: 'บอท AI', rule: 'กฎ', faq: 'FAQ', hours: 'เวลาเปิด', price: 'ราคา/แนะนำสินค้า', learned: 'เรียนรู้จากพนักงาน', order: 'สถานะออร์เดอร์', closed: 'แจ้งร้านปิด', ask: 'ขอข้อมูล', offhours: 'นอกเวลา', handoff: 'ส่งต่อพนักงาน', order_unverified: 'ยืนยันตัวตนไม่ได้' }

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

// มือถือ: แถบเครื่องมือเปิด/ปิดด้วยปุ่ม + (คอมแสดงเสมอ) · ขณะแป้นพิมพ์เปิด แถบจะซ่อน จึงกดเปิดเครื่องมือ = ปิดแป้นพิมพ์ก่อน
const toolsOpen = ref(false)
function toggleTools() {
  if (!toolsOpen.value && kb.open) input.value?.blur()
  toolsOpen.value = !toolsOpen.value
}
// แถบเครื่องมือเปลี่ยนความสูง → ถ้ากำลังอยู่ล่างสุด ให้เลื่อนตามให้ข้อความล่าสุดยังเห็น
watch(toolsOpen, () => { if (atBottom.value) scrollEnd() })

const replyPreview = computed(() => (replyTo.value ? snippet(replyTo.value) : ''))
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <!-- ข้อความ -->
    <div class="relative min-h-0 flex-1 bg-stone-50">
      <div ref="box" class="absolute inset-0 overflow-y-auto overscroll-contain px-3 lg:px-6" :class="kb.open ? 'pt-2 pb-2' : 'pt-4 pb-3'" @scroll="onScroll">
        <div v-if="!chat.messages.length" class="flex h-full flex-col items-center justify-center gap-2 text-sm text-stone-400">
          <AppIcon name="chat" :size="32" class="text-stone-300" />
          ยังไม่มีข้อความในแชทนี้
        </div>
        <template v-for="(m, i) in chat.messages" :key="m.id">
          <div v-if="showDay(i)" class="my-4 flex justify-center">
            <span class="rounded-full bg-white px-3 py-0.5 text-xs font-medium text-stone-500 shadow-sm ring-1 ring-stone-200/70">{{ dateOnly(m.at) }}</span>
          </div>
          <div class="flex" :class="[mine(m) ? 'justify-end' : 'justify-start', gapCls(i)]">
            <!-- การ์ดออร์เดอร์ -->
            <div v-if="m.kind === 'order' && card(m)" class="w-80 max-w-[88%] rounded-2xl border border-stone-200 bg-white p-3.5 shadow-sm">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-brand-700">สรุปออร์เดอร์ {{ orderNo(card(m).o.code) }}</span>
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS[card(m).o.status]?.cls">{{ STATUS[card(m).o.status]?.label }}</span>
                <PayDueBadge :order="card(m).o" short />
              </div>
              <div class="mt-1 text-sm font-medium break-words text-stone-900">{{ card(m).first }}<span v-if="card(m).more > 0" class="text-stone-500"> +{{ card(m).more }} รายการ</span></div>
              <div class="mt-0.5 text-xs text-stone-500">{{ card(m).o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }} · {{ dateTime(card(m).o.pickupAt) }}<template v-if="card(m).o.placeName"> · {{ card(m).o.placeName }}</template></div>
              <div class="mt-2 flex items-end justify-between gap-2 border-t border-stone-100 pt-2">
                <span class="text-xs text-stone-500">ยอดรวม <b class="block text-base text-stone-900">{{ money(card(m).t.total) }}</b></span>
                <span class="text-right text-xs" :class="card(m).t.balance > 0 ? 'text-amber-700' : 'text-brand-700'">{{ card(m).t.balance > 0 ? `ค้าง ${money(card(m).t.balance)}` : 'ชำระครบ' }}</span>
              </div>
              <RouterLink :to="`/admin/orders/${card(m).o.id}`" class="btn-soft mt-2.5 h-9 w-full text-sm">เปิดออร์เดอร์</RouterLink>
            </div>
            <!-- ใบเสนอ -->
            <div v-else-if="m.kind === 'quote' && quoteView(m)" class="w-80 max-w-[90%] rounded-2xl border-2 border-brand-200 bg-white p-3.5 shadow-sm" :class="quoteView(m).q.status === 'superseded' ? 'opacity-60' : ''">
              <div class="flex items-center justify-between gap-2">
                <span class="text-xs font-semibold text-brand-700">ใบเสนอ {{ quoteView(m).q.code }}</span>
                <span class="rounded-full px-2 py-0.5 text-xs font-medium" :class="QUOTE_STATUS[quoteView(m).q.status].cls">{{ QUOTE_STATUS[quoteView(m).q.status].t }}</span>
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
              <div v-if="quoteView(m).t.vatMode" class="mt-1 text-right text-xs text-stone-400">{{ quoteView(m).t.vatMode === 'exclusive' ? `ยอดรวม VAT ${quoteView(m).t.vatRate}% (บวกเพิ่ม ${money(quoteView(m).t.vat)}) แล้ว` : `ราคารวม VAT ${quoteView(m).t.vatRate}% แล้ว (${money(quoteView(m).t.vat)})` }}</div>
              <!-- การดำเนินการของพนักงาน -->
              <RouterLink v-if="quoteView(m).q.orderId" :to="`/admin/orders/${quoteView(m).q.orderId}`" class="btn-soft mt-2.5 h-9 w-full text-sm">เปิดออร์เดอร์</RouterLink>
              <template v-else-if="['need_phone', 'customer_ok', 'converting'].includes(quoteView(m).q.status)">
                <p v-if="block" class="mt-2 text-xs text-orange-700">{{ block }} · <button type="button" class="font-medium underline" @click="emit('link')">ผูก/สร้างลูกค้า</button></p>
                <button type="button" class="btn-primary mt-2.5 h-9 w-full text-sm" :disabled="!!block" @click="convert(quoteView(m).q)">สร้างออร์เดอร์</button>
                <p v-if="convertError" class="mt-1 text-xs text-rose-700" role="alert">{{ convertError }}</p>
              </template>
              <button v-else-if="['pending', 'revise'].includes(quoteView(m).q.status)" type="button" class="btn-outline mt-2.5 h-9 w-full text-sm" @click="emit('edit-draft')">แก้ร่างแล้วส่งใหม่</button>
            </div>
            <!-- ข้อความ -->
            <div v-else class="group max-w-[80%] lg:max-w-[min(78%,40rem)]">
              <div class="px-3.5 py-2 text-[15px] leading-relaxed break-words whitespace-pre-line" :class="bubble(m)">
                <!-- อ้างอิงข้อความที่ตอบ -->
                <div v-if="m.replyTo && byId(m.replyTo)" class="mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs leading-snug" :class="mine(m) ? 'border-white/60 bg-white/15 text-white/90' : 'border-brand-400 bg-stone-50 text-stone-500'">{{ snippet(byId(m.replyTo)) }}</div>
                <ChatAttachment v-for="(a, k) in m.attachments || []" :key="k" :a="a" />
                <template v-if="m.text">{{ m.text }}</template>
              </div>
              <!-- สลิป QR ในรูปที่ลูกค้าส่ง: การ์ดสรุปผล + ยอดที่อ่านจากภาพ + ปุ่มผูก (โหมดแมนนวล) -->
              <div v-if="m.slipCheck" class="mt-1.5 w-full max-w-xs rounded-2xl border border-stone-200 bg-white p-3 text-xs shadow-sm">
                <div class="flex items-start gap-2">
                  <span class="mt-1 h-2 w-2 shrink-0 rounded-full" :class="slipChip(m.slipCheck).dot" />
                  <div class="min-w-0">
                    <div class="font-semibold leading-snug text-stone-800">{{ slipChip(m.slipCheck).title }}</div>
                    <div v-if="slipChip(m.slipCheck).sub" class="mt-0.5 text-stone-500">{{ slipChip(m.slipCheck).sub }}</div>
                  </div>
                  <button v-if="canBindSlip(m)" type="button" class="-mt-1 -mr-1 ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-rose-600 hover:bg-rose-50" aria-label="ยกเลิกสลิป" title="ยกเลิกสลิป" data-slip-cancel @click="doCancelSlip(m)"><AppIcon name="x" :size="18" /></button>
                </div>
                <div v-if="m.slipCheck.ocrAmount != null" class="mt-2.5 grid grid-cols-2 gap-2 rounded-xl bg-sky-50 px-3 py-2 text-sky-900">
                  <div>
                    <div class="text-xs font-medium text-sky-700">ยอดตามสลิป</div>
                    <div class="text-sm font-semibold">{{ money(m.slipCheck.ocrAmount) }}</div>
                  </div>
                  <div>
                    <div class="text-xs font-medium text-sky-700">วัน-เวลาโอน</div>
                    <div class="text-sm font-semibold">{{ m.slipCheck.ocrPaidAt ? dateTime(m.slipCheck.ocrPaidAt) : '-' }}</div>
                  </div>
                  <div v-if="m.slipCheck.ocrReceiverAccount" class="col-span-2">
                    <div class="text-xs font-medium text-sky-700">เลขที่บัญชีผู้รับ</div>
                    <div class="text-sm font-semibold break-words">{{ m.slipCheck.ocrReceiverAccount }}</div>
                    <div v-if="slipAcctState(m.slipCheck.ocrReceiverAccount) === 'match'" class="mt-0.5 text-xs font-semibold text-emerald-700">✓ ตรงกับบัญชีของร้าน</div>
                    <div v-else-if="slipAcctState(m.slipCheck.ocrReceiverAccount) === 'mismatch'" class="mt-0.5 text-xs font-semibold text-amber-700">⚠ ไม่ตรงกับบัญชีของร้าน</div>
                  </div>
                  <div class="col-span-2 text-xs text-sky-700">{{ m.slipCheck.autoConfirmed ? 'อ่านจากภาพ · ยืนยันอัตโนมัติแล้ว ยังไม่ได้ตรวจกับธนาคาร' : 'อ่านจากภาพ · ตรวจกับธนาคารก่อนยืนยัน' }}</div>
                </div>
                <ul v-if="slipCheckList(m).length" class="mt-2.5 space-y-1 rounded-xl bg-white p-2.5 text-xs" aria-label="เครื่องหมายตรวจสลิป">
                  <li v-for="(c, k) in slipCheckList(m)" :key="k" class="flex items-start gap-1.5" :class="c.ok === true ? 'text-emerald-700' : c.ok === false ? 'text-rose-700' : 'text-stone-500'"><span aria-hidden="true" class="font-bold">{{ c.ok === true ? '✓' : c.ok === false ? '✗' : '–' }}</span><span>{{ c.text }}</span></li>
                </ul>
                <!-- โหมดแมนนวล: ผูกกับออร์เดอร์ที่แนะนำ หรือเลือกออร์เดอร์อื่นของลูกค้า (ในหน้าแชท ไม่เปลี่ยนหน้า) -->
                <div v-if="canBindSlip(m)" class="mt-2.5 flex gap-2">
                  <button v-if="slipChoicesOf(m).suggested" type="button" class="btn-primary h-9 min-w-0 flex-1 truncate px-3 text-xs" :disabled="!(slipChoicesOf(m).suggested.room > 0)" data-slip-bind @click="openSlipBind(m, slipChoicesOf(m).suggested.order)">รับชำระ {{ slipChoicesOf(m).suggested.order.code }}</button>
                  <button type="button" class="btn-outline h-9 shrink-0 px-3 text-xs" data-slip-pick @click="slipPick = m">{{ slipChoicesOf(m).suggested ? 'เลือกอื่น' : 'เลือกออร์เดอร์' }}</button>
                </div>
              </div>
              <!-- คำตอบของปุ่มถาม -->
              <div v-if="m.answerFor" class="mt-1 flex flex-wrap items-center gap-1 text-xs">
                <span class="rounded-full bg-brand-50 px-2 py-0.5 font-medium text-brand-800">ตอบ: {{ ASK_FIELDS[m.answerFor]?.label }}</span>
                <span v-if="m.filled?.done?.length" class="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">กรอกแล้ว: {{ m.filled.done.map((d) => d.label).join(', ') }}</span>
                <span v-else class="rounded-full bg-amber-50 px-2 py-0.5 text-amber-700">อ่านค่าไม่ได้ กรอกเอง</span>
              </div>
              <!-- รหัสเค้กสั่งทำจากหน้าเว็บ → เพิ่มลงร่าง -->
              <div v-if="hasCode(m)" class="mt-1 space-y-1">
                <button type="button" class="inline-flex items-center gap-1 rounded-full border border-brand-300 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800 hover:bg-brand-100" @click="addCode(m)"><AppIcon name="cake" :size="13" /> เพิ่มเค้กนี้ลงร่างออร์เดอร์</button>
                <template v-if="codeResult[m.id]">
                  <p v-if="codeResult[m.id].added.length" class="text-xs font-medium text-emerald-700" role="status">เพิ่มแล้ว: {{ codeResult[m.id].added.join(', ') }}</p>
                  <p v-for="(w, k) in codeResult[m.id].warnings" :key="'w' + k" class="text-xs text-amber-700">⚠ {{ w }}</p>
                  <p v-for="(er, k) in codeResult[m.id].errors" :key="'e' + k" class="text-xs text-rose-700" role="alert">{{ er }}</p>
                </template>
              </div>
              <!-- ข้อมูลที่จับได้ → กดกรอก -->
              <div v-if="entities(m).length" class="mt-1 flex flex-wrap gap-1">
                <button v-for="e in entities(m)" :key="e.type + e.value" type="button" class="inline-flex items-center gap-1 rounded-full border border-brand-200 bg-white px-2 py-0.5 text-xs font-medium text-brand-800 hover:bg-brand-50" :title="`กรอก${ENT[e.type].label}ลงร่าง`" @click="fill(e)">
                  <AppIcon :name="ENT[e.type].icon" :size="12" /> {{ entText(e) }} <span class="font-medium text-brand-700">กรอก</span>
                </button>
              </div>
              <!-- เวลา/สถานะ: เฉพาะข้อความสุดท้ายของกลุ่ม · ปุ่มตอบกลับทุกข้อความ (บนคอมแสดงเมื่อเอาเมาส์ชี้) -->
              <div class="flex min-h-4 items-center gap-2 px-1 text-xs leading-4 text-stone-500" :class="mine(m) ? 'justify-end' : ''">
                <span v-if="isTail(i)" :class="failed(m) ? 'font-medium text-rose-700' : ''" :title="dateTime(m.at)">{{ timeOnly(m.at) }}<template v-if="m.from === 'staff'"> · {{ sendState(m) }}<template v-if="m.by === 'ระบบ'"> · อัตโนมัติ</template><template v-if="m.id === custReadId"> · ลูกค้าอ่านแล้ว</template></template><template v-if="m.ask"> · ถาม{{ ASK_FIELDS[m.ask]?.label.replace('ขอ', '') }}</template></span>
                <button v-if="canType" type="button" class="tap font-medium text-stone-600 hover:text-brand-700 focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100" :aria-label="`ตอบกลับ: ${snippet(m)}`" @click="startReply(m)">ตอบกลับ</button>
              </div>
            </div>
          </div>
        </template>
      </div>
      <!-- ลูกค้ากำลังพิมพ์ (ซ้อนบนข้อความ ไม่ดันเค้าโครง) -->
      <div v-if="custTyping" class="pointer-events-none absolute bottom-2 left-3 z-10 rounded-full bg-white px-3 py-1 text-xs text-stone-500 shadow-sm ring-1 ring-stone-200" role="status">ลูกค้ากำลังพิมพ์…</div>
      <!-- ข้อความใหม่ (กำลังเลื่อนขึ้นไปอ่านของเก่า) -->
      <button v-if="!atBottom" type="button" class="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-md ring-1 ring-stone-200 hover:bg-brand-50" @click="jumpEnd">
        <AppIcon name="next" :size="14" class="rotate-90" />
        {{ unseen ? `ข้อความใหม่ ${unseen}` : 'ไปข้อความล่าสุด' }}
      </button>
    </div>

    <!-- แจ้งผลการกรอก -->
    <div v-if="notice" class="flex flex-wrap items-center gap-2 border-t border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">
      <AppIcon name="check" :size="16" />
      <span class="min-w-0 flex-1">กรอกลงร่างแล้ว: {{ notice.done.map((d) => `${d.label} ${d.value}`).join(' · ') }}</span>
      <button v-if="notice.suggest" type="button" class="btn-soft h-8 px-2.5 text-xs" @click="linkSuggest">ผูกกับ {{ suggestName }}</button>
      <button type="button" class="btn-outline h-8 px-2.5 text-xs" @click="emit('open-panel'); notice = null">เปิดแผงออร์เดอร์</button>
      <button type="button" class="text-emerald-700" aria-label="ปิด" @click="notice = null"><AppIcon name="x" :size="16" /></button>
    </div>

    <!-- ส่วนล่าง: ร่างบอท · แนะนำสินค้า · เครื่องมือ · ช่องพิมพ์ -->
    <div class="shrink-0 border-t border-stone-200 bg-white" :class="kb.open ? '' : 'pb-[env(safe-area-inset-bottom)]'">
      <input ref="camInput" type="file" accept="image/*" capture="environment" class="hidden" tabindex="-1" aria-hidden="true" @change="addPics" />
      <input ref="albumInput" type="file" accept="image/*" multiple class="hidden" tabindex="-1" aria-hidden="true" @change="addPics" />
      <!-- ร่างคำตอบจากบอท -->
      <!-- แป้นพิมพ์เปิด: ร่างเป็นแถบบรรทัดเดียว เพื่อให้พื้นที่ข้อความมากที่สุด -->
      <div v-if="showDraft && kb.open" class="mx-2 mt-2 flex items-center gap-1 rounded-xl border border-violet-200 bg-violet-50 py-1 pr-1 pl-2.5 text-sm">
        <span class="shrink-0 text-xs font-semibold text-violet-800">{{ botDraft.handoff ? 'บอทส่งต่อ' : 'ร่างบอท' }}</span>
        <span class="min-w-0 flex-1 truncate text-stone-900">{{ botDraft.text }}</span>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-violet-700 hover:bg-white" aria-label="ทิ้งร่างบอท" @click="dismissBotDraft(chat.id)"><AppIcon name="x" :size="15" /></button>
        <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-violet-700 hover:bg-white" aria-label="แก้ร่างบอทก่อนส่ง" @click="editBotDraft"><AppIcon name="edit" :size="15" /></button>
        <button type="button" class="btn-primary h-9 shrink-0 px-3 text-xs" @click="sendBotDraft(chat.id)">ส่งเลย</button>
      </div>
      <div v-else-if="showDraft" class="mx-3 mt-3 rounded-2xl border border-violet-200 bg-violet-50 p-3 text-sm">
        <div class="flex flex-wrap items-center gap-1.5 text-xs">
          <span class="rounded-full bg-white px-2 py-0.5 font-semibold text-violet-800 ring-1 ring-violet-200">{{ botDraft.handoff ? 'บอทส่งต่อให้พนักงาน' : 'ร่างจากบอท' }}</span>
          <span class="text-violet-700">{{ SOURCE_LABEL[botDraft.source] || botDraft.source }}<template v-if="botDraft.confidence"> · {{ confPct(botDraft) }}%</template></span>
          <span class="min-w-0 truncate text-violet-700">{{ botDraft.reason }}</span>
        </div>
        <p v-if="botDraft.prefix" class="mt-2 rounded-lg bg-white/70 px-2.5 py-1.5 text-xs whitespace-pre-line text-violet-900"><b>ส่งก่อน (แจ้งร้านปิด):</b> {{ botDraft.prefix }}</p>
        <p class="mt-2 whitespace-pre-line text-stone-900" :class="botExpanded ? '' : 'line-clamp-3'">{{ botDraft.text }}</p>
        <div class="mt-2.5 flex flex-wrap items-center justify-end gap-2">
          <button v-if="botLong" type="button" class="mr-auto text-xs font-medium text-violet-700 underline" @click="botExpanded = !botExpanded">{{ botExpanded ? 'ย่อข้อความ' : 'ดูทั้งหมด' }}</button>
          <button type="button" class="btn-outline h-9 px-3 text-xs" @click="dismissBotDraft(chat.id)">ทิ้ง</button>
          <button type="button" class="btn-outline h-9 px-3 text-xs" @click="editBotDraft">แก้ก่อนส่ง</button>
          <button type="button" class="btn-primary h-9 px-4 text-xs" @click="sendBotDraft(chat.id)">ส่งเลย</button>
        </div>
      </div>
      <p v-else-if="chat.botHandoff && !botDraft && !kb.open" class="px-3 pt-2.5 text-xs text-violet-700">บอทไม่แน่ใจ/ไม่ตอบเรื่องนี้ — ส่งต่อให้พนักงานตอบ</p>

      <!-- แนะนำสินค้า (เปิดจากปุ่มในแถบเครื่องมือ) -->
      <div v-if="recOpen && recs.length && canType && !kb.open" class="mx-3 mt-2.5 rounded-2xl border border-stone-200 bg-stone-50 p-2.5 text-sm">
        <div class="mb-2 flex items-center justify-between gap-2 text-xs text-stone-500">
          <span class="min-w-0 truncate">แนะนำจาก: {{ intentSummary(recIntent).join(' · ') || 'ข้อความลูกค้า' }}</span>
          <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-white" aria-label="ปิดรายการแนะนำ" @click="recOpen = false"><AppIcon name="x" :size="14" /></button>
        </div>
        <ul class="space-y-1.5">
          <li v-for="r in recs" :key="r.kind + r.id" class="flex items-center gap-2 rounded-xl bg-white p-2 ring-1 ring-stone-200">
            <div class="min-w-0 flex-1">
              <div class="truncate font-medium text-stone-900">{{ r.name }} <span class="text-xs font-normal text-stone-500">{{ r.kind === 'ready' ? 'สำเร็จ' : 'สั่งทำ' }}</span></div>
              <div class="truncate text-xs text-stone-500">{{ r.kind === 'custom' && r.from ? 'เริ่มต้น ' : '' }}{{ money(r.price) }} · {{ r.reasons.join(' · ') }}</div>
            </div>
            <button v-if="r.kind === 'ready'" type="button" class="btn-soft h-8 shrink-0 px-2.5 text-xs" @click="addRec(r)">เพิ่มลงร่าง</button>
          </li>
        </ul>
        <div class="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" class="btn-outline h-8 px-3 text-xs" @click="sendRec">ส่งข้อความแนะนำ</button>
          <span v-if="recNote" class="text-xs text-emerald-700" role="status">{{ recNote }}</span>
        </div>
      </div>

      <!-- เครื่องมือ: ถามลูกค้า · สรุปออร์เดอร์ · ข้อความสำเร็จรูป · บอท (คอมแสดงเสมอ · มือถือกดปุ่ม + เพื่อเปิด) -->
      <div v-if="canType && !kb.open" class="items-center gap-1.5 px-3 pt-2.5 [scrollbar-width:none]" :class="toolsOpen ? 'flex overflow-x-auto lg:flex-wrap lg:overflow-visible' : 'hidden lg:flex lg:flex-wrap'">
        <span v-if="chat.pendingAsk" class="inline-flex h-8 items-center gap-1 rounded-full bg-amber-50 py-0 pr-1 pl-3 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
          รอลูกค้าตอบ: {{ ASK_FIELDS[chat.pendingAsk.field]?.label }}
          <button type="button" class="flex h-6 w-6 items-center justify-center rounded-full hover:bg-amber-100" aria-label="ยกเลิกคำถาม" @click="cancelAsk(chat.id)"><AppIcon name="x" :size="12" /></button>
        </span>
        <span class="hidden text-xs font-medium text-stone-500 lg:inline">ถาม:</span>
        <button v-for="(f, k) in ASK_FIELDS" :key="k" type="button" class="chip chip-off h-8 px-3 text-xs whitespace-nowrap" @click="ask(k)">{{ f.label }}</button>
        <span class="mx-0.5 hidden h-5 w-px bg-stone-200 lg:inline-block" aria-hidden="true" />
        <button v-if="custOrders.length && can('createOrder')" type="button" class="chip h-8 border-brand-300 bg-brand-50 px-3 text-xs whitespace-nowrap text-brand-800 hover:bg-brand-100" data-send-summary @click="openSummary">สรุปออร์เดอร์</button>
        <button type="button" class="chip chip-off h-8 px-3 text-xs whitespace-nowrap" @click="cannedOpen = true">ข้อความสำเร็จรูป</button>
        <button type="button" class="chip chip-off h-8 px-3 text-xs whitespace-nowrap" @click="camInput?.click()">ถ่ายรูป</button>
        <button type="button" class="chip chip-off h-8 px-3 text-xs whitespace-nowrap" @click="albumInput?.click()">รูปจากอัลบั้ม</button>
        <button v-if="recs.length" type="button" class="chip h-8 px-3 text-xs whitespace-nowrap" :class="recOpen ? 'chip-on' : 'chip-off'" :aria-expanded="recOpen" @click="recOpen = !recOpen">แนะนำสินค้า ({{ recs.length }})</button>
        <button v-if="db.bot.enabled" type="button" class="chip h-8 px-3 text-xs whitespace-nowrap" :class="chat.botOff ? 'chip-off' : 'border-violet-300 bg-violet-50 text-violet-800'" @click="setChatBot(chat.id, !!chat.botOff)">บอท: {{ chat.botOff ? 'ปิดในแชทนี้' : 'เปิด' }}</button>
      </div>

      <!-- ข้อความที่กำลังตอบกลับ -->
      <div v-if="replyTo && canType" class="mx-3 mt-2.5 flex items-center gap-2 rounded-xl bg-stone-50 px-3 py-1.5 text-xs text-stone-600">
        <span class="min-w-0 flex-1 truncate">ตอบกลับ: {{ replyPreview }}</span>
        <button type="button" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-stone-400 hover:bg-white" aria-label="ยกเลิกตอบกลับ" @click="replyTo = null"><AppIcon name="x" :size="14" /></button>
      </div>

      <!-- รูปที่เลือกไว้ (ตัวอย่างก่อนส่ง) -->
      <div v-if="(pics.length || picBusy) && canType" class="flex items-center gap-2 overflow-x-auto px-3 pt-2.5 [scrollbar-width:none]">
        <div v-for="p in pics" :key="p.id" class="relative h-16 w-16 shrink-0">
          <img :src="p.url" alt="รูปที่เลือกไว้" class="h-full w-full rounded-xl object-cover ring-1 ring-stone-200" />
          <button type="button" class="absolute -top-1.5 -right-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-800 text-white shadow" aria-label="เอารูปนี้ออก" :disabled="sendingPics" @click="removePic(p.id)"><AppIcon name="x" :size="12" /></button>
        </div>
        <span v-if="picBusy" class="shrink-0 text-xs text-stone-500" role="status">กำลังเตรียมรูป…</span>
      </div>

      <p v-if="!canType" class="m-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
        <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0 text-amber-600" />
        <span>เกิน 24 ชม. หลังลูกค้าทักล่าสุด Facebook ไม่ให้ตอบข้อความทั่วไป (การ์ดออร์เดอร์/ยอดชำระยังส่งได้) รอให้ลูกค้าทักกลับ</span>
      </p>
      <form v-else class="flex items-end gap-2 px-3" :class="kb.open ? 'py-2' : 'py-2.5'" @submit.prevent="send">
        <button type="button" class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-500 transition hover:bg-stone-100 lg:hidden" :class="toolsOpen ? 'bg-stone-100 text-brand-700' : ''" :aria-expanded="toolsOpen" aria-label="เครื่องมือแชท" @click="toggleTools">
          <AppIcon name="plus" :size="20" class="transition-transform duration-200" :class="toolsOpen ? 'rotate-45' : ''" />
        </button>
        <div class="flex min-w-0 flex-1 items-end rounded-2xl border border-stone-200 bg-stone-50 transition focus-within:border-brand-400 focus-within:bg-white focus-within:ring-4 focus-within:ring-brand-100">
          <textarea ref="input" v-model="text" rows="1" class="max-h-40 min-h-11 w-full resize-none bg-transparent px-3.5 py-2.5 text-base leading-6 text-stone-900 outline-none placeholder:text-stone-400" :placeholder="`ตอบทาง ${channelLabel}`" aria-label="ข้อความถึงลูกค้า" @focus="toolsOpen = false" @keydown="onKey" @input="onTyping" />
        </div>
        <button type="submit" class="btn-primary h-11 w-11 shrink-0 rounded-full px-0" :disabled="!canSend" aria-label="ส่งข้อความ"><AppIcon name="send" :size="18" /></button>
      </form>
    </div>

    <!-- เลือกออร์เดอร์ที่จะส่งสรุป -->
    <AppModal v-if="sumOpen" title="ส่งสรุปออร์เดอร์" @close="sumOpen = false">
      <div class="space-y-2">
        <button v-for="o in custOrders" :key="o.id" type="button" class="block w-full rounded-xl border border-stone-200 bg-white p-3 text-left hover:bg-stone-50" data-summary-pick @click="sendSummary(o)">
          <span class="flex items-baseline justify-between gap-2"><span class="font-medium text-stone-900">{{ orderNo(o.code) }}</span><span class="text-xs text-stone-500">{{ STATUS[o.status]?.label || o.status }}</span></span>
          <span class="mt-0.5 flex items-baseline justify-between gap-2 text-sm text-stone-600"><span>นัด {{ dateTime(o.pickupAt) }}</span><span>{{ money(orderTotals(o).total) }}<span v-if="orderTotals(o).balance > 0.004" class="text-amber-700"> · ค้าง {{ money(orderTotals(o).balance) }}</span></span></span>
        </button>
      </div>
    </AppModal>

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
        <div v-for="c in db.cannedReplies" :key="c.id" class="flex gap-1 rounded-xl border border-stone-200 bg-white p-1">
          <button type="button" class="min-w-0 flex-1 rounded-lg p-2 text-left hover:bg-stone-50" @click="useCanned(c)">
            <span class="block font-medium text-stone-900">{{ c.title }}</span>
            <span class="block truncate text-xs text-stone-500">{{ c.text }}</span>
          </button>
          <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg text-stone-400 hover:bg-stone-100" aria-label="แก้ไข" @click="cannedEdit = { ...c }"><AppIcon name="edit" :size="16" /></button>
          <button type="button" class="flex h-9 w-9 shrink-0 items-center justify-center self-center rounded-lg text-stone-400 hover:bg-rose-50 hover:text-rose-700" aria-label="ลบ" @click="removeCanned(c.id)"><AppIcon name="trash" :size="16" /></button>
        </div>
        <button type="button" class="btn-soft w-full" @click="cannedEdit = { id: null, title: '', text: '' }"><AppIcon name="plus" :size="16" /> เพิ่มข้อความ</button>
      </div>
    </AppModal>

    <!-- เลือกออร์เดอร์ให้สลิปที่รอผูก (โหมดแมนนวล): ที่แนะนำก่อน แล้วออร์เดอร์อื่นของลูกค้า -->
    <AppModal v-if="slipPick" title="รับชำระจากสลิป" @close="slipPick = null">
      <div class="space-y-2">
        <p class="text-sm text-stone-600">เลือกออร์เดอร์ที่สลิปนี้ชำระ · ยอดที่รับได้ = คงค้างหักยอดที่ลูกค้าแจ้งรอตรวจ</p>
        <p v-if="!chat.customerId" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">แชทนี้ยังไม่ผูกลูกค้า · ผูกลูกค้ากับแชทก่อน เพื่อดูออร์เดอร์อื่นของลูกค้าคนนั้น</p>
        <p v-else-if="!slipPickList.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-600">ลูกค้าคนนี้ไม่มีออร์เดอร์ที่ยังไม่ปิด</p>
        <button v-for="r in slipPickList" :key="r.order.id" type="button" class="block w-full rounded-xl border border-stone-200 bg-white p-3 text-left hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!(r.room > 0)" data-slip-pick-order @click="openSlipBind(slipPick, r.order)">
          <span class="flex items-baseline justify-between gap-2"><span class="font-medium text-stone-900">{{ orderNo(r.order.code) }}</span><span class="text-xs text-stone-500">{{ STATUS[r.order.status]?.label || r.order.status }}</span></span>
          <span class="mt-0.5 flex items-baseline justify-between gap-2 text-sm text-stone-600"><span>นัด {{ dateTime(r.order.pickupAt) }}</span><span v-if="r.room > 0">รับได้ {{ money(r.room) }}</span><span v-else>รับไม่ได้ (ชำระครบ/มียอดรอตรวจ)</span></span>
        </button>
      </div>
    </AppModal>

    <!-- ผูกสลิปกับออร์เดอร์ในหน้าแชท (ไม่เปลี่ยนหน้า) -->
    <OrderPayModal v-if="slipBind" :order="slipBind.order" mode="slip" :target="slipBind.target" @close="slipBind = null" />
  </div>
</template>
