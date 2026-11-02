<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findOrder, saveNotifyRule, runScheduledChecks, clearOutbox, fillTemplate } from '../../data/store'
import { CHANNELS, NOTIFY_EVENTS, NOTIFY_VARS } from '../../lib/constants'
import { askConfirm } from '../../lib/confirm'
import { dateTime } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// การเชื่อมต่อ & แจ้งเตือน (จำลอง): ยังไม่ส่งจริง ทุกข้อความบันทึกลง "คิวข้อความ" · แผนต่อจริงดู docs/integrations.md
const customerRules = computed(() => db.notifyRules.filter((r) => NOTIFY_EVENTS[r.event]?.audience === 'customer'))
const teamRules = computed(() => db.notifyRules.filter((r) => NOTIFY_EVENTS[r.event]?.audience === 'team'))
const customerChannels = Object.keys(CHANNELS).filter((k) => CHANNELS[k].audience === 'customer')

function toggleChannel(r, ch) {
  const channels = r.channels.includes(ch) ? r.channels.filter((x) => x !== ch) : [...r.channels, ch]
  saveNotifyRule(r.event, { ...r, channels })
}
const setEnabled = (r, v) => saveNotifyRule(r.event, { ...r, enabled: v })

// แก้ข้อความ
const open = ref(false)
const form = reactive({ event: '', template: '' })
const field = ref(null)
function edit(r) {
  Object.assign(form, { event: r.event, template: r.template })
  open.value = true
}
function insertVar(v) {
  const el = field.value
  const at = el ? el.selectionStart : form.template.length
  form.template = form.template.slice(0, at) + v + form.template.slice(el ? el.selectionEnd : at)
}
const sampleVars = {
  ชื่อลูกค้า: 'คุณมะลิ ใจดี', เลขออร์เดอร์: 'OR-0001', ยอดรวม: '1,410.00 ฿', คงค้าง: '810.00 ฿', ยอดที่แจ้ง: '600.00 ฿',
  วันนัด: '03-11-2569', เวลานัด: '14:00', ส่งมอบ: 'รับ', ชื่อวันเกิด: 'แม่', คะแนน: '40',
}
const preview = computed(() => fillTemplate(form.template, sampleVars))
function saveTpl() {
  const r = db.notifyRules.find((x) => x.event === form.event)
  saveNotifyRule(form.event, { ...r, template: form.template })
  open.value = false
}

// คิวข้อความ
const scanMsg = ref('')
function scan() {
  const n = runScheduledChecks()
  scanMsg.value = n ? `เพิ่ม ${n} ข้อความ` : 'ไม่มีข้อความใหม่'
}
async function clear() {
  if (await askConfirm({ title: 'ล้างคิวข้อความ', message: `${db.outbox.length} รายการ`, okText: 'ล้าง', danger: true })) clearOutbox()
}
const showAll = ref(false)
const outbox = computed(() => (showAll.value ? db.outbox : db.outbox.slice(0, 20)))
</script>

