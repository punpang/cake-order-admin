<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db, session, can, switchUser, unreadChats, runScheduledChecks, orderVisible } from './data/store'
import { paymentCounts } from './lib/paymentsQueue'
import { focusMain } from './lib/a11yNav'
import { supabaseEnabled } from './lib/supabase'
import { staffState, staffSignOut } from './lib/staffAuth'
import { kb, watchViewport } from './lib/viewportFit'
import { ROLES } from './lib/constants'
import { firstHome, homeOf, systemOf, systemByKey, visibleSystems, visibleItems } from './lib/adminSystems'
import AppIcon from './components/AppIcon.vue'
import AppModal from './components/AppModal.vue'
import BellMenu from './components/BellMenu.vue'
import SystemSwitcher from './components/SystemSwitcher.vue'
import SyncBar from './components/SyncBar.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import ToastHost from './components/ToastHost.vue'
import LightboxHost from './components/LightboxHost.vue'
import LoadingOverlay from './components/LoadingOverlay.vue'
import StoreLayout from './components/StoreLayout.vue'

const roleOpen = ref(false)
// 4 ระบบหลังบ้าน (lib/adminSystems.js): ตัวสลับระบบ + เมนูย่อยของระบบปัจจุบัน
const route = useRoute()
// เปลี่ยนหน้า (SPA) → ย้ายโฟกัสไปเนื้อหา ให้ผู้ใช้แป้นพิมพ์/โปรแกรมอ่านหน้าจอเริ่มจากหน้าใหม่
// (ข้ามการนำทางครั้งแรกตอนโหลดหน้า เพื่อไม่ให้ข้ามลิงก์ "ข้ามไปเนื้อหาหลัก")
const appRouter = useRouter()
appRouter.isReady().then(() => watch(() => route.path, async () => { await nextTick(); focusMain(true) }))
const systems = computed(() => visibleSystems(can))
const current = computed(() => systemOf(route.path))
const items = computed(() => { const s = systemByKey(current.value); return s ? visibleItems(s, can) : [] })
// ยอดที่ลูกค้าแจ้งโอนรอตรวจ (ป้ายที่เมนูชำระเงิน)
const paySlips = computed(() => paymentCounts(db.orders.filter(orderVisible)).slips)
const unread = computed(() => unreadChats())
const badges = computed(() => ({ chat: unread.value, pay: paySlips.value }))
// เมนูล่างมือถือ: เมนูย่อยของระบบปัจจุบัน (เฉพาะที่ติด mobile) เมื่อมี ≥ 2 รายการ
// ระบบอื่น (หน้าเดียว) แสดงชื่อระบบนั้น + ปุ่ม "ระบบ" สำหรับสลับ (ปุ่ม "ระบบ" มีเสมอเมื่อเห็นมากกว่า 1 ระบบ)
const bottomItems = computed(() => (current.value === 'orders' ? items.value.filter((i) => i.mobile) : items.value))
const hasSwitch = computed(() => systems.value.length > 1)
const showBottom = computed(() => !route.meta.focus && bottomItems.value.length + (hasSwitch.value ? 1 : 0) >= 2)
// หน้าล็อก (แชท): ตามขนาดส่วนที่มองเห็นจริงเมื่อแป้นพิมพ์เปิด · ซ่อนแถบเมนูล่างระหว่างพิมพ์
let stopVv = () => {}
watch(() => !!route.meta.lock, (on) => { stopVv(); stopVv = on ? watchViewport() : () => {} }, { immediate: true })
onBeforeUnmount(() => stopVv())
// แป้นพิมพ์เปิดบนหน้าล็อก: ซ่อนแถบบน ใช้พื้นที่ทั้งหมดที่เหลือให้แชท
const kbLock = computed(() => !!route.meta.lock && kb.open)
const lockStyle = computed(() => (route.meta.lock ? (kbLock.value ? { top: 'var(--vvt, 0px)', height: 'var(--vvh, 100dvh)' } : { top: 'calc(3.5rem + var(--vvt, 0px))', height: 'calc(var(--vvh, 100dvh) - 3.5rem)' }) : null))
const navShow = computed(() => showBottom.value && !(route.meta.lock && kb.open))
const sysOpen = ref(false)
const bottomCols = computed(() => bottomItems.value.length + (hasSwitch.value ? 1 : 0))
const curLabel = computed(() => systems.value.find((x) => x.key === current.value)?.label || 'ระบบ')
function sysOutside(e) { if (sysOpen.value && !e.target.closest?.('[data-bottom-system]')) sysOpen.value = false }
function sysEsc(e) { if (e.key === 'Escape') sysOpen.value = false }
const me = computed(() => (supabaseEnabled ? staffState.staff : db.users.find((u) => u.id === session.userId)))
async function logout() { roleOpen.value = false; await staffSignOut(); appRouter.push('/admin/login') }
// จำลอง cron: ตรวจแจ้งเตือนตามเวลาทุก 60 วินาทีขณะเปิดแอป (ของจริงใช้ cron ฝั่งเซิร์ฟเวอร์)
let timer = null
onMounted(() => { timer = setInterval(() => { if (!supabaseEnabled || staffState.staff) runScheduledChecks() }, 60000); document.addEventListener('pointerdown', sysOutside); document.addEventListener('keydown', sysEsc) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('pointerdown', sysOutside); document.removeEventListener('keydown', sysEsc) })
</script>

