<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { db, saveRetentionSettings } from '../../data/store'
import {
  RETENTION_CATS, RETENTION_PRESETS, RETENTION_MAX_DAYS, defaultRetention, normalizeRetention, validateRetention,
  retentionRisks, retentionEqual, retentionCutoff, fetchRetentionCount, fetchLastRetentionRun,
} from '../../lib/retention'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import { dateOnly, dateTime } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import { useLeaveGuard } from '../../lib/leaveGuard'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// จัดการข้อมูลที่อาจเป็นขยะ: เลือกหมวด กำหนดจำนวนวัน แล้วฐานข้อมูลลบเองทุกวัน 10:30 เวลาไทย (ฟังก์ชัน punpang_run_retention)
// หน้านี้แก้เฉพาะ "ค่าที่ตั้ง" ไม่ได้สั่งลบเอง · การเปลี่ยนที่ทำให้ลบมากขึ้นต้องยืนยันก่อนบันทึก
const saved = computed(() => normalizeRetention(db.retention))
const form = reactive(normalizeRetention(db.retention))
const errors = computed(() => validateRetention(form))
const dirty = computed(() => !retentionEqual(saved.value, form))
const isDefault = computed(() => retentionEqual(defaultRetention(), form))
const onCount = computed(() => RETENTION_CATS.filter((c) => form[c.key].enabled).length)
const changed = (key) => saved.value[key].enabled !== form[key].enabled || Number(saved.value[key].days) !== Number(form[key].days)
useLeaveGuard(() => dirty.value)

const msg = ref('')
const err = ref('')
const clearNote = () => { msg.value = err.value = '' }

// ---------- จำนวนรายการจริงในฐานข้อมูล (เฉพาะหมวดที่นับได้) ----------
const counts = reactive({}) // key → { total, due } | 'loading' | 'error'
const timers = {}
async function loadCount(key) {
  if (!supabaseEnabled || errors.value[key]) return
  const days = Number(form[key].days)
  counts[key] = 'loading'
  try {
    const r = await fetchRetentionCount(await getSupabase(), key, days)
    if (Number(form[key].days) !== days) return // ค่าถูกแก้ระหว่างรอ ใช้ผลของคำขอล่าสุดเท่านั้น
    if (r) counts[key] = r
    else delete counts[key]
  } catch {
    counts[key] = 'error'
  }
}
function onDays(key) {
  clearNote()
  clearTimeout(timers[key])
  timers[key] = setTimeout(() => loadCount(key), 500)
}
function setDays(key, n) {
  form[key].days = n
  onDays(key)
}
onBeforeUnmount(() => Object.values(timers).forEach(clearTimeout))

// ---------- ผลการลบรอบล่าสุด ----------
const lastRun = ref(undefined) // undefined = กำลังโหลด/ไม่มีฐานข้อมูล · null = ยังไม่เคยทำงาน
const lastRunErr = ref(false)
async function loadLastRun() {
  if (!supabaseEnabled) return
  try { lastRun.value = await fetchLastRetentionRun(await getSupabase()) } catch { lastRunErr.value = true }
}
const lastRunTotal = computed(() => Object.values(lastRun.value?.deleted || {}).reduce((a, b) => a + (Number(b) || 0), 0))
const lastRunOf = (key) => lastRun.value?.deleted?.[key]

onMounted(() => {
  loadLastRun()
  for (const c of RETENTION_CATS) loadCount(c.key)
})

