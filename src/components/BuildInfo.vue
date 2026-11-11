<script setup>
import { APP_VERSION, APP_COMMIT, builtAtLabel } from '../lib/buildInfo'
</script>

<template>
  <p class="mt-8 border-t border-stone-200 pt-3 text-center text-xs text-stone-400">
    เวอร์ชัน {{ APP_VERSION }} · build {{ APP_COMMIT }} · สร้างเมื่อ {{ builtAtLabel() }}
  </p>
</template>
