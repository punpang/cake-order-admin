<script setup>
// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (ข้อความและรูปภาพ ไม่เกิน 5 รูปต่อข้อความ) · เปิดแท็บแล้วลงทะเบียนแจ้งเตือนของเครื่อง (Android)
// อัปเดตแบบโพลล์: 3 วินาทีตอนกำลังคุยกัน แล้วห่างขึ้นเรื่อย ๆ (สูงสุด 15 วินาที) เมื่อไม่มีข้อความใหม่ · หยุดยิงขณะแท็บถูกซ่อน · ถูกจำกัดอัตรา (429) = ถอยไป 20 วินาที
// มีสัญญาณเรียลไทม์ (ช่อง Broadcast ของลูกค้า) เมื่อเชื่อมได้ → โหลดทันทีที่มีสัญญาณ และโพลล์สำรองทุก 10 วินาที
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { remoteChat } from '../../lib/customerOrderRemote'
import { startCustomerPush } from '../../lib/customerPush'
import { PHOTO_MAX_COUNT, shrinkPhoto } from '../../lib/customerPhoto'
import { dayLabel, timeOnly } from '../../lib/format'
import AppIcon from '../../components/AppIcon.vue'
import { quietly } from '../../lib/loading'
import { safeHref } from '../../lib/safeUrl'
import { lastFrom, pingDue, readReceiptId } from '../../lib/chatPresence'
import { getSupabase } from '../../lib/supabase'
import { LIVE_POLL_MS, startChatPing } from '../../lib/chatPing'

const MAX = 1000
const LINK_KEEP_MS = 50 * 60e3 // ลิงก์รูปที่ออกให้มีอายุ 1 ชม. · เก็บใช้ต่อไม่เกิน 50 นาที
const messages = ref([])
const text = ref('')
const err = ref('')
const sending = ref(false)
const box = ref(null)
const fileInput = ref(null)
const picks = ref([]) // รูปที่เลือกแล้วแต่ยังไม่ส่ง: { id, file, preview, ref }
const replyTo = ref(null) // ข้อความที่กำลังตอบกลับ (เหมือนฝั่งพนักงาน)
const inputEl = ref(null)
const urls = new Map() // ref รูป → { url, at } (ลิงก์ในเครื่องเท่านั้น)
const made = new Set() // ลิงก์ blob ที่สร้างไว้ (เก็บเพื่อคืนหน่วยความจำตอนออกจากหน้า)
let timer = null
let stopped = false
let idle = 0 // จำนวนรอบโพลล์ติดกันที่ไม่มีข้อความใหม่
let loading = false
let seq = 0
const presence = ref({ shopTyping: false, shopReadAt: null }) // สถานะที่ร้านเปิดให้เห็น (จากเซิร์ฟเวอร์)
const readId = computed(() => readReceiptId(messages.value, 'customer', presence.value.shopReadAt)) // ข้อความของลูกค้าที่ร้านอ่านแล้ว
let ackedStaffId = null // ข้อความของร้านที่แจ้งไปแล้วว่าลูกค้าอ่าน
let typedAt = 0 // เวลาที่ส่งสถานะพิมพ์ล่าสุด
let pingTopic = '' // ชื่อช่องสัญญาณของลูกค้า (จากเซิร์ฟเวอร์)
let ping = null // การฟังสัญญาณของแชทนี้ (เมื่อเชื่อมได้)
let pingTimer = null
const POLL_MS = 3000
const POLL_MAX_MS = 15000
const BACKOFF_MS = 20000
// 3 วินาทีใน 20 รอบแรก (1 นาที) แล้วเพิ่มทีละ 3 วินาทีทุก 20 รอบ จนถึงเพดาน
const nextDelay = () => (ping?.isLive() ? LIVE_POLL_MS : Math.min(POLL_MAX_MS, POLL_MS * (1 + Math.floor(idle / 20))))

// ยึดท้ายรายการ: ถ้าลูกค้าอยู่ท้ายสุดอยู่แล้ว เนื้อหาที่สูงขึ้นทีหลัง (รูปที่โหลดเสร็จ) จะเลื่อนตามให้ · ถ้าเลื่อนขึ้นไปอ่านเก่าอยู่ จะไม่กระโดด
const inner = ref(null)
let pinned = true
let ro = null
const onBoxScroll = () => {
  const b = box.value
  if (b) pinned = b.scrollHeight - b.scrollTop - b.clientHeight < 80
}

