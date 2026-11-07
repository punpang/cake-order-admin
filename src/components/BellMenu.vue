<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { bellFeed, bellIsRead, bellMarkAll, bellMarkRead, bellUnreadCount } from '../data/store'
import { BELL_STAFF, relTime } from '../lib/bell'
import AppIcon from './AppIcon.vue'

// กระดิ่งแจ้งเตือนในแอป · audience: 'staff' (หลังบ้าน) | 'customer' (หน้าร้าน ลูกค้าที่ล็อกอิน)
const props = defineProps({ audience: { type: String, default: 'staff' } })
const router = useRouter()
const open = ref(false)
const root = ref(null)
const items = computed(() => bellFeed(props.audience))
const unread = computed(() => bellUnreadCount(props.audience))
const badge = computed(() => (unread.value > 99 ? '99+' : String(unread.value)))
const TONE = { brand: 'bg-brand-500', amber: 'bg-amber-500', rose: 'bg-rose-500' }

const target = (i) => (props.audience === 'customer' ? (i.orderId ? `/account/orders/${i.orderId}` : '/account') : BELL_STAFF[i.event]?.to(i) || '/admin/orders')
const dot = (i) => (props.audience === 'customer' ? 'bg-brand-500' : TONE[BELL_STAFF[i.event]?.tone] || 'bg-brand-500')

function go(i) {
  bellMarkRead(i.id, props.audience)
  open.value = false
  router.push(target(i))
}
function outside(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
function esc(e) { if (e.key === 'Escape' && open.value) open.value = false }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', esc) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc) })
</script>

<template>
  <div ref="root" class="relative shrink-0">
    <button
      type="button"
      data-bell
      class="relative inline-flex h-10 w-10 items-center justify-center rounded-full bg-white text-stone-600 shadow-sm hover:text-brand-700"
      :aria-label="unread ? `แจ้งเตือน ยังไม่อ่าน ${unread} รายการ` : 'แจ้งเตือน'"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon name="bell" :size="20" />
      <span v-if="unread" data-bell-badge class="absolute -top-1 -right-1 min-w-5 rounded-full bg-brand-600 px-1 text-center text-[11px] leading-5 font-semibold text-white">{{ badge }}</span>
    </button>

    <div
      v-if="open"
      data-bell-panel
      role="dialog"
      aria-label="แจ้งเตือน"
      class="fixed inset-x-2 top-16 z-40 flex max-h-[min(32rem,calc(100vh-5rem))] flex-col overflow-hidden rounded-2xl bg-white shadow-xl ring-1 ring-stone-200 sm:absolute sm:inset-x-auto sm:top-full sm:right-0 sm:mt-2 sm:w-[24rem]"
    >
      <div class="flex items-center justify-between gap-2 border-b border-stone-100 px-4 py-2.5">
        <div class="font-semibold text-stone-800">แจ้งเตือน</div>
        <button type="button" class="rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-brand-50 disabled:text-stone-400 disabled:hover:bg-transparent" :disabled="!unread" @click="bellMarkAll(audience)">อ่านทั้งหมด</button>
      </div>
      <ul v-if="items.length" class="min-h-0 flex-1 overflow-y-auto overscroll-contain" data-bell-list>
        <li v-for="i in items" :key="i.id">
          <button type="button" class="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-stone-50" :class="bellIsRead(i, audience) ? '' : 'bg-brand-50/50'" data-bell-item @click="go(i)">
            <span class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full" :class="bellIsRead(i, audience) ? 'bg-stone-200' : dot(i)" :data-unread="!bellIsRead(i, audience)" />
            <span class="min-w-0 flex-1">
              <span class="block text-sm" :class="bellIsRead(i, audience) ? 'text-stone-700' : 'font-semibold text-stone-900'">{{ i.title }}</span>
              <span v-if="i.text" class="block truncate text-sm text-stone-600">{{ i.text }}</span>
              <span class="block text-xs text-stone-500">{{ relTime(i.at) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-else class="px-4 py-8 text-center text-sm text-stone-500">ยังไม่มีแจ้งเตือน</p>
    </div>
  </div>
</template>
