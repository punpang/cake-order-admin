<script setup>
import { ref, watch } from 'vue'

// ช่องเวลา 24 ชม. (ชั่วโมง : นาที) ไม่ขึ้นกับภาษาของเบราว์เซอร์ · ค่า = 'HH:MM' หรือ '' (ว่าง)
const model = defineModel({ type: String, default: '' })
defineProps({ label: { type: String, default: 'เวลา' } })
const parse = (v) => { const m = /^(\d{1,2}):(\d{2})/.exec(v || ''); return m ? { h: m[1].padStart(2, '0'), n: m[2] } : { h: '', n: '' } }
const part = ref(parse(model.value))
const build = (p) => (p.h !== '' ? `${p.h}:${p.n || '00'}` : '')
watch(model, (v) => { if (v !== build(part.value)) part.value = parse(v) })
function set(k, v) {
  const p = { ...part.value, [k]: v }
  if (k === 'h' && v === '') p.n = ''
  if (k === 'h' && v !== '' && !p.n) p.n = '00'
  part.value = p
  const out = build(p)
  if (out !== model.value) model.value = out
}
const two = (i) => String(i).padStart(2, '0')
</script>

<template>
  <div class="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5" role="group" :aria-label="label">
    <select class="input px-2" :value="part.h" :aria-label="`${label} ชั่วโมง`" @change="set('h', $event.target.value)">
      <option value="">--</option>
      <option v-for="i in 24" :key="i" :value="two(i - 1)">{{ two(i - 1) }}</option>
    </select>
    <span class="text-stone-500">:</span>
    <select class="input px-2" :value="part.n" :disabled="part.h === ''" :aria-label="`${label} นาที`" @change="set('n', $event.target.value)">
      <option v-if="part.h === ''" value="">--</option>
      <option v-for="i in 60" :key="i" :value="two(i - 1)">{{ two(i - 1) }}</option>
    </select>
  </div>
</template>