const toBottom = async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}

// ตัวช่วยจัดกลุ่มข้อความสำหรับหน้าจอ: หัวข้อวันที่ · ป้าย "ร้าน" ตอนเริ่มกลุ่ม · เวลาท้ายกลุ่ม (ไม่กระทบข้อมูลที่ส่ง/รับ)
const dayKey = (s) => String(s || '').slice(0, 10)
const showDay = (i) => i === 0 || dayKey(messages.value[i - 1].at) !== dayKey(messages.value[i].at)
const startsGroup = (i) => showDay(i) || messages.value[i - 1].from !== messages.value[i].from
const endsGroup = (i) => i === messages.value.length - 1 || showDay(i + 1) || messages.value[i + 1].from !== messages.value[i].from
// ร้านกำลังพิมพ์ → เลื่อนลงให้เห็นตัวบอกสถานะ
watch(() => presence.value.shopTyping, (v) => { if (v) toBottom() })

const previewOf = (file) => {
  const u = URL.createObjectURL(file)
  made.add(u)
  return u
}

// ref ที่ยังมีลิงก์ใช้ได้ (ส่งไปให้เซิร์ฟเวอร์ไม่ต้องออกลิงก์ซ้ำ) · ลบรายการที่หมดอายุออก
function freshRefs() {
  const now = Date.now()
  for (const [k, v] of urls) if (now - v.at >= LINK_KEEP_MS) urls.delete(k)
  return [...urls.keys()]
}

// ใส่ลิงก์รูปให้ข้อความ: ลิงก์ใหม่จากเซิร์ฟเวอร์ หรือลิงก์ที่เก็บไว้
function withUrls(m) {
  const now = Date.now()
  return {
    ...m,
    photos: (m.photos || []).map((p) => {
      if (p.url) urls.set(p.ref, { url: p.url, at: now })
      const hit = urls.get(p.ref)
      return { ref: p.ref, url: p.url || hit?.url || null }
    }),
  }
}

// คืน { changed, limited } เพื่อให้ตัวตั้งเวลาปรับความถี่ · ถูกจำกัดอัตรา (429) ไม่แสดงข้อผิดพลาดให้ลูกค้า แค่ถอยห่างออกไป
async function load() {
  if (loading) return { changed: false, limited: false }
  loading = true
  try {
    const r = await remoteChat('chat_list', { have: freshRefs() })
    if (r.status === 429) return { changed: false, limited: true }
    if (r.error) { err.value = r.error; return { changed: false, limited: false } }
    const list = (Array.isArray(r.messages) ? r.messages : []).map(withUrls)
    // เลื่อนลงเฉพาะเมื่อมีข้อความใหม่ — ไม่ให้หน้าจอกระโดดระหว่างที่ลูกค้าเลื่อนอ่านข้อความเก่า
    const grew = list.length > messages.value.length
    const changed = grew || list.at(-1)?.id !== messages.value.at(-1)?.id
    messages.value = list
    presence.value = r.presence || { shopTyping: false, shopReadAt: null }
    ackRead(list)
    if (r.chatTopic && r.chatTopic !== pingTopic) { pingTopic = r.chatTopic; startPing(pingTopic) }
    err.value = ''
    if (grew) await toBottom()
    return { changed, limited: false }
  } finally { loading = false }
}

