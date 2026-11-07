<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { can } from '../data/store'
import { homeOf } from '../lib/adminSystems'
import AppIcon from './AppIcon.vue'

// ตัวสลับระบบหลังบ้าน: จอ ≥ xl เป็นป้ายแคปซูล · จอเล็กเป็นปุ่มเดียว + เมนูเลือกระบบ
const props = defineProps({ systems: { type: Array, required: true }, current: { type: String, default: '' } })
const open = ref(false)
const root = ref(null)
const cur = computed(() => props.systems.find((s) => s.key === props.current) || props.systems[0])
function outside(e) { if (open.value && root.value && !root.value.contains(e.target)) open.value = false }
function esc(e) { if (e.key === 'Escape' && open.value) open.value = false }
onMounted(() => { document.addEventListener('pointerdown', outside); document.addEventListener('keydown', esc) })
onBeforeUnmount(() => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc) })
</script>

<template>
  <div v-if="systems.length > 1" ref="root" class="relative shrink-0" data-system-switcher>
    <!-- จอใหญ่: ป้ายครบ 4 ระบบ -->
    <div class="hidden items-center gap-1 rounded-full bg-white/70 p-1 xl:flex" aria-label="ระบบหลังบ้าน">
      <RouterLink
        v-for="s in systems"
        :key="s.key"
        :to="homeOf(s, can)"
        :aria-current="s.key === current ? 'page' : undefined"
        :data-system="s.key"
        class="inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap"
        :class="s.key === current ? 'bg-brand-600 text-white shadow-sm' : 'text-stone-600 hover:bg-white'"
      >
        <AppIcon :name="s.icon" :size="16" /> {{ s.label }}
      </RouterLink>
    </div>
    <!-- จอเล็ก: ปุ่มเดียว -->
    <button
      type="button"
      data-system-button
      class="inline-flex h-10 items-center gap-1.5 rounded-full bg-brand-600 px-3.5 text-sm font-semibold whitespace-nowrap text-white shadow-sm xl:hidden"
      aria-haspopup="menu"
      :aria-expanded="open"
      aria-label="เลือกระบบ"
      @click="open = !open"
    >
      <AppIcon :name="cur.icon" :size="16" /> {{ cur.label }} <span aria-hidden="true" class="text-xs">▾</span>
    </button>
    <div v-if="open" data-system-menu role="menu" class="absolute top-full left-0 z-40 mt-2 w-48 overflow-hidden rounded-2xl bg-white p-1.5 shadow-xl ring-1 ring-stone-200 xl:hidden">
      <RouterLink
        v-for="s in systems"
        :key="s.key"
        :to="homeOf(s, can)"
        role="menuitem"
        :data-system="s.key"
        class="flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium"
        :class="s.key === current ? 'bg-brand-50 text-brand-700' : 'text-stone-700 hover:bg-stone-50'"
        @click="open = false"
      >
        <AppIcon :name="s.icon" :size="18" /> {{ s.label }}
      </RouterLink>
    </div>
  </div>
</template>
