<script setup>
import { reactive, ref } from 'vue'
import { db, RETENTION_CATS, saveRetentionSettings } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// จัดการข้อมูลที่อาจเป็นขยะในฐานข้อมูล: เลือกหมวด กำหนดจำนวนวัน แล้วระบบลบเองทุกวัน (งานตอน 10:30 เวลาไทย)
const form = reactive(Object.fromEntries(RETENTION_CATS.map((c) => [c.key, { enabled: db.retention?.[c.key]?.enabled ?? c.def.enabled, days: db.retention?.[c.key]?.days ?? c.def.days }])))
const msg = ref('')
const err = ref('')
function save() {
  msg.value = err.value = ''
  const r = saveRetentionSettings(form)
  if (r.error) return (err.value = r.error)
  msg.value = 'บันทึกแล้ว · มีผลกับการลบรอบถัดไป'
}
</script>

<template>
  <ManageShell narrow guard title="จัดการข้อมูลที่เป็นขยะ" subtitle="เลือกหมวดที่จะลบอัตโนมัติ และจำนวนวันที่เก็บไว้">
    <section class="card space-y-4">
      <p class="text-xs text-stone-500">ข้อมูลที่เก่ากว่าจำนวนวันที่ตั้งไว้จะถูกลบอัตโนมัติทุกวัน หมวดที่ปิดไว้จะไม่ถูกแตะ · ข้อมูลออร์เดอร์ ลูกค้า และรายการขายไม่อยู่ในรายการนี้</p>

      <div v-for="c in RETENTION_CATS" :key="c.key" class="rounded-xl border border-stone-200 p-3">
        <div class="flex items-start justify-between gap-3">
          <div class="text-sm font-medium text-stone-900">{{ c.label }}</div>
          <AppSwitch v-model="form[c.key].enabled" />
        </div>
        <div class="mt-2 flex items-center gap-2 text-sm" :class="form[c.key].enabled ? '' : 'opacity-50'">
          <span class="text-stone-600">เก็บไว้</span>
          <input v-model.number="form[c.key].days" type="number" min="1" max="3650" step="1" class="input h-9 w-24" :disabled="!form[c.key].enabled" />
          <span class="text-stone-600">วัน</span>
        </div>
      </div>

      <p v-if="err" class="text-sm text-rose-600">{{ err }}</p>
      <p v-if="msg" class="text-sm text-emerald-700">{{ msg }}</p>
      <button class="btn-primary" @click="save">บันทึก</button>
    </section>
  </ManageShell>
</template>
