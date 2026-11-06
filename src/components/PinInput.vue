<script setup>
// ช่อง PIN 6 หลัก: ตัวเลขเท่านั้น (แป้นตัวเลข) ซ่อนตัวอักษร · v-model เก็บตัวเลขล้วน
const model = defineModel({ type: String, default: '' })
defineProps({ placeholder: { type: String, default: '••••••' }, autocomplete: { type: String, default: 'current-password' } })
function onInput(e) {
  const d = e.target.value.replace(/\D/g, '').slice(0, 6)
  model.value = d
  e.target.value = d
}
</script>

<template>
  <input :value="model" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="6" :autocomplete="autocomplete" :placeholder="placeholder" class="input text-center tracking-[0.5em]" @input="onInput" />
</template>