// เปิดหน้าแชทอยู่ → แจ้งว่าลูกค้าอ่านข้อความล่าสุดของร้านแล้ว (ส่งครั้งเดียวต่อข้อความ · แท็บถูกซ่อนไม่ส่ง)
function ackRead(list) {
  const s = lastFrom(list, 'staff')
  if (!s || s.id === ackedStaffId || (typeof document !== 'undefined' && document.hidden)) return
  remoteChat('chat_read').then((r) => { if (!r.error) ackedStaffId = s.id }).catch(() => {})
}
// กำลังพิมพ์ → แจ้งร้านไม่ถี่กว่าทุก 3 วินาที (ช่องว่างไม่ส่ง)
function onTyping() {
  if (!text.value.trim()) return
  const now = Date.now()
  if (!pingDue(typedAt, now)) return
  typedAt = now
  remoteChat('chat_typing').catch(() => {})
}
// สัญญาณ "มีข้อความ/สถานะใหม่" → โหลดทันที (สัญญาณที่มาถี่ ๆ รวมเป็นครั้งเดียว · แท็บถูกซ่อนไม่โหลด)
function onPing() {
  if (stopped) return
  clearTimeout(pingTimer)
  pingTimer = setTimeout(() => { if (!(typeof document !== 'undefined' && document.hidden)) tick() }, 300)
}
// เริ่มฟังช่องของลูกค้า · เชื่อมไม่ได้ = โพลล์ตามเดิม
async function startPing(topic) {
  stopPing()
  try {
    const c = await getSupabase()
    if (!stopped && topic === pingTopic) ping = startChatPing(c, topic, onPing)
  } catch { /* เชื่อมไม่ได้ = โพลล์ตามเดิม */ }
}
function stopPing() {
  ping?.stop()
  ping = null
}
function schedule(ms) {
  clearTimeout(timer)
  if (!stopped) timer = setTimeout(tick, ms)
}
async function tick() {
  if (stopped) return
  if (typeof document !== 'undefined' && document.hidden) return schedule(nextDelay()) // แท็บถูกซ่อน = ไม่ยิงคำขอ
  const r = (await quietly(load)) || {}
  idle = (r.changed || presence.value.shopTyping) ? 0 : idle + 1 // ร้านกำลังพิมพ์ = โพลล์ถี่ไว้ ให้เห็นทันที
  schedule(r.limited ? BACKOFF_MS : nextDelay())
}
// กลับมาที่แท็บ: ดึงทันทีและกลับไปโพลล์ถี่
function onVisible() {
  if (typeof document !== 'undefined' && document.hidden) return
  idle = 0
  schedule(0)
}

function onPick(e) {
  const files = Array.from(e.target.files || [])
  e.target.value = ''
  const room = PHOTO_MAX_COUNT - picks.value.length
  if (files.length > room) err.value = `แนบได้ไม่เกิน ${PHOTO_MAX_COUNT} รูปต่อข้อความ`
  for (const file of files.slice(0, Math.max(0, room))) {
    if (!String(file.type).startsWith('image/')) { err.value = 'แนบได้เฉพาะไฟล์รูปภาพ'; continue }
    picks.value.push({ id: ++seq, file, preview: previewOf(file), ref: null })
  }
}

// ตอบกลับข้อความ: เลือกข้อความแล้วพิมพ์ต่อได้ทันที
function pickReply(m) {
  replyTo.value = m
  nextTick(() => inputEl.value?.focus())
}
function cancelReply() {
  replyTo.value = null
}
// ชื่อประเภทการ์ดจากร้าน (การ์ดแจ้งยอด/ลิงก์/สรุปออร์เดอร์)
const CARD_LABEL = { payreq: 'แจ้งยอดชำระ', order: 'สรุปออร์เดอร์', link: 'ลิงก์ออร์เดอร์', quote: 'ใบเสนอราคา', info: 'ข้อความจากร้าน', announce: 'ประชาสัมพันธ์', promo: 'โปรโมชั่น', ad: 'โฆษณา' }
const cardLabel = (c) => CARD_LABEL[c?.kind] || CARD_LABEL.info
// การ์ดประชาสัมพันธ์/โปรโมชั่น/โฆษณา: ปุ่มเปิดลิงก์เป็น "ดูรายละเอียด" (ไม่ใช่ "ดูออร์เดอร์")
const PROMO_KINDS = ['announce', 'promo', 'ad']
// ข้อความสั้น ๆ สำหรับแถบตอบกลับ (ตรงกับที่พนักงานเห็น)
const snippetOf = (m) => {
  if (!m) return ''
  if (m.kind === 'quote') return 'ใบเสนอราคา'
  if (m.kind === 'order') return 'สรุปออร์เดอร์'
  const t = String(m.text || '').trim()
  if (t) return t.length > 60 ? `${t.slice(0, 60)}…` : t
  return m.photos?.length ? '[รูปภาพ]' : ''
}

function removePick(id) {
  const p = picks.value.find((x) => x.id === id)
  if (p && made.has(p.preview)) { URL.revokeObjectURL(p.preview); made.delete(p.preview) }
  picks.value = picks.value.filter((x) => x.id !== id)
}

