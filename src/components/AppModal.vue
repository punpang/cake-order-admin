<script setup>
import { onBeforeUnmount, onMounted, ref, useId } from 'vue'
import { useDialogA11y } from '../lib/dialogA11y'
import { kb } from '../lib/viewportFit'
import AppIcon from './AppIcon.vue'

defineProps({ top: { type: Boolean, default: false }, title: { type: String, default: '' }, wide: { type: Boolean, default: false }, wider: { type: Boolean, default: false }, full: { type: Boolean, default: false }, big: { type: Boolean, default: false }, fit: { type: Boolean, default: false }, split: { type: Boolean, default: false } }) // full: เต็มจอ · fit: ไม่มีการเลื่อนทั้งแนวตั้งและแนวนอน (เนื้อหาต้องพอดีกรอบ) // wider: กว้างขึ้นบนจอ lg สำหรับเลย์เอาต์สองคอลัมน์ · top: วางกล่องชิดด้านบนของพื้นที่ที่มองเห็น (ใช้กับ dialog ที่มีแป้นตัวเลขอยู่ล่าง)
const emit = defineEmits(['close'])
const box = ref(null)
const titleId = `dlg-${useId()}`
// กรอกข้อมูลค้างอยู่ → คลิกพื้นหลังไม่ปิด (กันข้อมูลหายโดยไม่ตั้งใจ) · ปุ่ม ✕ / Esc ยังปิดได้
const dirty = ref(false)
const backdrop = () => { if (!dirty.value) emit('close') }
useDialogA11y(box, () => emit('close'))

// ล็อกการเลื่อนหน้าข้างหลังขณะเปิด
onMounted(() => document.body.classList.add('overflow-hidden'))
onBeforeUnmount(() => document.body.classList.remove('overflow-hidden'))
</script>

<template>
  <Teleport to="body">
    <!-- ความสูงอ้างอิงจาก overlay (fixed inset-0) ไม่ใช้ dvh: กล่องไม่เกินจอทุกเบราว์เซอร์/สเกล · overlay เลื่อนได้เป็นทางหนี -->
    <!-- แป้นพิมพ์เปิด (iOS ไม่ลดขนาด layout viewport): ยึดกรอบกับส่วนที่มองเห็นจริง เพื่อให้ช่องกรอกและปุ่มล่างไม่ถูกบัง -->
    <div
      class="fixed inset-0 z-[62] overscroll-contain bg-stone-900/45 backdrop-blur-[2px]" :class="fit ? 'overflow-hidden' : 'overflow-y-auto'"
      :style="kb.open ? { top: 'var(--vvt, 0px)', bottom: 'auto', height: 'var(--vvh, 100%)' } : undefined"
    >
    <div class="flex h-full justify-center" :class="full ? 'items-end pt-0 sm:items-center sm:p-0' : top ? 'items-start p-4 pt-6 sm:p-6' : 'items-center p-4 sm:p-6'" @click.self="backdrop">
      <div
        ref="box"
        data-dialog
        tabindex="-1"
        :aria-labelledby="title ? titleId : undefined"
        @input.capture="dirty = true"
        @change.capture="dirty = true"
        class="flex max-h-full min-h-0 w-full flex-col overflow-hidden bg-cream shadow-2xl outline-none"
        :class="full ? 'h-full rounded-none sm:h-full sm:max-w-none sm:rounded-none' : big ? 'max-h-[calc(100dvh-2rem)] rounded-[2rem] sm:h-[90dvh] sm:w-[80vw] sm:max-w-none sm:max-h-none' : ['rounded-[2rem]', split ? 'sm:max-w-md landscape:lg:max-w-5xl' : wider ? 'sm:max-w-2xl lg:max-w-5xl' : wide ? 'sm:max-w-2xl' : 'sm:max-w-md']"
        role="dialog"
        aria-modal="true"
      >
        <div class="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-stone-300" :class="full ? 'sm:hidden' : 'hidden'" />
        <div class="flex shrink-0 items-center justify-between gap-2 px-5 pt-3 pb-2 sm:pt-5">
          <h2 :id="titleId" class="min-w-0 truncate text-lg text-stone-900">{{ title }}</h2>
          <button type="button" class="flex h-9 w-9 items-center justify-center rounded-full text-stone-500 hover:bg-stone-100" aria-label="ปิด" @click="emit('close')">
            <AppIcon name="x" :size="20" />
          </button>
        </div>
        <div data-dialog-body class="min-h-0 flex-1 overscroll-contain px-5 pt-1 pb-5" :class="[fit ? 'overflow-hidden' : 'overflow-y-auto', split ? 'landscape:lg:grid landscape:lg:grid-cols-2 landscape:lg:items-start landscape:lg:gap-x-6' : '']">
          <slot v-if="!split" />
          <template v-else>
            <!-- split: แนวตั้ง/มือถือเรียงซ้ายแล้วขวาเหมือนเดิม · แนวนอนแบ่งสองคอลัมน์ -->
            <div class="min-w-0 space-y-4"><slot name="left" /></div>
            <div class="min-w-0 space-y-4"><slot name="right" /></div>
          </template>
        </div>
        <div
          v-if="$slots.footer"
          class="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-stone-200/70 bg-cream px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] sm:pb-4"
        >
          <slot name="footer" />
        </div>
      </div>
    </div>
    </div>
  </Teleport>
</template>