<template>
  <ManageShell title="การเชื่อมต่อ & แจ้งเตือน" subtitle="จำลอง · ยังไม่ส่งข้อความจริง" :toolbar="false">
    <p class="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
      <AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" />
      ยังไม่ได้ต่อเซิร์ฟเวอร์ ข้อความทั้งหมดถูกบันทึกลง "คิวข้อความ" ด้านล่างเพื่อดูว่าจะส่งอะไรถึงใคร · ต่อจริงทีหลังพร้อม Supabase (token เก็บที่เซิร์ฟเวอร์ ไม่กรอกในหน้านี้)
    </p>

    <!-- ช่องทาง -->
    <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <section v-for="(c, k) in CHANNELS" :key="k" class="card">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="font-semibold text-stone-900">{{ c.label }}</span>
          <AppSwitch v-model="db.integrations[k].enabled" />
        </div>
        <div class="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span v-if="c.local" class="rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">ใช้งานในเว็บ (จำลองในเครื่อง)</span>
          <span v-else class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">ยังไม่เชื่อมต่อ (รอต่อเซิร์ฟเวอร์)</span>
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">{{ c.audience === 'team' ? 'แจ้งทีมภายใน' : 'ส่งลูกค้า' }}</span>
        </div>
        <p class="text-xs text-stone-500">{{ c.prep }}</p>
      </section>
    </div>

    <!-- กฎแจ้งเตือน -->
    <section class="card mb-4">
      <div class="card-title">แจ้งลูกค้า</div>
      <p class="mb-3 text-xs text-stone-500">ส่งทางช่องทางแรกที่ลูกค้ามีข้อมูล ตามลำดับ แชทในเว็บ → LINE → Facebook → SMS (เลือกช่องทางที่อนุญาตในแต่ละเหตุการณ์)</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="r in customerRules" :key="r.event" class="py-3" :class="r.enabled ? '' : 'opacity-60'">
          <div class="flex items-center gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-1.5">
                <span class="font-medium text-stone-900">{{ NOTIFY_EVENTS[r.event].label }}</span>
                <span v-if="NOTIFY_EVENTS[r.event].scheduled" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ตามเวลา</span>
                <span v-if="NOTIFY_EVENTS[r.event].marketing" class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">เฉพาะคนรับข่าว</span>
              </div>
              <div class="mt-0.5 truncate text-xs text-stone-500">{{ r.template }}</div>
            </div>
            <button type="button" class="btn-outline h-9 shrink-0 px-3" @click="edit(r)"><AppIcon name="edit" :size="14" /></button>
            <AppSwitch :model-value="r.enabled" @update:model-value="setEnabled(r, $event)" />
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="ch in customerChannels" :key="ch" type="button" class="chip" :class="r.channels.includes(ch) ? 'chip-on' : 'chip-off'" @click="toggleChannel(r, ch)">{{ CHANNELS[ch].label }}</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card mb-4">
      <div class="card-title">แจ้งทีมภายใน (Telegram)</div>
      <ul class="divide-y divide-stone-100">
        <li v-for="r in teamRules" :key="r.event" class="flex items-center gap-3 py-3" :class="r.enabled ? '' : 'opacity-60'">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-medium text-stone-900">{{ NOTIFY_EVENTS[r.event].label }}</span>
              <span v-if="NOTIFY_EVENTS[r.event].scheduled" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ตามเวลา</span>
            </div>
            <div class="mt-0.5 truncate text-xs text-stone-500">{{ r.template }}</div>
          </div>
          <button type="button" class="btn-outline h-9 shrink-0 px-3" @click="edit(r)"><AppIcon name="edit" :size="14" /></button>
          <AppSwitch :model-value="r.enabled" @update:model-value="setEnabled(r, $event)" />
        </li>
      </ul>
    </section>

    <!-- คิวข้อความ -->
    <section class="card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">คิวข้อความ (จำลอง) <span class="text-sm font-normal text-stone-400">{{ db.outbox.length }}</span></div>
        <div class="flex flex-wrap items-center gap-2">
          <span v-if="scanMsg" class="text-xs text-stone-500">{{ scanMsg }}</span>
          <button type="button" class="btn-soft h-9 px-3" @click="scan"><AppIcon name="clock" :size="16" /> จำลองรอบตรวจเวลา</button>
          <button type="button" class="btn-outline h-9 px-3" :disabled="!db.outbox.length" @click="clear">ล้าง</button>
        </div>
      </div>
      <p class="mb-3 text-xs text-stone-500">รอบตรวจเวลา = เตือนนัดรับ 24 ชม., งานใกล้เวลา 2 ชม., วันเกิด, คะแนนใกล้หมดอายุ (ของจริงจะตรวจอัตโนมัติ)</p>
      <p v-if="!db.outbox.length" class="rounded-xl bg-stone-50 p-4 text-center text-sm text-stone-500">ยังไม่มีข้อความ</p>
      <ul class="space-y-2">
        <li v-for="m in outbox" :key="m.id" class="rounded-xl border border-stone-200 p-3">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="rounded-full px-2 py-0.5 font-semibold" :class="m.channel ? 'bg-brand-50 text-brand-800' : 'bg-rose-50 text-rose-600'">{{ m.channel ? CHANNELS[m.channel].label : 'ไม่มีช่องทาง' }}</span>
            <span class="text-stone-600">{{ NOTIFY_EVENTS[m.event]?.label }}</span>
            <span class="ml-auto text-stone-400">{{ dateTime(m.at) }}</span>
          </div>
          <div class="mt-1 text-xs text-stone-500">
            ถึง {{ m.to }}
            <RouterLink v-if="m.orderId && findOrder(m.orderId)" :to="`/orders/${m.orderId}`" class="ml-1 text-brand-700 underline">{{ findOrder(m.orderId).code }}</RouterLink>
          </div>
          <div class="mt-1.5 text-sm break-words whitespace-pre-line text-stone-800">{{ m.text }}</div>
        </li>
      </ul>
      <button v-if="db.outbox.length > 20" type="button" class="btn-soft mt-3 w-full" @click="showAll = !showAll">{{ showAll ? 'แสดงน้อยลง' : `แสดงทั้งหมด ${db.outbox.length}` }}</button>
    </section>

    <!-- modal แก้ข้อความ -->
    <AppModal v-if="open" :title="`ข้อความ: ${NOTIFY_EVENTS[form.event]?.label}`" @close="open = false">
      <div class="space-y-4">
        <div>
          <label class="label">ข้อความ</label>
          <textarea ref="field" v-model="form.template" rows="4" class="input" />
        </div>
        <div>
          <div class="label">แทรกข้อมูล</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="v in NOTIFY_VARS" :key="v" type="button" class="chip chip-off" @click="insertVar(v)">{{ v.slice(1, -1) }}</button>
          </div>
        </div>
        <div>
          <div class="label">ตัวอย่าง</div>
          <div class="rounded-xl bg-stone-50 p-3 text-sm break-words whitespace-pre-line text-stone-800">{{ preview }}</div>
          <p class="mt-1 text-xs text-stone-400">{{ preview.length }} ตัวอักษร · SMS ภาษาไทย 70 ตัวอักษรต่อ 1 ข้อความ</p>
        </div>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!form.template.trim()" @click="saveTpl">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
