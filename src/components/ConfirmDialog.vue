<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { confirmState, closeConfirm } from '../lib/confirm'
import { kb } from '../lib/viewportFit'
import AppIcon from './AppIcon.vue'

// กล่องยืนยันถูกสร้างครั้งเดียวใน App (v-if ภายใน) → จัดการโฟกัสเองตามสถานะเปิด/ปิด
const box = ref(null)
const cancelBtn = ref(null)
let opener = null
function keydown(e) {
  if (!confirmState.open) return
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeConfirm(false); return }
  if (e.key !== 'Tab' || !box.value) return
  const list = [...box.value.querySelectorAll('button,input')].filter((x) => !x.disabled)
  if (!list.length) return
  const first = list[0]
  const last = list[list.length - 1]
  if (!box.value.contains(document.activeElement)) { e.preventDefault(); first.focus() }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
}
watch(() => confirmState.open, async (o) => {
  if (o) {
    opener = document.activeElement
    document.addEventListener('keydown', keydown, true)
    await nextTick()
    cancelBtn.value?.focus({ preventScroll: true }) // เริ่มที่ "ยกเลิก" (ปลอดภัย) ไม่ใช่ปุ่มยืนยัน
  } else {
    document.removeEventListener('keydown', keydown, true)
    if (opener && opener.isConnected) opener.focus({ preventScroll: true })
    opener = null
  }
})
const titleId = computed(() => 'confirm-title')
// เปลี่ยนหน้าขณะกล่องยืนยันเปิดอยู่ → ถือว่ายกเลิก (กันกล่องค้างทับหน้าใหม่)
const route = useRoute()
watch(() => route.path, () => { if (confirmState.open) closeConfirm(false) })
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-stone-900/50" :style="kb.open ? { top: 'var(--vvt, 0px)', bottom: 'auto', height: 'var(--vvh, 100%)' } : undefined">
    <div class="flex h-full items-center justify-center p-6" @click.self="closeConfirm(false)">
      <div class="max-h-full w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" ref="box" data-dialog role="alertdialog" aria-modal="true" :aria-labelledby="titleId" :aria-describedby="confirmState.message ? 'confirm-desc' : undefined">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" :class="confirmState.danger ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-600'">
            <AppIcon name="alert" :size="20" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 id="confirm-title" class="text-lg font-semibold text-stone-900">{{ confirmState.title }}</h2>
            <p v-if="confirmState.message" id="confirm-desc" class="mt-1 text-sm break-words whitespace-pre-line text-stone-600">{{ confirmState.message }}</p>
          </div>
        </div>
        <label v-if="confirmState.checkbox" class="mt-4 flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-700"><input v-model="confirmState.checked" type="checkbox" class="mt-0.5 h-4 w-4" :aria-label="confirmState.checkbox.label" /><span>{{ confirmState.checkbox.label }}<span v-if="confirmState.checkbox.hint" class="block text-xs text-stone-500">{{ confirmState.checkbox.hint }}</span></span></label>
        <label v-if="confirmState.checkbox2 && (!confirmState.checkbox || confirmState.checked)" class="mt-2 flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-700" data-sms-tick><input v-model="confirmState.checked2" type="checkbox" class="mt-0.5 h-4 w-4" :aria-label="confirmState.checkbox2.label" /><span>{{ confirmState.checkbox2.label }}<span v-if="confirmState.checkbox2.hint" class="block text-xs text-stone-500">{{ confirmState.checkbox2.hint }}</span></span></label>
        <div v-if="confirmState.reason" class="mt-4">
          <label class="label" for="confirm-reason">{{ confirmState.reason.label }} <span class="text-rose-600">*</span></label>
          <input id="confirm-reason" v-model="confirmState.reasonValue" class="input" maxlength="200" :aria-label="confirmState.reason.label" autocomplete="off" />
        </div>
        <div class="mt-5 flex gap-2">
          <button ref="cancelBtn" type="button" class="btn-outline flex-1" @click="closeConfirm(false)">ยกเลิก</button>
          <button type="button" class="flex-1" :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" :disabled="!!confirmState.reason?.required && !confirmState.reasonValue.trim()" @click="closeConfirm(true)">{{ confirmState.okText }}</button>
        </div>
      </div>
    </div>
    </div>
  </Teleport>
</template>
