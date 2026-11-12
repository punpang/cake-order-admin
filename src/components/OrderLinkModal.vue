<script setup>
import { computed, ref } from 'vue'
import { db, orderLinksOf, createOrderLink, revokeOrderLinks, sendOrderLinkToChat, chatFor, findChat } from '../data/store'
import { askConfirm } from '../lib/confirm'
import { dateTime } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'

// ลิงก์ให้ลูกค้าดูออร์เดอร์ (ดูอย่างเดียว ไม่ต้องล็อกอิน) · token เห็นได้ครั้งเดียวตอนสร้าง (ระบบเก็บเฉพาะ hash)
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close'])
const tick = ref(0)
const links = computed(() => (tick.value, orderLinksOf(props.order.id)))
const fresh = ref(null) // { url }
const msg = ref('')
const error = ref('')
const hasChat = computed(() => !!((props.order.chatId && findChat(props.order.chatId)) || chatFor(props.order.customerId)))
const policy = computed(() => db.shop.linkPolicy)

function create() {
  error.value = ''
  msg.value = ''
  const r = createOrderLink(props.order)
  if (r.error) return (error.value = r.error)
  fresh.value = { url: r.url }
  tick.value++
}
async function copy() {
  try {
    await navigator.clipboard.writeText(fresh.value.url)
    msg.value = 'คัดลอกแล้ว'
  } catch {
    msg.value = 'คัดลอกไม่ได้ — เลือกข้อความแล้วคัดลอกเอง'
  }
}
function toChat() {
  const r = sendOrderLinkToChat(props.order, fresh.value.url)
  if (r.error) return (error.value = r.error)
  error.value = ''
  msg.value = 'ส่งเข้าแชทแล้ว'
}
async function revoke() {
  if (!(await askConfirm({ title: 'เพิกถอนลิงก์', message: `ลิงก์ทั้งหมดของ ${props.order.code} จะใช้ไม่ได้ทันที`, okText: 'เพิกถอน', danger: true }))) return
  const r = revokeOrderLinks(props.order)
  if (r.error) return (error.value = r.error)
  fresh.value = null
  msg.value = 'เพิกถอนแล้ว'
  tick.value++
}
</script>

<template>
  <AppModal :title="`ลิงก์ออร์เดอร์ ${order.code}`" @close="emit('close')">
    <div class="space-y-4 text-sm">
      <p class="text-stone-500">ลูกค้าเปิดดูสถานะ รายการ และยอดได้โดยไม่ต้องล็อกอิน (ดูอย่างเดียว · ไม่แสดงที่อยู่/เบอร์เต็ม/ต้นทุน)<br />หมดอายุ {{ policy.idleDays }} วันหลังเปิดล่าสุด · ถ้าไม่เคยเปิด {{ policy.neverOpenedDays }} วันหลังสร้าง</p>

      <div v-if="fresh" class="rounded-xl border border-brand-200 bg-brand-50/50 p-3">
        <div class="mb-1 text-xs text-stone-500">ลิงก์ใหม่ (เห็นครั้งเดียว — ปิดหน้านี้แล้วดูซ้ำไม่ได้)</div>
        <input :value="fresh.url" readonly class="input font-mono text-xs" @focus="$event.target.select()" />
        <div class="mt-2 flex flex-wrap gap-2">
          <button class="btn-outline h-9 px-3" @click="copy">คัดลอก</button>
          <button v-if="hasChat" class="btn-outline h-9 px-3" @click="toChat">ส่งเข้าแชทลูกค้า</button>
        </div>
      </div>

      <div>
        <div class="mb-1 font-medium text-stone-800">ลิงก์ที่ใช้อยู่ ({{ links.length }})</div>
        <p v-if="!links.length" class="text-stone-400">ยังไม่มี</p>
        <ul v-else class="divide-y divide-stone-100 rounded-xl border border-stone-200">
          <li v-for="l in links" :key="l.id" class="flex flex-wrap justify-between gap-x-3 px-3 py-2 text-xs text-stone-600">
            <span>สร้าง {{ dateTime(l.createdAt) }}</span>
            <span>{{ l.openCount ? `เปิด ${l.openCount} ครั้ง · ล่าสุด ${dateTime(l.lastOpenedAt)}` : 'ยังไม่เคยเปิด' }}</span>
            <span class="w-full text-stone-400">หมดอายุ {{ dateTime(l.expiresAt) }}</span>
          </li>
        </ul>
      </div>
      <p v-if="msg" class="text-emerald-700">{{ msg }}</p>
      <p v-if="error" class="flex items-center gap-2 text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ปิด</button>
      <button v-if="links.length" class="btn-outline flex-1 text-rose-700 sm:flex-none" @click="revoke">เพิกถอนทั้งหมด</button>
      <button class="btn-primary flex-1 sm:flex-none" @click="create">สร้างลิงก์ใหม่</button>
    </template>
  </AppModal>
</template>
