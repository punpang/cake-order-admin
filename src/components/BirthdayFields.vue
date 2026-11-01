<script setup>
import { computed } from 'vue'
import { MONTHS, daysInMonth } from '../lib/birthday'

// v-model = { name, day, month }
const model = defineModel({ type: Object, required: true })
const days = computed(() => Array.from({ length: model.value.month ? daysInMonth(model.value.month) : 31 }, (_, i) => i + 1))
</script>

<template>
  <div class="space-y-3">
    <div><label class="label">เจ้าของวันเกิด</label><input v-model="model.name" class="input" placeholder="เช่น แม่, น้องมิว" /></div>
    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class="label">วัน</label>
        <select v-model.number="model.day" class="input">
          <option value="">-</option>
          <option v-for="d in days" :key="d" :value="d">{{ d }}</option>
        </select>
      </div>
      <div>
        <label class="label">เดือน</label>
        <select v-model.number="model.month" class="input">
          <option value="">-</option>
          <option v-for="(m, i) in MONTHS" :key="m" :value="i + 1">{{ m }}</option>
        </select>
      </div>
    </div>
  </div>
</template>