async function send() {
  const t = text.value.trim()
  if ((!t && !picks.value.length) || sending.value) return
  sending.value = true
  err.value = ''
  try {
    const refs = []
    for (const p of picks.value) {
      if (!p.ref) {
        const photo = await shrinkPhoto(p.file) // ย่อให้ไม่เกิน 2 MB ก่อนส่ง
        const r = await remoteChat('chat_photo', { photo })
        if (r.error) { err.value = r.error; return }
        p.ref = r.ref // รูปที่อัปโหลดแล้วไม่อัปโหลดซ้ำเมื่อส่งใหม่
      }
      urls.set(p.ref, { url: p.preview, at: Date.now() })
      refs.push(p.ref)
    }
    const r = await remoteChat('chat_send', { text: t, photos: refs, replyTo: replyTo.value?.id || null })
    if (r.error) { err.value = r.error; return }
    text.value = ''
    replyTo.value = null
    picks.value = []
    if (r.message) messages.value = [...messages.value, withUrls(r.message)]
    idle = 0 // กำลังคุยกัน: โพลล์ถี่รอร้านตอบ
    schedule(POLL_MS)
    await toBottom()
  } catch (e) {
    err.value = e?.message || 'ส่งไม่สำเร็จ กรุณาลองใหม่'
  } finally { sending.value = false }
}

