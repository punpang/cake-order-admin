<script setup>
import { STATUS } from '../lib/constants'
defineProps({ status: { type: String, required: true } })
</script>

<template>
  <span class="inline-block whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium" :class="STATUS[status]?.cls">
    {{ STATUS[status]?.label || status }}
  </span>
</template>
