<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { PROVINCES, composeAddress, postalWarning } from '../lib/thaiAddress'

// ช่องที่อยู่ใบกำกับภาษี: กรอกแยกช่อง (ประกอบเป็นข้อความเดียว) หรือพิมพ์เอง + ชิปคัดลอกที่อยู่ที่มีอยู่ · v-model = สตริงที่อยู่
const props = defineProps({
  modelValue: { type: String, default: '' },
  label: { type: String, default: 'ที่อยู่ใบกำกับ' },
  suggestions: { type: Array, default: () => [] }, // [{ label, text }]
})
const emit = defineEmits(['update:modelValue'])
const mode = ref(String(props.modelValue || '').trim() ? 'text' : 'parts')
const p = reactive({ no: '', road: '', sub: '', dist: '', prov: '', zip: '' })
// ค่าถูกเปลี่ยนจากภายนอก (เช่น โหลดข้อมูลเดิม/กดชิป) ที่ไม่ใช่ที่ประกอบจากช่อง → สลับเป็นโหมดพิมพ์เอง
watch(() => props.modelValue, (v) => { if (mode.value === 'parts' && String(v || '').trim() && v !== composeAddress(p)) mode.value = 'text' })
const warn = computed(() => (mode.value === 'parts' ? postalWarning(p) : ''))
const chips = computed(() => props.suggestions.filter((s) => String(s?.text || '').trim()))
function upd() { emit('update:modelValue', composeAddress(p)) }
function setText(t) { emit('update:modelValue', String(t || '').slice(0, 300)) }
function useChip(s) { mode.value = 'text'; setText(s.text) }
function toParts() { Object.assign(p, { no: '', road: '', sub: '', dist: '', prov: '', zip: '' }); mode.value = 'parts'; emit('update:modelValue', '') }
const onZip = (e) => { p.zip = e.target.value.replace(/\D/g, '').slice(0, 5); upd() }
</script>

<template>
  <div class="space-y-2">
    <div v-if="chips.length" class="flex flex-wrap gap-1.5" aria-label="ใช้ที่อยู่ที่มีอยู่">
      <button v-for="s in chips" :key="s.label" type="button" class="rounded-full border border-stone-200 bg-white px-3 py-1 text-xs text-stone-700 hover:border-brand-300" :aria-label="`ใช้ ${s.label}`" @click="useChip(s)">{{ s.label }}</button>
    </div>
    <template v-if="mode === 'parts'">
      <div class="grid grid-cols-2 gap-2">
        <input v-model="p.no" class="input col-span-2" maxlength="80" placeholder="เลขที่ / หมู่ / อาคาร / ชั้น" aria-label="ที่อยู่: เลขที่" @input="upd" />
        <input v-model="p.road" class="input col-span-2" maxlength="80" placeholder="ถนน / ซอย" aria-label="ที่อยู่: ถนน ซอย" @input="upd" />
        <input v-model="p.sub" class="input" maxlength="60" :placeholder="p.prov === 'กรุงเทพมหานคร' ? 'แขวง' : 'ตำบล'" aria-label="ที่อยู่: แขวง ตำบล" @input="upd" />
        <input v-model="p.dist" class="input" maxlength="60" :placeholder="p.prov === 'กรุงเทพมหานคร' ? 'เขต' : 'อำเภอ'" aria-label="ที่อยู่: เขต อำเภอ" @input="upd" />
        <select v-model="p.prov" class="input" aria-label="ที่อยู่: จังหวัด" @change="upd"><option value="">จังหวัด</option><option v-for="x in PROVINCES" :key="x" :value="x">{{ x }}</option></select>
        <input :value="p.zip" class="input" inputmode="numeric" maxlength="5" placeholder="รหัสไปรษณีย์" aria-label="ที่อยู่: รหัสไปรษณีย์" @input="onZip" />
      </div>
      <p v-if="warn" class="text-xs text-warning-700" role="note">{{ warn }}</p>
      <p v-if="modelValue" class="rounded-lg bg-stone-50 p-2 text-xs text-stone-600" aria-label="ตัวอย่างที่อยู่ที่จะแสดงบนใบ">{{ modelValue }}</p>
      <button type="button" class="text-xs text-brand-700 underline" @click="mode = 'text'">พิมพ์ที่อยู่เอง</button>
    </template>
    <template v-else>
      <textarea :value="modelValue" rows="2" maxlength="300" class="input" :aria-label="label" @input="setText($event.target.value)" />
      <button type="button" class="text-xs text-brand-700 underline" @click="toParts">ล้างแล้วกรอกแยกช่อง (เลขที่ ถนน จังหวัด รหัสไปรษณีย์)</button>
    </template>
  </div>
</template>
