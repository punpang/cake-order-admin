<script setup>
import { DAYS, describeSchedule } from '../lib/posPromo'

// ช่วงเวลาของโปร: วันเริ่ม–สิ้นสุด · วันในสัปดาห์ (ไม่เลือก = ทุกวัน) · เวลาเริ่ม–สิ้นสุด (ว่าง = ทั้งวัน ข้ามเที่ยงคืนได้)
const s = defineModel({ type: Object, required: true })
const toggleDay = (d) => (s.value.days = s.value.days.includes(d) ? s.value.days.filter((x) => x !== d) : [...s.value.days, d])
</script>

<template>
  <div class="space-y-3 rounded-xl border border-stone-200 p-3">
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">วันเริ่ม</label><input v-model="s.from" type="date" class="input" /></div>
      <div><label class="label">วันสิ้นสุด</label><input v-model="s.to" type="date" :min="s.from" class="input" /></div>
    </div>
    <div>
      <div class="label">วันในสัปดาห์ <span class="font-normal text-stone-400">(ไม่เลือก = ทุกวัน)</span></div>
      <div class="flex flex-wrap gap-1.5">
        <button v-for="(d, i) in DAYS" :key="i" type="button" class="chip" :class="s.days.includes(i) ? 'chip-on' : 'chip-off'" @click="toggleDay(i)">{{ d }}</button>
      </div>
    </div>
    <div class="grid grid-cols-2 gap-3">
      <div><label class="label">เวลาเริ่ม</label><input v-model="s.timeFrom" type="time" class="input" /></div>
      <div><label class="label">เวลาสิ้นสุด</label><input v-model="s.timeTo" type="time" class="input" /></div>
    </div>
    <p class="text-xs text-stone-500">ใช้เมื่อ: {{ describeSchedule(s) }} · เว้นว่าง = ไม่จำกัด</p>
  </div>
</template>
