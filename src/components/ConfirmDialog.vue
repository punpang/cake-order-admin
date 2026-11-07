<script setup>
import { confirmState, closeConfirm } from '../lib/confirm'
import AppIcon from './AppIcon.vue'
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="fixed inset-0 z-[60] overflow-y-auto overscroll-contain bg-stone-900/50">
    <div class="flex h-full items-center justify-center p-6" @click.self="closeConfirm(false)">
      <div class="max-h-full w-full max-w-sm overflow-y-auto rounded-3xl bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" :class="confirmState.danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'">
            <AppIcon name="alert" :size="20" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold text-stone-900">{{ confirmState.title }}</h2>
            <p v-if="confirmState.message" class="mt-1 text-sm break-words whitespace-pre-line text-stone-600">{{ confirmState.message }}</p>
          </div>
        </div>
        <label v-if="confirmState.checkbox" class="mt-4 flex items-start gap-2 rounded-xl bg-stone-50 p-3 text-sm text-stone-700"><input v-model="confirmState.checked" type="checkbox" class="mt-0.5 h-4 w-4" :aria-label="confirmState.checkbox.label" /><span>{{ confirmState.checkbox.label }}<span v-if="confirmState.checkbox.hint" class="block text-xs text-stone-500">{{ confirmState.checkbox.hint }}</span></span></label>
        <div class="mt-5 flex gap-2">
          <button class="btn-outline flex-1" @click="closeConfirm(false)">ยกเลิก</button>
          <button class="flex-1" :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="closeConfirm(true)">{{ confirmState.okText }}</button>
        </div>
      </div>
    </div>
    </div>
  </Teleport>
</template>
