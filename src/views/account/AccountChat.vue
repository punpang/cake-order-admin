<script setup>
// แชทกับร้านของลูกค้าที่ล็อกอินแล้ว (ข้อความตัวอักษรอย่างเดียว) · อัปเดตทุก 3 วินาทีขณะเปิดหน้า · เปิดแท็บแล้วลงทะเบียนแจ้งเตือนของเครื่อง (Android)
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { remoteChat } from '../../lib/customerOrderRemote'
import { startCustomerPush } from '../../lib/customerPush'
import { dateTime } from '../../lib/format'
import { quietly } from '../../lib/loading'

const MAX = 1000
const messages = ref([])
const text = ref('')
const err = ref('')
const sending = ref(false)
const box = ref(null)
let timer = null
let loading = false

const toBottom = async () => {
  await nextTick()
  if (box.value) box.value.scrollTop = box.value.scrollHeight
}

async function load() {
  if (loading) return
  loading = true
  try {
    const r = await remoteChat('chat_list')
    if (r.error) { err.value = r.error; return }
    const list = Array.isArray(r.messages) ? r.messages : []
    // เลื่อนลงเฉพาะเมื่อมีข้อความใหม่ — อัปเดตทุก 3 วินาที ไม่ให้หน้าจอกระโดดระหว่างที่ลูกค้าเลื่อนอ่านข้อความเก่า
    const grew = list.length > messages.value.length
    messages.value = list
    err.value = ''
    if (grew) await toBottom()
  } finally { loading = false }
}

async function send() {
  const t = text.value.trim()
  if (!t || sending.value) return
  sending.value = true
  err.value = ''
  try {
    const r = await remoteChat('chat_send', { text: t })
    if (r.error) { err.value = r.error; return }
    text.value = ''
    if (r.message) messages.value = [...messages.value, r.message]
    await toBottom()
  } finally { sending.value = false }
}

onMounted(() => { load(); startCustomerPush(); timer = setInterval(() => quietly(load), 3000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="flex flex-col gap-3">
    <p class="text-sm text-stone-600">ส่งข้อความถึงร้านได้ที่นี่ · ร้านจะตอบกลับในหน้านี้</p>
    <div ref="box" class="max-h-[55vh] min-h-[12rem] space-y-2 overflow-y-auto rounded-2xl bg-white p-3" aria-live="polite">
      <p v-if="!messages.length" class="py-6 text-center text-sm text-stone-500">ยังไม่มีข้อความ</p>
      <div v-for="m in messages" :key="m.id" class="flex" :class="m.from === 'customer' ? 'justify-end' : 'justify-start'">
        <div class="max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap break-words" :class="m.from === 'customer' ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-900'">
          <div v-if="m.from === 'staff'" class="text-[11px] opacity-80">ร้าน</div>
          {{ m.text }}
          <div class="mt-0.5 text-right text-[10px] opacity-70">{{ dateTime(m.at) }}</div>
        </div>
      </div>
    </div>
    <p v-if="err" class="text-sm text-rose-700" role="alert">{{ err }}</p>
    <form class="flex gap-2" @submit.prevent="send">
      <textarea v-model="text" :maxlength="MAX" rows="2" class="input min-h-[2.75rem] flex-1 resize-none" placeholder="พิมพ์ข้อความถึงร้าน" aria-label="ข้อความถึงร้าน" />
      <button type="submit" class="btn-primary h-11 px-4" :disabled="!text.trim() || sending">ส่ง</button>
    </form>
  </div>
</template>
