<script setup>
import { nextTick, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'
import { numpad, pressNumpadKey } from '../lib/numpad'
import { setVirtualKeyboardHeight } from '../lib/viewportFit'

// แผงปุ่มตัวเลข (แทนแป้นพิมพ์ของระบบในช่องตัวเลข) · วางไว้ล่างจอ และแจ้งความสูงให้ระบบจัดกล่องอยู่เหนือแผง เหมือนแป้นพิมพ์
// ปุ่มใช้ pointerdown + preventDefault เพื่อไม่ให้โฟกัสหลุดจากช่องที่กำลังกรอก
const pad = ref(null)
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9']

watch(() => numpad.open, async (open) => {
  if (!open) return
  await nextTick()
  setVirtualKeyboardHeight(pad.value?.getBoundingClientRect().height || 0)
  // เลื่อนให้ช่องที่กำลังกรอกอยู่เหนือแผงปุ่ม
  numpad.target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
})
</script>

<template>
  <Teleport to="body">
    <div
      v-if="numpad.open"
      ref="pad"
      data-numpad-pad
      role="group"
      aria-label="แป้นตัวเลข"
      class="fixed inset-x-0 bottom-0 z-[90] rounded-t-3xl bg-stone-100 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shadow-[0_-8px_24px_rgb(63_46_46/0.14)]"
    >
      <div class="grid grid-cols-3 gap-2">
        <button
          v-for="d in DIGITS"
          :key="d"
          type="button"
          tabindex="-1"
          class="h-12 rounded-xl bg-white text-xl font-semibold text-stone-900 shadow-sm active:bg-stone-200"
          @pointerdown.prevent="pressNumpadKey(d)"
          @mousedown.prevent
        >{{ d }}</button>
        <button
          type="button"
          tabindex="-1"
          class="h-12 rounded-xl text-xl font-semibold text-stone-700 active:bg-stone-300"
          :class="numpad.mode === 'dec' ? 'bg-stone-200' : 'invisible'"
          :disabled="numpad.mode !== 'dec'"
          @pointerdown.prevent="pressNumpadKey('.')"
          @mousedown.prevent
        >.</button>
        <button
          type="button"
          tabindex="-1"
          class="h-12 rounded-xl bg-white text-xl font-semibold text-stone-900 shadow-sm active:bg-stone-200"
          @pointerdown.prevent="pressNumpadKey('0')"
          @mousedown.prevent
        >0</button>
        <button
          type="button"
          tabindex="-1"
          aria-label="ลบ"
          class="flex h-12 items-center justify-center rounded-xl bg-stone-200 text-stone-700 active:bg-stone-300"
          @pointerdown.prevent="pressNumpadKey('back')"
          @mousedown.prevent
        ><AppIcon name="back" :size="20" /></button>
      </div>
    </div>
  </Teleport>
</template>
