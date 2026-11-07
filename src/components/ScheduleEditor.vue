<script setup>
import { DAYS, describeSchedule } from '../lib/posPromo'
import ThaiDateField from './ThaiDateField.vue'
import ThaiTimeField from './ThaiTimeField.vue'

// ช่วงเวลาของโปร: วันเริ่ม–สิ้นสุด · วันในสัปดาห์ (ไม่เลือก = ทุกวัน) · เวลาเริ่ม–สิ้นสุด (ว่าง = ทั้งวัน ข้ามเที่ยงคืนได้)
const s = defineModel({ type: Object, required: true })
const toggleDay = (d) => (s.value.days = s.value.days.includes(d) ? s.value.days.filter((x) => x !== d) : [...s.value.days, d])
</script>

<template>
  <div class="space-y-3 rounded-xl border border-stone-200 p-3">
    <div class="grid grid-cols-2 gap-3">
      <div><div class="label">วันเริ่ม</div><ThaiDateField v-model="s.from" label="วันเริ่ม" /></div>
      <div><div class="label">วันสิ้นสุด</div><ThaiDateField v-model="s.to" label="วันสิ้นสุด" /></div>
    </div>
    <div>
      <div class="label">วันในสัปดาห์ <span class="font-normal text-stone-400">(ไม่เลือก = ทุกวัน)</span></div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="(d, i) in DAYS" :key="i" type="button" class="chip" :class="s.days.includes(i) ? 'chip-on' : 'chip-off'" @click="toggleDay(i)">{{ d }}</button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><div class="label">เวลาเริ่ม</div><ThaiTimeField v-model="s.timeFrom" label="เวลาเริ่ม" /></div>
      <div><div class="label">เวลาสิ้นสุด</div><ThaiTimeField v-model="s.timeTo" label="เวลาสิ้นสุด" /></div>
    </div>
    <p class="text-xs text-stone-500">ใช้เมื่อ: {{ describeSchedule(s) }} · เว้นว่าง = ไม่จำกัด</p>
  </div>
</template>
