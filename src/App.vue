<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { db, session, can, switchUser, unreadChats, runScheduledChecks, orderVisible } from './data/store'
import { quietly } from './lib/loading'
import { paymentCounts } from './lib/paymentsQueue'
import { focusMain } from './lib/a11yNav'
import { supabaseEnabled } from './lib/supabase'
import { testModeOn, writeTestMode } from './lib/testMode'
const testOn = testModeOn(supabaseEnabled)
function leaveTestMode() { writeTestMode(false); location.reload() }
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
import NumPad from './components/NumPad.vue'
import { attachNumPad } from './lib/numpad'
import StoreLayout from './components/StoreLayout.vue'

const roleOpen = ref(false)
// 4 ระบบหลังบ้าน (lib/adminSystems.js): ตัวสลับระบบ + เมนูย่อยของระบบปัจจุบัน
const route = useRoute()
// ชื่อร้านจากตั้งค่าร้าน (ไม่ฝังชื่อไว้ในโค้ด) · แท็บเบราว์เซอร์แสดงชื่อร้านอย่างเดียว
const shopName = computed(() => (db.shop.name || '').trim() || 'ร้านของคุณ')
watchEffect(() => { document.title = shopName.value })
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
// ตามขนาดส่วนที่มองเห็นจริงเมื่อแป้นพิมพ์เปิด ทุกหน้า (ป็อปอัป/แถบล่างไม่ถูกแป้นพิมพ์บัง) · หน้าล็อก (แชท) ซ่อนแถบเมนูล่างระหว่างพิมพ์
const stopVv = watchViewport()
onBeforeUnmount(() => stopVv())
// แป้นตัวเลขของแอป (บนอุปกรณ์สัมผัส): ช่องตัวเลขไม่เปิดแป้นพิมพ์ของระบบ เพื่อไม่ให้แถบ ↑ ↓ ✓ ของ iOS ขึ้น
const stopNumPad = attachNumPad()
onBeforeUnmount(() => stopNumPad())
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
onMounted(() => { timer = setInterval(() => { if (!supabaseEnabled || staffState.staff) quietly(runScheduledChecks) }, 60000); document.addEventListener('pointerdown', sysOutside); document.addEventListener('keydown', sysEsc) })
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('pointerdown', sysOutside); document.removeEventListener('keydown', sysEsc) })
</script>

