<script setup>
import { computed } from 'vue'
import { artKindFor, ART_TONES } from '../../lib/cakeArt'

// ภาพวาดเค้ก (ใช้แทนรูปเมื่อร้านยังไม่อัปโหลดรูปจริง) · เติมเต็มกรอบแม่ ตั้งสัดส่วนที่กรอบแม่
const props = defineProps({ name: { type: String, default: '' }, kind: { type: String, default: '' } })
const k = computed(() => props.kind || artKindFor(props.name))
const tone = computed(() => ART_TONES[k.value] || '#ffd6df')
</script>

<template>
  <div class="flex h-full w-full items-center justify-center" :style="{ background: tone }">
    <svg viewBox="0 0 120 96" class="h-[72%] w-[72%]" aria-hidden="true" fill="none" stroke="#3f2e2e" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">
      <template v-if="k === 'pandan'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M14 52h92v22c0 6-20 10-46 10S14 80 14 74z" fill="#fffdf5" /><rect x="14" y="60" width="92" height="9" fill="#9ad27a" stroke="none" /><ellipse cx="60" cy="52" rx="46" ry="12" fill="#fff" /><path d="M52 40c-4-12 4-18 8-20 2 8 0 16-8 20zM66 42c2-12 12-14 18-12-4 8-10 12-18 12z" fill="#8ccb6a" /></template>
      <template v-else-if="k === 'choco'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M16 46h88v28c0 6-20 10-44 10S16 80 16 74z" fill="#7a4a36" /><ellipse cx="60" cy="46" rx="44" ry="12" fill="#5b3326" /><path d="M18 48c2 8 8 8 8 0 2 10 10 10 10 0 3 9 10 9 10 0 3 8 10 8 10 0 3 9 10 9 10 0 3 8 9 8 10 0 2 6 6 6 8 0" fill="#3f2118" /><circle cx="44" cy="40" r="5" fill="#9a5d44" /><circle cx="60" cy="37" r="5" fill="#9a5d44" /><circle cx="76" cy="40" r="5" fill="#9a5d44" /></template>
      <template v-else-if="k === 'bonbon'"><ellipse cx="60" cy="62" rx="52" ry="26" fill="#ff9d5b" /><ellipse cx="60" cy="60" rx="40" ry="18" fill="#ffb27e" stroke-width="2" /><circle cx="40" cy="52" r="14" fill="#ffd05c" /><circle cx="68" cy="46" r="14" fill="#c58bd6" /><circle cx="60" cy="68" r="14" fill="#ff8fa6" /><path d="M30 48c6-6 14-4 20 0" stroke="#ff8fa6" stroke-width="4" /><path d="M58 42c6-5 14-3 20 1" stroke="#fff" stroke-width="3.5" /></template>
      <template v-else-if="k === 'cream'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M16 44h88v30c0 6-20 10-44 10S16 80 16 74z" fill="#fff3d6" /><ellipse cx="60" cy="44" rx="44" ry="12" fill="#fff8e8" /><circle cx="60" cy="40" r="7" fill="#e0314f" /></template>
      <template v-else-if="k === 'piped'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M16 44h88v30c0 6-20 10-44 10S16 80 16 74z" fill="#ff8fa6" /><ellipse cx="60" cy="44" rx="44" ry="12" fill="#ffb3c2" /><path d="M22 66q5 8 10 0t10 0 10 0 10 0 10 0 10 0 10 0 10 0" stroke="#fff" stroke-width="5" /></template>
      <template v-else-if="k === 'sprinkle'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M16 44h88v30c0 6-20 10-44 10S16 80 16 74z" fill="#fff8e8" /><path d="M16 60q8 8 16 0t16 0 16 0 16 0 16 0 8 0" stroke="#ff8fa6" stroke-width="5" /><ellipse cx="60" cy="44" rx="44" ry="12" fill="#ffb3c2" /><circle cx="46" cy="42" r="3" fill="#ffd05c" stroke="none" /><circle cx="60" cy="38" r="3" fill="#8ed1a8" stroke="none" /><circle cx="74" cy="42" r="3" fill="#c58bd6" stroke="none" /></template>
      <template v-else-if="k === 'fondant'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M16 44h88v30c0 6-20 10-44 10S16 80 16 74z" fill="#fff" /><path d="M18 46c2 10 8 10 8 0 2 14 10 14 10 0 3 12 10 12 10 0 3 10 10 10 10 0 3 12 10 12 10 0 3 10 10 10 10 0 3 8 8 8 10 0z" fill="#ff8fa6" /><ellipse cx="60" cy="44" rx="44" ry="12" fill="#ff8fa6" /><circle cx="44" cy="36" r="6" fill="#e0314f" stroke-width="2.2" /><circle cx="60" cy="32" r="6" fill="#e0314f" stroke-width="2.2" /><circle cx="76" cy="36" r="6" fill="#e0314f" stroke-width="2.2" /></template>
      <template v-else-if="k === 'drink'"><path d="M36 30h48l-6 58H42z" fill="#fffdf5" /><path d="M40 50h40l-4 34H44z" fill="#d9a35b" /></template>
      <template v-else-if="k === 'pastry'"><ellipse cx="60" cy="84" rx="50" ry="8" fill="#fff" /><path d="M14 66c8-22 24-30 46-30s38 8 46 30c-6 10-18 14-46 14S20 76 14 66z" fill="#e8a25a" /></template>
      <template v-else><ellipse cx="60" cy="88" rx="50" ry="7" fill="#ffd05c" /><rect x="16" y="62" width="88" height="26" rx="7" fill="#ffd05c" /><ellipse cx="60" cy="62" rx="42" ry="10" fill="#ff8fa6" /><rect x="28" y="40" width="64" height="24" rx="6" fill="#ffe9c7" /><ellipse cx="60" cy="40" rx="32" ry="8" fill="#ff8fa6" /><circle cx="50" cy="32" r="6" fill="#e0314f" stroke-width="2" /><circle cx="64" cy="28" r="6.5" fill="#e0314f" stroke-width="2" /></template>
    </svg>
  </div>
</template>
