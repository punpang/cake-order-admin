<script setup>
import { confirmState, closeConfirm } from '../lib/confirm'
import AppIcon from './AppIcon.vue'
</script>

<template>
  <Teleport to="body">
    <div v-if="confirmState.open" class="fixed inset-0 z-[60] flex items-center justify-center bg-stone-900/50 p-6" @click.self="closeConfirm(false)">
      <div class="w-full max-w-sm rounded-3xl bg-white p-5 shadow-2xl" role="alertdialog" aria-modal="true">
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" :class="confirmState.danger ? 'bg-rose-50 text-rose-600' : 'bg-brand-50 text-brand-600'">
            <AppIcon name="alert" :size="20" />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="text-lg font-semibold text-stone-900">{{ confirmState.title }}</h2>
            <p v-if="confirmState.message" class="mt-1 text-sm break-words whitespace-pre-line text-stone-600">{{ confirmState.message }}</p>
          </div>
        </div>
        <div class="mt-5 flex gap-2">
          <button class="btn-outline flex-1" @click="closeConfirm(false)">ยกเลิก</button>
          <button class="flex-1" :class="confirmState.danger ? 'btn-danger' : 'btn-primary'" @click="closeConfirm(true)">{{ confirmState.okText }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
