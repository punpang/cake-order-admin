<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { findOrder, sendChat, markRead } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { STATUS } from '../lib/constants'
import { money, dateTime, timeOnly, dateOnly } from '../lib/format'
import AppIcon from './AppIcon.vue'

// เธรดแชท ใช้ทั้งฝั่งพนักงาน (side = staff) และลูกค้า (side = customer)
const props = defineProps({
  chat: { type: Object, required: true },
  side: { type: String, default: 'staff' },
})
const text = ref('')
const box = ref(null)
const mine = (m) => m.from === props.side

function scrollEnd() {
  nextTick(() => {
    if (box.value) box.value.scrollTop = box.value.scrollHeight
  })
}
function send() {
  if (!text.value.trim()) return
  sendChat(props.chat.id, props.side, text.value)
  text.value = ''
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
  markRead(props.chat.id, props.side)
  scrollEnd()
})
onMounted(() => {
  markRead(props.chat.id, props.side)
  scrollEnd()
})

// การ์ดออร์เดอร์
const card = (m) => {
  const o = findOrder(m.orderId)
  if (!o) return null
  const t = orderTotals(o)
  return { o, t, first: o.items[0]?.name || '', more: o.items.length - 1 }
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
            </div>
            <div class="mt-1 text-sm font-medium break-words text-stone-900">{{ card(m).first }}<span v-if="card(m).more > 0" class="text-stone-500"> +{{ card(m).more }} รายการ</span></div>
            <div class="mt-0.5 text-xs text-stone-500">{{ card(m).o.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }} · {{ dateTime(card(m).o.pickupAt) }}</div>
            <div class="mt-2 flex items-end justify-between gap-2 border-t border-stone-100 pt-2">
              <span class="text-xs text-stone-500">ยอดรวม <b class="block text-base text-stone-900">{{ money(card(m).t.total) }}</b></span>
              <span class="text-right text-xs" :class="card(m).t.balance > 0 ? 'text-amber-700' : 'text-brand-700'">{{ card(m).t.balance > 0 ? `ค้าง ${money(card(m).t.balance)}` : 'ชำระครบ' }}</span>
            </div>
            <RouterLink v-if="side === 'staff'" :to="`/orders/${card(m).o.id}`" class="btn-soft mt-2 h-9 w-full text-sm">เปิดออร์เดอร์</RouterLink>
          </div>
          <!-- ข้อความ -->
          <div v-else class="max-w-[80%]">
            <div class="rounded-2xl px-3.5 py-2 text-[15px] break-words whitespace-pre-line" :class="mine(m) ? 'rounded-br-md bg-brand-600 text-white' : 'rounded-bl-md bg-white text-stone-900 ring-1 ring-stone-200'">{{ m.text }}</div>
            <div class="mt-0.5 px-1 text-[11px] text-stone-400" :class="mine(m) ? 'text-right' : ''">{{ timeOnly(m.at) }}<template v-if="side === 'staff' && m.from === 'staff' && m.by === 'ระบบ'"> · อัตโนมัติ</template></div>
          </div>
        </div>
      </template>
    </div>

    <!-- ช่องพิมพ์ -->
    <form class="flex items-end gap-2 border-t border-stone-200 bg-white p-2" @submit.prevent="send">
      <textarea v-model="text" rows="1" class="input max-h-32 min-h-11 flex-1 resize-none py-2.5" placeholder="พิมพ์ข้อความ" @keydown="onKey" />
      <button type="submit" class="btn-primary h-11 w-11 shrink-0 px-0" :disabled="!text.trim()" aria-label="ส่ง"><AppIcon name="send" :size="18" /></button>
    </form>
  </div>
</template>
