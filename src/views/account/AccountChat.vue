<script setup>
// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (ข้อความและรูปภาพ ไม่เกิน 5 รูปต่อข้อความ) · อัปเดตทุก 3 วินาทีขณะเปิดหน้า · เปิดแท็บแล้วลงทะเบียนแจ้งเตือนของเครื่อง (Android)
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { remoteChat } from '../../lib/customerOrderRemote'
import { startCustomerPush } from '../../lib/customerPush'
import { PHOTO_MAX_COUNT, shrinkPhoto } from '../../lib/customerPhoto'
import { dateTime } from '../../lib/format'
import { quietly } from '../../lib/loading'

const MAX = 1000
const LINK_KEEP_MS = 50 * 60e3 // ลิงก์รูปที่ออกให้มีอายุ 1 ชม. · เก็บใช้ต่อไม่เกิน 50 นาที
const messages = ref([])
const text = ref('')
const err = ref('')
const sending = ref(false)
const box = ref(null)
const fileInput = ref(null)
const picks = ref([]) // รูปที่เลือกแล้วแต่ยังไม่ส่ง: { id, file, preview, ref }
const urls = new Map() // ref รูป → { url, at } (ลิงก์ในเครื่องเท่านั้น)
const made = new Set() // ลิงก์ blob ที่สร้างไว้ (เก็บเพื่อคืนหน่วยความจำตอนออกจากหน้า)
let timer = null
let loading = false
let seq = 0

const toBottom = async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}

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

async function load() {
  if (loading) return
  loading = true
  try {
    const r = await remoteChat('chat_list', { have: freshRefs() })
    if (r.error) { err.value = r.error; return }
    const list = (Array.isArray(r.messages) ? r.messages : []).map(withUrls)
    // เลื่อนลงเฉพาะเมื่อมีข้อความใหม่ — อัปเดตทุก 3 วินาที ไม่ให้หน้าจอกระโดดระหว่างที่ลูกค้าเลื่อนอ่านข้อความเก่า
    const grew = list.length > messages.value.length
    messages.value = list
    err.value = ''
    if (grew) await toBottom()
  } finally { loading = false }
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
    const r = await remoteChat('chat_send', { text: t, photos: refs })
    if (r.error) { err.value = r.error; return }
    text.value = ''
    picks.value = []
    if (r.message) messages.value = [...messages.value, withUrls(r.message)]
    await toBottom()
  } catch (e) {
    err.value = e?.message || 'ส่งไม่สำเร็จ กรุณาลองใหม่'
  } finally { sending.value = false }
}

onMounted(() => { load(); startCustomerPush(); timer = setInterval(() => quietly(load), 3000) })
onBeforeUnmount(() => {
  clearInterval(timer)
  for (const u of made) URL.revokeObjectURL(u)
  made.clear()
})
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-stone-600">ส่งข้อความหรือรูปถึงร้านได้ที่นี่ · ร้านจะตอบกลับในหน้านี้</p>
    <div ref="box" class="max-h-[55vh] min-h-[12rem] space-y-2 overflow-y-auto rounded-2xl bg-white p-3" aria-live="polite">
      <p v-if="!messages.length" class="py-6 text-center text-sm text-stone-500">ยังไม่มีข้อความ</p>
      <div v-for="m in messages" :key="m.id" class="flex" :class="m.from === 'customer' ? 'justify-end' : 'justify-start'">
        <div class="max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words" :class="m.from === 'customer' ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-900'">
          <div v-if="m.from === 'staff'" class="text-[11px] opacity-80">ร้าน</div>
          <div v-if="m.photos?.length" class="mb-1 grid gap-1" :class="m.photos.length > 1 ? 'grid-cols-2' : ''">
            <a v-for="p in m.photos" :key="p.ref" :href="p.url || undefined" target="_blank" rel="noopener" class="block">
              <img v-if="p.url" :src="p.url" alt="รูปที่แนบ" class="max-h-48 w-full rounded-lg object-cover" loading="lazy" />
              <span v-else class="flex h-24 items-center justify-center rounded-lg bg-stone-200 text-xs text-stone-500">โหลดรูปไม่ได้</span>
            </a>
          </div>
          <template v-if="m.text">{{ m.text }}</template>
          <div class="mt-0.5 text-right text-[10px] opacity-70">{{ dateTime(m.at) }}</div>
        </div>
      </div>
    </div>
    <p v-if="err" class="text-sm text-rose-700" role="alert">{{ err }}</p>
    <div v-if="picks.length" class="flex flex-wrap gap-2">
      <div v-for="p in picks" :key="p.id" class="relative">
        <img :src="p.preview" alt="รูปที่เลือก" class="h-16 w-16 rounded-lg object-cover" />
        <button type="button" class="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-stone-800 text-xs text-white" :aria-label="'เอารูปนี้ออก'" :disabled="sending" @click="removePick(p.id)">×</button>
      </div>
    </div>
    <form class="flex items-end gap-2" @submit.prevent="send">
      <input ref="fileInput" type="file" accept="image/png,image/jpeg,image/webp" multiple class="hidden" @change="onPick" />
      <button type="button" class="btn-outline h-11 shrink-0 px-3" :disabled="sending || picks.length >= PHOTO_MAX_COUNT" aria-label="แนบรูปภาพ" @click="fileInput?.click()">แนบรูป</button>
      <textarea v-model="text" :maxlength="MAX" rows="2" class="input min-h-[2.75rem] flex-1 resize-none" placeholder="พิมพ์ข้อความถึงร้าน" aria-label="ข้อความถึงร้าน" />
      <button type="submit" class="btn-primary h-11 shrink-0 px-4" :disabled="(!text.trim() && !picks.length) || sending">{{ sending ? 'กำลังส่ง…' : 'ส่ง' }}</button>
    </form>
    <p class="text-xs text-stone-500">แนบได้สูงสุด {{ PHOTO_MAX_COUNT }} รูปต่อข้อความ · รูปละไม่เกิน 2 MB (ระบบย่อรูปให้อัตโนมัติ)</p>
  </div>
</template>
