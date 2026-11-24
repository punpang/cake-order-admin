<script setup>
import { computed, ref, watch } from 'vue'

// ช่องวันที่แบบไทย: วัน · เดือน · ปี พ.ศ. (ไม่ขึ้นกับภาษาของเบราว์เซอร์) · ค่า = 'YYYY-MM-DD' (ค.ศ.) หรือ '' (ว่าง)
const model = defineModel({ type: String, default: '' })
// min/max = 'YYYY-MM-DD' (เลือกเกินแล้วปรับเป็นขอบ) · past/future = จำนวนปีที่ให้เลือกย้อนหลัง/ล่วงหน้า
const props = defineProps({ label: { type: String, default: 'วันที่' }, min: { type: String, default: '' }, max: { type: String, default: '' }, past: { type: Number, default: 1 }, future: { type: Number, default: 6 } })
const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.']
const parse = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v || ''); return m ? { y: +m[1], m: +m[2], d: +m[3] } : { y: 0, m: 0, d: 0 } }
const part = ref(parse(model.value))
watch(model, (v) => { if (v !== build(part.value)) part.value = parse(v) })
const dim = (y, m) => new Date(y || 2024, m || 1, 0).getDate()
const build = (p) => (p.y && p.m && p.d ? `${String(p.y).padStart(4, '0')}-${String(p.m).padStart(2, '0')}-${String(Math.min(p.d, dim(p.y, p.m))).padStart(2, '0')}` : '')
function set(k, v) {
  const p = { ...part.value, [k]: Number(v) || 0 }
  if (p.y && p.m && p.d > dim(p.y, p.m)) p.d = dim(p.y, p.m)
  let out = build(p)
  if (out && props.min && out < props.min) out = props.min
  if (out && props.max && out > props.max) out = props.max
  part.value = out ? parse(out) : p
  if (out !== model.value) model.value = out
}
const days = computed(() => Array.from({ length: dim(part.value.y, part.value.m) }, (_, i) => i + 1))
const years = computed(() => {
  const now = new Date().getFullYear()
  const list = []
  for (let y = now - props.past; y <= now + props.future; y++) list.push(y)
  if (part.value.y && !list.includes(part.value.y)) list.push(part.value.y)
  return list.sort((a, b) => a - b)
})
</script>

<template>
  <div class="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_minmax(0,1.3fr)] gap-2" role="group" :aria-label="label">
    <select class="input pr-8 text-ellipsis" :value="part.d || ''" :aria-label="`${label} วัน`" @change="set('d', $event.target.value)">
      <option value="">วัน</option>
      <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
    </select>
    <select class="input pr-8 text-ellipsis" :value="part.m || ''" :aria-label="`${label} เดือน`" @change="set('m', $event.target.value)">
      <option value="">เดือน</option>
      <option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option>
    </select>
    <select class="input pr-8 text-ellipsis" :value="part.y || ''" :aria-label="`${label} ปี พ.ศ.`" @change="set('y', $event.target.value)">
      <option value="">ปี (พ.ศ.)</option>
      <option v-for="y in years" :key="y" :value="y">{{ y + 543 }}</option>
    </select>
  </div>
</template>