// ---------- บันทึก ----------
function reset() {
  Object.assign(form, normalizeRetention(db.retention))
  clearNote()
  for (const c of RETENTION_CATS) loadCount(c.key)
}
function useDefaults() {
  Object.assign(form, defaultRetention())
  clearNote()
  for (const c of RETENTION_CATS) loadCount(c.key)
}
const riskLine = (r) => {
  const n = counts[r.key]?.due
  const due = typeof n === 'number' ? ` (ตอนนี้เข้าเกณฑ์ ${n.toLocaleString('en-US')} รายการ)` : ''
  return r.kind === 'enable' ? `• เปิดลบ "${r.title}" ที่เก่ากว่า ${r.days} วัน${due}` : `• "${r.title}" ลดจาก ${r.from} เหลือ ${r.days} วัน${due}`
}
const saving = ref(false)
async function save() {
  clearNote()
  const bad = RETENTION_CATS.find((c) => errors.value[c.key])
  if (bad) return (err.value = `${bad.title}: ${errors.value[bad.key]}`)
  if (saving.value) return
  saving.value = true
  try {
    const risks = retentionRisks(saved.value, form)
    if (risks.length) {
      const ok = await askConfirm({
        title: 'ยืนยันการลบข้อมูลมากขึ้น',
        message: `${risks.map(riskLine).join('\n')}\n\nข้อมูลที่ลบแล้วกู้คืนไม่ได้ · เริ่มลบในรอบถัดไป (ทุกวัน 10:30 น.)`,
        okText: 'ยืนยันและบันทึก',
        danger: true,
      })
      if (!ok) return
    }
    const r = saveRetentionSettings(form)
    if (r.error) return (err.value = r.error)
    Object.assign(form, normalizeRetention(db.retention))
    msg.value = 'บันทึกแล้ว · มีผลตั้งแต่รอบลบถัดไป'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <ManageShell narrow :toolbar="false" title="จัดการข้อมูลที่เป็นขยะ" subtitle="ลบข้อมูลชั่วคราวที่เก่าเกินกำหนดโดยอัตโนมัติ">
    <!-- ภาพรวม -->
    <section class="card mb-4">
      <div class="flex items-start gap-3">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon name="clock" :size="22" /></span>
        <div class="min-w-0 flex-1">
          <h2 class="font-semibold text-stone-900">ลบอัตโนมัติทุกวัน เวลา 10:30 น.</h2>
          <p class="mt-0.5 text-sm text-stone-600">เปิดอยู่ {{ onCount }} จาก {{ RETENTION_CATS.length }} หมวด · หมวดที่ปิดไว้จะไม่ถูกลบ</p>
          <p v-if="supabaseEnabled" class="mt-1 text-xs text-stone-500" aria-live="polite">
            <template v-if="lastRunErr">ดูผลรอบล่าสุดไม่ได้ในขณะนี้</template>
            <template v-else-if="lastRun === undefined">กำลังดูผลรอบล่าสุด…</template>
            <template v-else-if="lastRun === null">ยังไม่เคยทำงาน · รอบแรกจะเริ่มเวลา 10:30 น.</template>
            <template v-else>รอบล่าสุด {{ dateTime(lastRun.at) }} · ลบไป {{ lastRunTotal.toLocaleString('en-US') }} รายการ</template>
          </p>
        </div>
      </div>
      <div class="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
        <AppIcon name="shield" :size="16" class="mt-0.5 shrink-0" />
        <span>ออร์เดอร์ ลูกค้า การชำระเงิน รายการขาย และข้อความแชท <b>ไม่อยู่ในรายการนี้</b> และจะไม่ถูกลบจากหน้านี้</span>
      </div>
    </section>

    <!-- หมวด -->
    <ul class="grid gap-3 lg:grid-cols-2">
      <li
        v-for="c in RETENTION_CATS"
        :key="c.key"
        class="card flex flex-col gap-3 transition"
        :class="[form[c.key].enabled ? 'border-brand-200' : 'bg-stone-50/60', changed(c.key) ? 'ring-2 ring-amber-200' : '']"
      >
        <div class="flex items-start gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" :class="form[c.key].enabled ? 'bg-brand-50 text-brand-600' : 'bg-stone-100 text-stone-400'"><AppIcon :name="c.icon" :size="20" /></span>
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 :id="`rt-${c.key}`" class="text-[15px] font-semibold text-stone-900">{{ c.title }}</h3>
              <span class="rounded-full px-2 py-0.5 text-[11px] font-semibold" :class="form[c.key].enabled ? 'bg-rose-50 text-rose-700' : 'bg-stone-100 text-stone-500'">{{ form[c.key].enabled ? 'ลบอัตโนมัติ' : 'ไม่ลบ' }}</span>
              <span v-if="changed(c.key)" class="text-xs font-medium text-amber-700">ยังไม่บันทึก</span>
            </div>
          </div>
          <AppSwitch v-model="form[c.key].enabled" :aria-label="`ลบอัตโนมัติ: ${c.title}`" @update:model-value="clearNote" />
        </div>

        <dl class="space-y-1 text-xs leading-relaxed">
          <div class="flex gap-2"><dt class="w-12 shrink-0 font-semibold text-rose-700">ลบ</dt><dd class="text-stone-600">{{ c.removes }}</dd></div>
          <div class="flex gap-2"><dt class="w-12 shrink-0 font-semibold text-emerald-700">ไม่ลบ</dt><dd class="text-stone-600">{{ c.keeps }}</dd></div>
        </dl>

        <fieldset class="mt-auto rounded-xl bg-stone-50 p-3" :disabled="!form[c.key].enabled" :class="form[c.key].enabled ? '' : 'opacity-60'">
          <legend class="sr-only">ระยะเวลาเก็บ {{ c.title }}</legend>
          <div class="flex flex-wrap items-center gap-2">
            <label :for="`rd-${c.key}`" class="text-sm font-medium text-stone-700">เก็บไว้</label>
            <input
              :id="`rd-${c.key}`"
              v-model.number="form[c.key].days"
              type="number"
              inputmode="numeric"
              :min="c.min"
              :max="RETENTION_MAX_DAYS"
              step="1"
              class="input h-10 w-24 bg-white text-center"
              :class="errors[c.key] ? 'border-rose-400 focus:border-rose-400 focus:ring-rose-100' : ''"
              :aria-invalid="!!errors[c.key]"
              :aria-describedby="`rh-${c.key}`"
              @input="onDays(c.key)"
            />
            <span class="text-sm text-stone-700">วัน</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5" role="group" :aria-label="`เลือกจำนวนวันของ ${c.title}`">
            <button
              v-for="n in RETENTION_PRESETS.filter((x) => x >= c.min)"
              :key="n"
              type="button"
              class="h-8 rounded-full border px-3 text-xs font-medium transition"
              :class="Number(form[c.key].days) === n ? 'border-brand-500 bg-brand-600 text-white' : 'border-stone-200 bg-white text-stone-700 hover:bg-stone-100'"
              :aria-pressed="Number(form[c.key].days) === n"
              @click="setDays(c.key, n)"
            >{{ n === 365 ? '1 ปี' : `${n} วัน` }}</button>
          </div>
          <p :id="`rh-${c.key}`" class="mt-2 text-xs" :class="errors[c.key] ? 'font-medium text-rose-600' : 'text-stone-500'" aria-live="polite">
            <template v-if="errors[c.key]">{{ errors[c.key] }} (ตั้งได้ {{ c.min }}–{{ RETENTION_MAX_DAYS.toLocaleString('en-US') }} วัน)</template>
            <template v-else-if="form[c.key].enabled">จะลบรายการที่เก่ากว่าวันที่ {{ dateOnly(retentionCutoff(form[c.key].days).toISOString()) }}</template>
            <template v-else>ปิดอยู่ · ไม่มีการลบในหมวดนี้</template>
          </p>
        </fieldset>

        <p v-if="supabaseEnabled && c.timeField" class="text-xs text-stone-500" aria-live="polite">
          <template v-if="counts[c.key] === 'loading'">กำลังนับจำนวน…</template>
          <template v-else-if="counts[c.key] === 'error'">นับจำนวนไม่ได้ <button type="button" class="font-medium text-brand-700 underline" @click="loadCount(c.key)">ลองใหม่</button></template>
          <template v-else-if="counts[c.key]">
            มีอยู่ {{ counts[c.key].total.toLocaleString('en-US') }} รายการ ·
            <b :class="counts[c.key].due && form[c.key].enabled ? 'text-rose-700' : 'text-stone-700'">{{ counts[c.key].due.toLocaleString('en-US') }} รายการ</b>
            {{ form[c.key].enabled ? 'จะถูกลบในรอบถัดไป' : 'เข้าเกณฑ์ถ้าเปิดใช้' }}
          </template>
          <template v-if="typeof lastRunOf(c.key) === 'number'"> · รอบล่าสุดลบ {{ lastRunOf(c.key).toLocaleString('en-US') }}</template>
        </p>
        <p v-else-if="supabaseEnabled && typeof lastRunOf(c.key) === 'number'" class="text-xs text-stone-500">รอบล่าสุดล้างลิงก์ใน {{ lastRunOf(c.key).toLocaleString('en-US') }} แชท</p>
      </li>
    </ul>

    <!-- แถบบันทึก -->
    <div class="sticky bottom-[calc(env(safe-area-inset-bottom)+5.25rem)] z-10 mt-4 md:bottom-3 rounded-2xl border border-stone-200 bg-white/95 p-3 shadow-lg backdrop-blur">
      <p v-if="err" class="mb-2 text-sm font-medium text-rose-600" role="alert">{{ err }}</p>
      <p v-else-if="msg" class="mb-2 text-sm font-medium text-emerald-700" role="status">{{ msg }}</p>
      <div class="flex flex-wrap items-center justify-end gap-2">
        <p v-if="dirty || !msg" class="w-full text-sm sm:w-auto sm:flex-1" :class="dirty ? 'font-medium text-amber-700' : 'text-stone-500'">{{ dirty ? 'มีการแก้ไขที่ยังไม่บันทึก' : 'ไม่มีการแก้ไข' }}</p>
        <button v-if="!isDefault" type="button" class="btn-outline h-10 px-3" @click="useDefaults">ใช้ค่าเริ่มต้น</button>
        <button v-if="dirty" type="button" class="btn-outline h-10 px-3" @click="reset">ยกเลิกการแก้ไข</button>
        <button type="button" class="btn-primary h-10" :disabled="!dirty || saving" @click="save">บันทึก</button>
      </div>
    </div>
  </ManageShell>
</template>