<template>
  <button type="button" class="skip-link" @click="focusMain()">ข้ามไปเนื้อหาหลัก</button>
  <LightboxHost />
  <LoadingOverlay />
  <!-- หน้าร้าน + ระบบลูกค้า -->
  <StoreLayout v-if="$route.meta.store" />
  <main v-else-if="$route.meta.bare" id="main-content" tabindex="-1" class="outline-none"><RouterView /></main>

  <template v-else>
  <!-- แถบบน -->
  <header v-show="!kbLock" class="sticky top-0 z-20 bg-cream/90 shadow-[0_1px_0_rgb(63_46_46/0.06)] backdrop-blur-xl">
    <div class="mx-auto flex h-14 max-w-page items-center gap-3 px-4 lg:px-8">
      <RouterLink :to="firstHome(can)" class="flex min-w-0 items-center gap-2.5" aria-label="ร้านเค้ก หน้าแรกหลังบ้าน">
        <svg viewBox="0 0 48 48" class="h-10 w-10 shrink-0" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2" stroke-linejoin="round"><ellipse cx="24" cy="40" rx="18" ry="4" fill="#fff" /><rect x="9" y="22" width="30" height="16" rx="4" fill="#ffd05c" /><path d="M8 22c0-7 7-10 16-10s16 3 16 10c-3 3-5 0-8 3s-5 0-8 3-5 0-8-3-5 0-8-3z" fill="#ff8fa6" /><circle cx="24" cy="9" r="4" fill="#e0314f" /></svg>
        <span class="hidden truncate font-display text-xl text-brand-700 sm:inline">ร้านเค้ก</span>
      </RouterLink>

      <SystemSwitcher :systems="systems" :current="current" />

      <nav v-if="items.length > 1" class="ml-1 hidden gap-0.5 md:flex lg:gap-1" aria-label="เมนูของระบบ">
        <RouterLink
          v-for="i in items"
          :key="i.to"
          :to="i.to"
          class="relative rounded-full px-2 py-1.5 text-sm font-medium whitespace-nowrap text-stone-600 hover:bg-white lg:px-3.5"
          :active-class="i.exact ? '' : 'bg-white text-brand-700 shadow-sm'"
          :exact-active-class="i.exact ? 'bg-white text-brand-700 shadow-sm' : ''"
        >
          {{ i.label }}<span v-if="i.badge && badges[i.badge]" class="ml-1 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{{ badges[i.badge] }}</span>
        </RouterLink>
      </nav>

      <RouterLink to="/" class="ml-auto inline-flex items-center text-sm text-stone-600 underline lg:min-h-8 lg:px-1">หน้าร้าน</RouterLink>
      <BellMenu audience="staff" />
      <button class="inline-flex h-10 max-w-40 items-center gap-2 rounded-full bg-white px-3 text-sm shadow-sm lg:px-3.5" :aria-label="`ผู้ใช้ ${me?.name || ROLES[session.role]}`" @click="roleOpen = true">
        <AppIcon name="user" :size="16" class="shrink-0 text-stone-500" />
        <span class="hidden truncate lg:inline">{{ me?.name || ROLES[session.role] }}</span>
      </button>
    </div>
  </header>
  <SyncBar />

  <!-- lock = ล็อกหน้า (เช่น แชท): main ตรึงใต้แถบบน ไม่ให้หน้าเว็บเลื่อน แต่ละกรอบข้างในเลื่อนเอง · ไม่พึ่ง dvh -->
  <main
    id="main-content"
    tabindex="-1"
    class="mx-auto max-w-page outline-none px-4 lg:px-8"
    :style="lockStyle"
    :class="$route.meta.lock ? ['fixed inset-x-0 overflow-hidden', kbLock ? 'pt-1 pb-1' : 'pt-3', kbLock ? '' : $route.meta.focus || !navShow ? 'pb-[calc(env(safe-area-inset-bottom)+0.75rem)]' : 'pb-[calc(env(safe-area-inset-bottom)+4.5rem)] md:pb-3'] : [$route.meta.focus || !showBottom ? 'pb-8' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-10', 'pt-5']"
  >
    <RouterView :key="$route.fullPath" />
  </main>

  <!-- แถบเมนูล่าง (มือถือ) -->
  <nav
    v-if="navShow"
    class="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl bg-white/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgb(63_46_46/0.10)] backdrop-blur-xl md:hidden"
    aria-label="เมนูล่าง"
  >
    <div class="mx-auto grid h-16 max-w-md items-center" :style="{ gridTemplateColumns: `repeat(${bottomCols}, minmax(0, 1fr))` }">
      <RouterLink
        v-for="i in bottomItems"
        :key="i.to"
        :to="i.to"
        class="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-stone-600"
        :active-class="i.exact ? '' : 'text-brand-700!'"
        :exact-active-class="i.exact ? 'text-brand-700!' : ''"
      >
        <AppIcon :name="i.icon" :size="22" />
        {{ i.mobileLabel || i.label }}
        <span v-if="i.badge && badges[i.badge]" class="absolute -top-1 left-1/2 ml-2 min-w-4 rounded-full bg-brand-600 px-1 text-center text-[10px] leading-4 font-semibold text-white">{{ badges[i.badge] }}</span>
      </RouterLink>
      <button v-if="hasSwitch" type="button" data-bottom-system class="relative flex min-h-14 flex-col items-center justify-center gap-0.5 text-[12px] font-medium text-stone-600" aria-haspopup="menu" :aria-expanded="sysOpen" @click="sysOpen = !sysOpen">
        <AppIcon name="grid" :size="22" />
        ระบบ
        <span class="sr-only">ปัจจุบัน {{ curLabel }}</span>
      </button>
    </div>
    <div v-if="sysOpen" data-bottom-system data-system-sheet role="menu" class="absolute inset-x-3 bottom-[calc(100%+0.5rem)] overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200">
      <RouterLink v-for="sy in systems" :key="sy.key" :to="homeOf(sy, can)" role="menuitem" :data-system="sy.key" class="flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-medium" :class="sy.key === current ? 'bg-brand-50 text-brand-700' : 'text-stone-700 hover:bg-stone-50'" @click="sysOpen = false">
        <AppIcon :name="sy.icon" :size="20" /> {{ sy.label }}<AppIcon v-if="sy.key === current" name="check" :size="16" class="ml-auto" />
      </RouterLink>
    </div>
  </nav>

  <!-- เลือกบทบาท (จำลอง) -->
  <AppModal v-if="roleOpen && supabaseEnabled" title="บัญชีผู้ใช้" @close="roleOpen = false">
    <p class="text-sm text-stone-700">{{ me?.name }} · {{ ROLES[me?.role] }}</p>
    <button type="button" class="btn-outline mt-4 w-full" @click="logout">ออกจากระบบ</button>
  </AppModal>
  <AppModal v-else-if="roleOpen" title="ทดลองใช้งานเป็นผู้ใช้" @close="roleOpen = false">
    <div class="grid gap-2">
      <button
        v-for="u in db.users.filter((x) => x.active !== false)"
        :key="u.id"
        class="flex items-center justify-between gap-2 rounded-2xl border-2 px-4 py-3 text-left"
        :class="session.userId === u.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-stone-200 hover:bg-stone-50'"
        @click="switchUser(u.id); roleOpen = false"
      >
        <span class="min-w-0"><span class="block truncate font-medium">{{ u.name }}</span><span class="block text-xs text-stone-500">{{ ROLES[u.role] }} · {{ u.perms?.length || 0 }} สิทธิ์</span></span>
        <AppIcon v-if="session.userId === u.id" name="check" class="shrink-0 text-brand-600" />
      </button>
    </div>
    <p class="mt-3 text-xs text-stone-600">ยังไม่มีล็อกอินจริง: สลับผู้ใช้เพื่อทดลองสิทธิ์ที่ติ๊กไว้</p>
  </AppModal>
  </template>

  <ConfirmDialog />
  <ToastHost />
</template>
