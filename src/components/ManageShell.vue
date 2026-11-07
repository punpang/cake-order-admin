<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { can } from '../data/store'
import { SETTINGS_PAGES } from '../lib/settingsPages'
import AppIcon from './AppIcon.vue'
import AppSwitch from './AppSwitch.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  back: { type: String, default: '/admin/settings' },
  addLabel: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'ค้นหา' },
  toolbar: { type: Boolean, default: true },
  narrow: { type: Boolean, default: false }, // หน้าฟอร์ม/ตั้งค่า: จำกัดความกว้างให้อ่านง่าย (หน้ารายการใช้เต็มพื้นที่)
  perm: { type: String, default: 'manage' }, // สิทธิ์ที่ต้องมีจึงเห็นหน้านี้
})
const emit = defineEmits(['add'])
// PC: เมนูข้างรายการหน้าตั้งค่า (เฉพาะหน้าย่อย /admin/settings/*) สลับหน้าได้โดยไม่ต้องกลับหน้าการ์ด
const route = useRoute()
const side = computed(() => route.path.startsWith('/admin/settings/') ? SETTINGS_PAGES.filter((x) => can(x.perm || 'manage')) : [])
const q = defineModel('q', { type: String, default: '' })
const showInactive = defineModel('inactive', { type: Boolean, default: false })
</script>

<template>
  <div v-if="!can(perm)" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><AppIcon name="user" :size="28" /></span>
    <h1 class="text-base font-semibold text-stone-800">ไม่มีสิทธิ์ใช้งานหน้านี้</h1>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else :class="side.length ? 'lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-6' : ''">
    <nav v-if="side.length" aria-label="เมนูตั้งค่า" class="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-stone-200 lg:block">
      <RouterLink
        v-for="p in side"
        :key="p.to"
        :to="p.to"
        class="flex min-h-9 items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
        active-class="bg-brand-50 font-semibold text-brand-700"
      ><AppIcon :name="p.icon" :size="16" class="shrink-0" /><span class="min-w-0">{{ p.title }}</span></RouterLink>
    </nav>
    <div :class="narrow ? 'mx-auto w-full max-w-4xl xl:max-w-5xl' : 'min-w-0'">
    <div class="mb-4 flex items-center gap-2">
      <RouterLink :to="back" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm hover:bg-brand-50" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <h1 class="truncate text-[22px] text-stone-900">{{ title }}</h1>
        <p v-if="subtitle" class="truncate text-sm text-stone-500">{{ subtitle }}</p>
      </div>
      <button v-if="addLabel" class="btn-primary px-3 sm:px-4" @click="emit('add')">
        <AppIcon name="plus" /> <span class="hidden sm:inline">{{ addLabel }}</span>
      </button>
    </div>

    <div v-if="toolbar" class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <label class="relative block min-w-0 flex-1">
        <span class="sr-only">{{ searchPlaceholder }}</span>
        <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
        <input v-model="q" type="search" class="input bg-white pl-10" :placeholder="searchPlaceholder" />
      </label>
      <AppSwitch v-model="showInactive" label="แสดงที่ปิดใช้งาน" class="shrink-0 px-1 lg:min-h-8" />
    </div>

    <slot />
    </div>
  </div>
</template>