onMounted(() => {
  stopped = false
  startCustomerPush()
  document.addEventListener('visibilitychange', onVisible)
  box.value?.addEventListener('scroll', onBoxScroll, { passive: true })
  if (typeof ResizeObserver !== 'undefined' && inner.value) {
    ro = new ResizeObserver(() => { if (pinned && box.value) box.value.scrollTop = box.value.scrollHeight })
    ro.observe(inner.value)
  }
  schedule(0)
})
onBeforeUnmount(() => {
  stopped = true
  clearTimeout(timer)
  clearTimeout(pingTimer)
  ro?.disconnect()
  box.value?.removeEventListener('scroll', onBoxScroll)
  stopPing()
  document.removeEventListener('visibilitychange', onVisible)
  for (const u of made) URL.revokeObjectURL(u)
  made.clear()
})
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div ref="box" class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4" aria-live="polite">
      <div ref="inner" class="flex min-h-full flex-col">
      <div v-if="!messages.length" class="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <span class="flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-brand-600">
          <AppIcon name="chat" :size="30" />
        </span>
        <p class="mt-4 font-display text-lg text-stone-900">ยังไม่มีข้อความ</p>
        <p class="mt-1 text-sm text-stone-600">ส่งข้อความหรือรูปถึงร้านได้เลย ร้านจะตอบกลับในหน้านี้</p>
        <p class="mt-3 text-xs text-stone-500">แนบได้สูงสุด {{ PHOTO_MAX_COUNT }} รูปต่อข้อความ · รูปละไม่เกิน 2 MB</p>
      </div>

      <template v-for="(m, i) in messages" :key="m.id">
        <div v-if="showDay(i)" class="my-4 flex justify-center">
          <span class="rounded-full bg-stone-200/70 px-3 py-1 text-xs text-stone-600">{{ dayLabel(m.at) }}</span>
        </div>
        <div class="flex flex-col" :class="[m.from === 'customer' ? 'items-end' : 'items-start', endsGroup(i) ? 'mb-3' : 'mb-1']">
          <span v-if="m.from === 'staff' && startsGroup(i)" class="mb-1 ml-1 text-xs text-stone-500">ร้าน</span>
          <div v-if="m.kind === 'quote'" class="w-72 max-w-[85%] overflow-hidden rounded-2xl border-2 border-brand-200 bg-white shadow-sm">
            <div v-if="m.replyTo" class="m-3 mb-0 rounded-lg border-l-2 border-brand-300 bg-stone-100 px-2 py-1 text-xs leading-snug text-stone-600"><span class="block font-medium">{{ m.replyTo.from === 'customer' ? 'ข้อความของคุณ' : 'ร้าน' }}</span><span class="line-clamp-2 break-words">{{ m.replyTo.text }}</span></div>
            <img v-if="m.card?.image" :src="m.card.image" alt="" class="h-36 w-full object-cover" loading="lazy" />
            <div class="p-3.5">
              <p class="font-display text-base leading-snug text-stone-900">{{ m.card?.title || 'ใบเสนอราคา' }}</p>
              <p v-if="m.card?.subtitle" class="mt-0.5 text-sm font-semibold text-brand-700">{{ m.card.subtitle }}</p>
              <p v-if="m.text" class="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-stone-700">{{ m.text }}</p>
            </div>
          </div>
          <!-- สรุปออร์เดอร์ (เหมือนการ์ดของ Facebook): รายการ ยอด และปุ่มดูออร์เดอร์ -->
          <div v-else-if="m.kind === 'order'" class="w-72 max-w-[85%] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div v-if="m.replyTo" class="m-3 mb-0 rounded-lg border-l-2 border-brand-300 bg-stone-100 px-2 py-1 text-xs leading-snug text-stone-600"><span class="block font-medium">{{ m.replyTo.from === 'customer' ? 'ข้อความของคุณ' : 'ร้าน' }}</span><span class="line-clamp-2 break-words">{{ m.replyTo.text }}</span></div>
            <img v-if="m.card?.image" :src="m.card.image" alt="" class="h-32 w-full object-cover" loading="lazy" />
            <div class="p-3.5">
              <p class="text-xs font-semibold text-brand-700">สรุปออร์เดอร์</p>
              <p class="font-display text-base leading-snug text-stone-900">{{ m.card?.title || 'สรุปออร์เดอร์' }}</p>
              <p v-if="m.card?.subtitle" class="mt-0.5 text-sm font-semibold text-stone-700">{{ m.card.subtitle }}</p>
              <p v-if="m.text" class="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-stone-700">{{ m.text }}</p>
              <a v-if="safeHref(m.card?.url)" :href="safeHref(m.card.url)" target="_blank" rel="noopener" class="btn-soft mt-3 h-10 w-full text-sm">ดูออร์เดอร์</a>
            </div>
          </div>
          <!-- การ์ดแจ้งเตือน/ลิงก์จากร้าน: แจ้งยอดชำระ ลิงก์ออร์เดอร์ (อ่านอย่างเดียว มีปุ่มเปิดลิงก์) -->
          <div v-else-if="m.kind === 'card' && m.card" class="w-72 max-w-[85%] overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <div v-if="m.replyTo" class="m-3 mb-0 rounded-lg border-l-2 border-brand-300 bg-stone-100 px-2 py-1 text-xs leading-snug text-stone-600"><span class="block font-medium">{{ m.replyTo.from === 'customer' ? 'ข้อความของคุณ' : 'ร้าน' }}</span><span class="line-clamp-2 break-words">{{ m.replyTo.text }}</span></div>
            <img v-if="m.card.image" :src="m.card.image" alt="" class="h-32 w-full object-cover" loading="lazy" />
            <div class="p-3.5">
              <p v-if="cardLabel(m.card) !== m.card.title" class="text-xs font-semibold text-brand-700">{{ cardLabel(m.card) }}</p>
              <p class="font-display text-base leading-snug text-stone-900">{{ m.card.title || cardLabel(m.card) }}</p>
              <p v-if="m.card.subtitle" class="mt-0.5 text-sm font-semibold text-stone-700">{{ m.card.subtitle }}</p>
              <p v-if="m.text" class="mt-2 text-sm leading-relaxed break-words whitespace-pre-wrap text-stone-700">{{ m.text }}</p>
              <a v-if="safeHref(m.card.url)" :href="safeHref(m.card.url)" target="_blank" rel="noopener" class="btn-soft mt-3 h-10 w-full text-sm">{{ m.card.kind === 'payreq' || m.card.pay ? 'ดูและชำระเงิน' : PROMO_KINDS.includes(m.card.kind) ? 'ดูรายละเอียด' : 'ดูออร์เดอร์' }}</a>
            </div>
          </div>
          <div
            v-else
            class="max-w-[80%] rounded-2xl text-[15px] leading-relaxed break-words whitespace-pre-wrap"
            :class="[
              m.photos?.length ? 'p-1.5' : 'px-3.5 py-2',
              m.from === 'customer' ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md border border-stone-200 bg-white text-stone-900 shadow-sm',
            ]"
          >
            <div v-if="m.replyTo" class="mb-1.5 rounded-lg border-l-2 px-2 py-1 text-xs leading-snug" :class="m.from === 'customer' ? 'border-white/60 bg-white/15 text-white/90' : 'border-brand-300 bg-stone-100 text-stone-600'">
              <span class="block font-medium">{{ m.replyTo.from === 'customer' ? 'ข้อความของคุณ' : 'ร้าน' }}</span>
              <span class="line-clamp-2 break-words">{{ m.replyTo.text }}</span>
            </div>
            <div v-if="m.photos?.length" class="mb-1.5 grid gap-1" :class="m.photos.length > 1 ? 'grid-cols-2' : ''">
              <a v-for="p in m.photos" :key="p.ref" :href="safeHref(p.url) || undefined" target="_blank" rel="noopener" class="block">
                <img v-if="p.url" :src="p.url" alt="รูปที่แนบ" class="max-h-56 w-full rounded-xl object-cover" loading="lazy" />
                <span v-else class="flex h-24 items-center justify-center rounded-xl bg-stone-200 text-xs text-stone-500">โหลดรูปไม่ได้</span>
              </a>
            </div>
            <div v-if="m.text" :class="m.photos?.length ? 'px-2 pt-1 pb-1' : ''">{{ m.text }}</div>
          </div>
          <button type="button" class="px-1 pt-0.5 text-xs font-medium text-stone-500 transition hover:text-brand-700" @click="pickReply(m)">ตอบกลับ</button>
          <div v-if="endsGroup(i)" class="mt-1 flex items-center gap-1.5 px-1 text-xs text-stone-500">
            <span>{{ timeOnly(m.at) }}</span>
            <span v-if="m.id === readId">· ร้านอ่านแล้ว</span>
          </div>
        </div>
      </template>

      <div v-if="presence.shopTyping" class="mb-3 flex flex-col items-start" role="status">
        <span class="mb-1 ml-1 text-xs text-stone-500">ร้าน</span>
        <div class="flex items-center gap-1 rounded-2xl rounded-bl-md border border-stone-200 bg-white px-4 py-3 shadow-sm">
          <span class="sr-only">ร้านกำลังพิมพ์</span>
          <span class="h-2 w-2 animate-bounce rounded-full bg-stone-400"></span>
          <span class="h-2 w-2 animate-bounce rounded-full bg-stone-400 [animation-delay:150ms]"></span>
          <span class="h-2 w-2 animate-bounce rounded-full bg-stone-400 [animation-delay:300ms]"></span>
        </div>
      </div>
      </div>
    </div>

    <div class="shrink-0 border-t border-stone-200 bg-white">
      <p v-if="err" class="mx-3 mt-2 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800" role="alert">{{ err }}</p>
      <div v-if="replyTo" class="mx-3 mt-2 flex items-center gap-2 rounded-xl bg-stone-100 py-1.5 pr-1 pl-3 text-xs text-stone-700">
        <span class="min-w-0 flex-1 truncate"><b class="font-medium">ตอบกลับ{{ replyTo.from === 'customer' ? 'ข้อความของคุณ' : 'ร้าน' }}:</b> {{ snippetOf(replyTo) }}</span>
        <button type="button" class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-stone-500 hover:bg-white" aria-label="ยกเลิกการตอบกลับ" @click="cancelReply"><AppIcon name="x" :size="14" /></button>
      </div>
      <div v-if="picks.length" class="flex gap-2 overflow-x-auto px-3 pt-2">
        <div v-for="p in picks" :key="p.id" class="relative shrink-0">
          <img :src="p.preview" alt="รูปที่เลือก" class="h-16 w-16 rounded-xl object-cover" />
          <button
            type="button"
            class="absolute -top-1.5 -right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-stone-800 text-white shadow"
            aria-label="เอารูปนี้ออก"
            :disabled="sending"
            @click="removePick(p.id)"
          >
            <AppIcon name="x" :size="14" />
          </button>
        </div>
      </div>
      <form class="flex items-end gap-2 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))]" @submit.prevent="send">
        <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple class="hidden" @change="onPick" />
        <button
          type="button"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-stone-600 hover:bg-stone-100 disabled:opacity-40"
          :disabled="sending || picks.length >= PHOTO_MAX_COUNT"
          aria-label="แนบรูปภาพ"
          @click="fileInput?.click()"
        >
          <AppIcon name="image" :size="22" />
        </button>
        <textarea
          ref="inputEl"
          v-model="text"
          :maxlength="MAX"
          rows="1"
          class="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-stone-300 bg-stone-50 px-4 py-2.5 text-base text-stone-900 placeholder:text-stone-400 focus:border-brand-500 focus:bg-white focus:ring-2 focus:ring-brand-200 focus:outline-none"
          placeholder="พิมพ์ข้อความถึงร้าน"
          aria-label="ข้อความถึงร้าน"
          @input="onTyping"
        />
        <button
          type="submit"
          class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 disabled:bg-stone-200 disabled:text-stone-400 disabled:shadow-none"
          :disabled="(!text.trim() && !picks.length) || sending"
          :aria-label="sending ? 'กำลังส่ง' : 'ส่งข้อความ'"
        >
          <AppIcon name="send" :size="20" />
        </button>
      </form>
    </div>
  </div>
</template>
