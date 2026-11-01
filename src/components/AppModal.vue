<script setup>
defineProps({ title: { type: String, default: '' }, wide: { type: Boolean, default: false } })
defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-4" @click.self="$emit('close')">
      <div
        class="flex max-h-[92vh] w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl"
        :class="wide ? 'sm:max-w-2xl' : 'sm:max-w-md'"
      >
        <div class="flex items-center justify-between border-b border-stone-200 px-4 py-3">
          <h2 class="font-semibold">{{ title }}</h2>
          <button class="rounded-lg px-2 py-1 text-xl leading-none text-stone-500 hover:bg-stone-100" @click="$emit('close')">×</button>
        </div>
        <div class="overflow-y-auto p-4">
          <slot />
        </div>
        <div v-if="$slots.footer" class="flex justify-end gap-2 border-t border-stone-200 px-4 py-3">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
