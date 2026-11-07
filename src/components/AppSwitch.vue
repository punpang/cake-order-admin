<script setup>
defineProps({ label: { type: String, default: '' }, ariaLabel: { type: String, default: '' } })
const on = defineModel({ type: Boolean, default: false })
</script>

<template>
  <button
    type="button"
    role="switch"
    :aria-checked="on"
    :aria-label="label ? undefined : ariaLabel || undefined"
    class="inline-flex items-center gap-2.5 text-sm text-stone-700"
    @click="on = !on"
  >
    <span class="relative h-6 w-11 shrink-0 rounded-full transition" :class="on ? 'bg-brand-600' : 'bg-stone-300'">
      <span class="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition" :class="on ? 'translate-x-5' : ''" />
    </span>
    <span v-if="label">{{ label }}</span>
  </button>
</template>
