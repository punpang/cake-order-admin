<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { db, session, can, switchUser, unreadChats, runScheduledChecks } from './data/store'
import { ROLES } from './lib/constants'
import AppIcon from './components/AppIcon.vue'
import AppModal from './components/AppModal.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import StoreLayout from './components/StoreLayout.vue'

const roleOpen = ref(false)
// เมนูล่างมือถือ: ออร์เดอร์ / แชท / POS / ครัว / จัดการ (เฉพาะที่มีสิทธิ์)
const tabCount = computed(() => 1 + (can('chat') ? 1 : 0) + (can('pos') ? 1 : 0) + (can('viewMaterials') ? 1 : 0) + (can('manage') ? 1 : 0))
const unread = computed(() => unreadChats())
const me = computed(() => db.users.find((u) => u.id === session.userId))
// จำลอง cron: ตรวจแจ้งเตือนตามเวลาทุก 60 วินาทีขณะเปิดแอป (ของจริงใช้ cron ฝั่งเซิร์ฟเวอร์)
let timer = null
onMounted(() => { timer = setInterval(() => runScheduledChecks(), 60000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <!-- หน้าร้าน + ระบบลูกค้า -->
  <StoreLayout v-if="$route.meta.store" />

  <template v-else>
  <!-- แถบบน -->
  <header class="sticky top-0 z-20 border-b border-stone-200/60 bg-cream/85 backdrop-blur-xl">
    <div class="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
      <RouterLink to="/admin/orders" class="flex min-w-0 items-center gap-2.5">
        <span class="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-white">
          <AppIcon name="cake" :size="20" />
        </span>
        <span class="truncate font-semibold text-stone-900">ร้านเค้ก <span class="font-normal text-stone-500">· หลังบ้าน</span></span>
      </RouterLink>

      <nav class="ml-4 hidden gap-1 md:flex">
        <RouterLink to="/admin/orders" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">ออร์เดอร์</RouterLink>
        <RouterLink v-if="can('createOrder')" to="/admin/orders/new" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">สร้างออร์เดอร์</RouterLink>
        <RouterLink v-if="can('chat')" to="/admin/chat" class="relative rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" active-class="bg-white text-brand-700 shadow-sm">
          แชท<span v-if="unread" class="ml-1 rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold text-white">{{ unread }}</span>
        </RouterLink>
        <RouterLink v-if="can('pos')" to="/admin/pos" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" active-class="bg-white text-brand-700 shadow-sm">POS</RouterLink>
        <RouterLink v-if="can('viewMaterials')" to="/admin/materials" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">วัตถุดิบ</RouterLink>
        <RouterLink v-if="can('viewMaterials')" to="/admin/production" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" exact-active-class="bg-white text-brand-700 shadow-sm">ตารางผลิต</RouterLink>
        <RouterLink v-if="can('manage')" to="/admin/manage" class="rounded-lg px-3 py-1.5 text-sm font-medium text-stone-600 hover:bg-white" active-class="bg-white text-brand-700 shadow-sm">จัดการ</RouterLink>
      </nav>

      <RouterLink to="/" class="ml-auto text-sm text-stone-500 underline">หน้าร้าน</RouterLink>
      <button class="inline-flex max-w-40 items-center gap-2 rounded-xl border border-stone-200 bg-white px-3 py-1.5 text-sm" :aria-label="`ผู้ใช้ ${me?.name || ROLES[session.role]}`" @click="roleOpen = true">
        <AppIcon name="user" :size="16" class="shrink-0 text-stone-500" />
        <span class="truncate">{{ me?.name || ROLES[session.role] }}</span>
      </button>
    </div>
  </header>

  <main
    class="mx-auto max-w-6xl px-4 pt-5"
    :class="$route.meta.focus ? 'pb-8' : 'pb-[calc(env(safe-area-inset-bottom)+6rem)] md:pb-10'"
  >
    <RouterView :key="$route.fullPath" />
  </main>

  <!-- แถบเมนูล่าง (มือถือ) -->
  <nav
    v-if="!$route.meta.focus"
    class="fixed inset-x-0 bottom-0 z-30 border-t border-stone-200/70 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl md:hidden"
  >
    <div class="mx-auto grid h-16 max-w-md items-center" :style="{ gridTemplateColumns: `repeat(${tabCount}, minmax(0, 1fr))` }">
      <RouterLink to="/admin/orders" class="flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" exact-active-class="text-brand-700!">
        <AppIcon name="list" :size="22" />
        ออร์เดอร์
      </RouterLink>
      <RouterLink v-if="can('chat')" to="/admin/chat" class="relative flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" active-class="text-brand-700!">
        <AppIcon name="chat" :size="22" />
        แชท
        <span v-if="unread" class="absolute -top-1 left-1/2 ml-2 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] leading-4 font-semibold text-white">{{ unread }}</span>
      </RouterLink>
      <RouterLink v-if="can('pos')" to="/admin/pos" class="flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" active-class="text-brand-700!">
        <AppIcon name="pos" :size="22" />
        POS
      </RouterLink>
      <RouterLink
        v-if="can('viewMaterials')"
        to="/admin/materials"
        class="flex flex-col items-center gap-0.5 text-[11px] font-medium"
        :class="['/admin/materials', '/admin/production'].includes($route.path) ? 'text-brand-700' : 'text-stone-500'"
      >
        <AppIcon name="basket" :size="22" />
        ครัว
      </RouterLink>
      <RouterLink v-if="can('manage')" to="/admin/manage" class="flex flex-col items-center gap-0.5 text-[11px] font-medium text-stone-500" active-class="text-brand-700!">
        <AppIcon name="grid" :size="22" />
        จัดการ
      </RouterLink>
    </div>
  </nav>

  <!-- เลือกบทบาท (จำลอง) -->
  <AppModal v-if="roleOpen" title="ทดลองใช้งานเป็นผู้ใช้" @close="roleOpen = false">
    <div class="grid gap-2">
      <button
        v-for="u in db.users.filter((x) => x.active !== false)"
        :key="u.id"
        class="flex items-center justify-between gap-2 rounded-xl border px-4 py-3 text-left"
        :class="session.userId === u.id ? 'border-brand-500 bg-brand-50 text-brand-800' : 'border-stone-200 hover:bg-stone-50'"
        @click="switchUser(u.id); roleOpen = false"
      >
        <span class="min-w-0"><span class="block truncate font-medium">{{ u.name }}</span><span class="block text-xs text-stone-500">{{ ROLES[u.role] }} · {{ u.perms?.length || 0 }} สิทธิ์</span></span>
        <AppIcon v-if="session.userId === u.id" name="check" class="shrink-0 text-brand-600" />
      </button>
    </div>
    <p class="mt-3 text-xs text-stone-400">ยังไม่มีล็อกอินจริง: สลับผู้ใช้เพื่อทดลองสิทธิ์ที่ติ๊กไว้</p>
  </AppModal>
  </template>

  <ConfirmDialog />
</template>
