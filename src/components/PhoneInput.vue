<script setup>
import { computed } from 'vue'
import { formatPhone, phoneDigits } from '../lib/format'

// ช่องเบอร์โทร: กรอกได้เฉพาะตัวเลข (แป้นตัวเลข) แสดง xxx-xxx-xxxx · v-model เก็บตัวเลขล้วน
const model = defineModel({ type: String, default: '' })
const shown = computed(() => formatPhone(model.value))
function onInput(e) {
  const d = phoneDigits(e.target.value)
  model.value = d
  e.target.value = formatPhone(d)
}
</script>

<template>
  <input :value="shown" type="tel" inputmode="numeric" autocomplete="tel" maxlength="12" placeholder="0xx-xxx-xxxx" class="input" @input="onInput" />
</template>
