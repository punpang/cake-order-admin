<script setup>
import { STATUS } from '../lib/constants'
defineProps({ status: { type: String, required: true } })
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap" :class="STATUS[status]?.cls">
    <span class="h-1.5 w-1.5 rounded-full" :class="STATUS[status]?.dot" />
    {{ STATUS[status]?.label || status }}
  </span>
</template>
