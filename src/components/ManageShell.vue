<script setup>
import { can } from '../data/store'
import AppIcon from './AppIcon.vue'
import AppSwitch from './AppSwitch.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  back: { type: String, default: '/admin/manage' },
  addLabel: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'ค้นหา' },
  toolbar: { type: Boolean, default: true },
  narrow: { type: Boolean, default: false }, // หน้าฟอร์ม/ตั้งค่า: จำกัดความกว้างให้อ่านง่าย (หน้ารายการใช้เต็มพื้นที่)
  perm: { type: String, default: 'manage' }, // สิทธิ์ที่ต้องมีจึงเห็นหน้านี้
})
const emit = defineEmits(['add'])
const q = defineModel('q', { type: String, default: '' })
const showInactive = defineModel('inactive', { type: Boolean, default: false })
</script>

<template>
  <div v-if="!can(perm)" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><AppIcon name="user" :size="28" /></span>
    <div class="font-semibold text-stone-800">ไม่มีสิทธิ์ใช้งานหน้านี้</div>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else :class="narrow ? 'mx-auto max-w-4xl' : ''">
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
      <AppSwitch v-model="showInactive" label="แสดงที่ปิดใช้งาน" class="shrink-0 px-1" />
    </div>

    <slot />
  </div>
</template>