<template>
  <div v-if="testOn" role="status" class="sticky top-0 z-50 flex flex-wrap items-center justify-center gap-2 bg-amber-500 px-3 py-1.5 text-center text-sm font-medium text-white">
    <span>โหมดทดสอบ · ข้อมูลแยกจากของจริง · ตั้งค่าร้านใช้ร่วมกันและแก้ไม่ได้</span>
    <button type="button" class="rounded-full bg-white/20 px-3 py-0.5 hover:bg-white/30" @click="leaveTestMode">ออกจากโหมดทดสอบ</button>
  </div>
  <button type="button" class="skip-link" @click="focusMain()">ข้ามไปเนื้อหาหลัก</button>
  <LightboxHost />
  <LoadingOverlay v-if="!$route.meta.display" />
  <NumPad />
  <!-- หน้าร้าน + ระบบลูกค้า -->
  <StoreLayout v-if="$route.meta.store" />
  <main v-else-if="$route.meta.bare" id="main-content" tabindex="-1" class="outline-none"><RouterView /></main>

  <template v-else>
  <!-- แถบบน -->
  <header v-show="!kbLock" class="sticky top-0 z-20 bg-cream shadow-[0_1px_0_rgb(63_46_46/0.06)]">
    <!-- จอแคบ: ระยะห่างเล็กลง โลโก้ไม่ถูกบีบ (เดิมปุ่มเลือกระบบทับโลโก้) และลิงก์หน้าร้านเป็นไอคอน (< 375px)
         จอแคบกว่า 360px ซ่อนโลโก้ (ปุ่มเลือกระบบพาไปหน้าแรกของแต่ละระบบได้อยู่แล้ว) ไม่อย่างนั้นปุ่มผู้ใช้ล้นขอบขวา -->
    <div class="mx-auto flex h-14 max-w-page items-center gap-2 px-4 sm:gap-3 lg:px-8">
      <RouterLink :to="firstHome(can)" class="flex shrink-0 items-center gap-2.5 max-[359px]:hidden" :aria-label="`${shopName} หน้าแรกหลังบ้าน`">
        <svg viewBox="0 0 48 48" class="h-10 w-10 shrink-0" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2" stroke-linejoin="round"><ellipse cx="24" cy="40" rx="18" ry="4" fill="#fff" /><rect x="9" y="22" width="30" height="16" rx="4" fill="#ffd05c" /><path d="M8 22c0-7 7-10 16-10s16 3 16 10c-3 3-5 0-8 3s-5 0-8 3-5 0-8-3-5 0-8-3z" fill="#ff8fa6" /><circle cx="24" cy="9" r="4" fill="#e0314f" /></svg>
        <span class="hidden max-w-40 truncate font-display text-xl text-brand-700 2xl:inline">{{ shopName }}</span>
      </RouterLink>

      <SystemSwitcher :systems="systems" :current="current" />

      <nav v-if="items.length > 1" class="ml-1 hidden min-w-0 gap-1 overflow-x-auto [scrollbar-width:none] lg:flex" aria-label="เมนูของระบบ">
        <RouterLink
          v-for="i in items"
          :key="i.to"
          :to="i.to"
          class="relative rounded-full px-3 py-1.5 text-sm font-medium whitespace-nowrap text-stone-600 hover:bg-white xl:px-3.5"
          :active-class="i.exact ? '' : 'bg-white text-brand-700 shadow-sm'"
          :exact-active-class="i.exact ? 'bg-white text-brand-700 shadow-sm' : ''"
        >
          {{ i.label }}<span v-if="i.badge && badges[i.badge]" class="ml-1 rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold text-white">{{ badges[i.badge] }}</span>
        </RouterLink>
      </nav>

      <RouterLink to="/" class="ml-auto inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center px-1.5 text-sm whitespace-nowrap text-stone-600 underline" aria-label="หน้าร้าน">
        <AppIcon name="store" :size="20" class="min-[375px]:hidden" />
        <span class="hidden min-[375px]:inline">หน้าร้าน</span>
      </RouterLink>
      <BellMenu audience="staff" />
      <button class="inline-flex h-10 max-w-40 items-center gap-2 rounded-full bg-white px-3 text-sm shadow-sm lg:px-3.5" :aria-label="`ผู้ใช้ ${me?.name || ROLES[session.role]}`" @click="supabaseEnabled && (roleOpen = true)">
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
    :class="$route.meta.lock ? ['fixed inset-x-0 overflow-hidden', kbLock ? 'px-0! pt-0 pb-0' : 'px-0! pt-0', kbLock ? '' : $route.meta.focus || !navShow ? 'pb-0' : 'pb-[calc(env(safe-area-inset-bottom)+4.5rem)] lg:pb-0'] : [$route.meta.focus || !showBottom ? 'pb-8' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)] lg:pb-10', 'pt-5']"
  >
    <RouterView :key="$route.fullPath" />
  </main>

  <!-- แถบเมนูล่าง (มือถือ + แท็บเล็ตแนวตั้ง < lg): แถบบนไม่พอวางเมนูย่อยทั้งหมดจนกว่าจะกว้าง 1024px -->
  <nav
    v-if="navShow"
    class="fixed inset-x-0 bottom-0 z-30 rounded-t-3xl bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-6px_20px_rgb(63_46_46/0.10)] lg:hidden"
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

  <!-- บัญชีผู้ใช้ (ต่อ Supabase) -->
  <AppModal v-if="roleOpen && supabaseEnabled" title="บัญชีผู้ใช้" @close="roleOpen = false">
    <p class="text-sm text-stone-700">{{ me?.name }} · {{ ROLES[me?.role] }}</p>
    <button type="button" class="btn-outline mt-4 w-full" @click="logout">ออกจากระบบ</button>
  </AppModal>
  </template>

  <ConfirmDialog />
  <ToastHost />
</template>
