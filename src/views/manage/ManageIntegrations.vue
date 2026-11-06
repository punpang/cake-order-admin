<script setup>
import { computed, reactive, ref } from 'vue'
import { db, findOrder, saveNotifyRule, runScheduledChecks, clearOutbox, fillTemplate, connectIntegration, disconnectIntegration } from '../../data/store'
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

// ---------- เชื่อมบัญชี (จำลอง) ----------
// Facebook: คลิกเดียว (Login → เลือกเพจ) · LINE OA: วาง token ครั้งเดียว แล้วระบบตั้ง webhook + ทดสอบให้
// ไม่เก็บ token จริงในหน้าเว็บ เก็บแค่ 4 ตัวท้ายไว้แสดง (ของจริงส่งไปเก็บที่เซิร์ฟเวอร์)
const CONNECTABLE = ['facebook', 'line']
const SAMPLE_PAGES = [
  { id: '104512345678901', name: db.shop.name },
  { id: '104598765432109', name: `${db.shop.name} สาขา 2` },
]
const FB_STEPS = ['ขอสิทธิ์รับ-ส่งข้อความของเพจ', 'สมัครรับ webhook ของเพจ', 'ทดสอบรับข้อความ']
const LINE_STEPS = ['ตรวจ Channel access token', 'ตั้ง Webhook URL อัตโนมัติ', 'ทดสอบ webhook']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const conn = reactive({ key: '', stage: 'start', pageId: '', token: '', secret: '', done: 0, error: '' })
function openConnect(k) {
  Object.assign(conn, { key: k, stage: 'start', pageId: SAMPLE_PAGES[0].id, token: '', secret: '', done: 0, error: '' })
}
const closeConnect = () => (conn.key = '')
const connSteps = computed(() => (conn.key === 'facebook' ? FB_STEPS : LINE_STEPS))
async function fbLogin() {
  conn.stage = 'login'
  await wait(700)
  conn.stage = 'pick'
}
async function runConnect() {
  conn.error = ''
  if (conn.key === 'line' && conn.token.trim().length < 20) return (conn.error = 'Channel access token สั้นเกินไป ตรวจสอบอีกครั้ง')
  if (conn.key === 'line' && !conn.secret.trim()) return (conn.error = 'กรอก Channel secret')
  conn.stage = 'steps'
  conn.done = 0
  for (let i = 0; i < connSteps.value.length; i++) {
    await wait(600)
    conn.done = i + 1
  }
  const info =
    conn.key === 'facebook'
      ? (() => {
          const pg = SAMPLE_PAGES.find((x) => x.id === conn.pageId)
          return { accountName: pg.name, accountId: pg.id, tokenHint: '' }
        })()
      : { accountName: '@bannkhanom', accountId: 'U' + conn.token.trim().slice(-8), tokenHint: conn.token.trim().slice(-4) }
  connectIntegration(conn.key, info)
  conn.token = ''
  conn.secret = ''
  conn.stage = 'done'
}
async function disconnect(k) {
  if (await askConfirm({ title: `ยกเลิกการเชื่อม ${CHANNELS[k].label}`, message: `${db.integrations[k].accountName} · แชทใหม่จากช่องทางนี้จะไม่เข้ามา`, okText: 'ยกเลิกการเชื่อม', danger: true })) disconnectIntegration(k)
}
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
          <span v-if="db.integrations[k].status === 'connected'" class="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">เชื่อมแล้ว · {{ db.integrations[k].accountName }}</span>
          <span v-else class="rounded-full bg-stone-100 px-2 py-0.5 text-stone-600">{{ CONNECTABLE.includes(k) ? 'ยังไม่เชื่อม' : 'ยังไม่เชื่อมต่อ (รอต่อเซิร์ฟเวอร์)' }}</span>
          <span class="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">{{ c.audience === 'team' ? 'แจ้งทีมภายใน' : 'ส่งลูกค้า' }}</span>
        </div>
        <p class="text-xs text-stone-500">{{ c.prep }}</p>
        <template v-if="CONNECTABLE.includes(k)">
          <div v-if="db.integrations[k].status === 'connected'" class="mt-3 flex flex-wrap items-center gap-2">
            <span class="text-xs text-stone-500">เมื่อ {{ dateTime(db.integrations[k].connectedAt) }}<template v-if="db.integrations[k].tokenHint"> · token ••••{{ db.integrations[k].tokenHint }}</template></span>
            <button type="button" class="btn-outline ml-auto h-9 px-3 text-sm" @click="disconnect(k)">ยกเลิกการเชื่อม</button>
          </div>
          <button v-else type="button" class="btn-primary mt-3 h-10 w-full" @click="openConnect(k)">{{ k === 'facebook' ? 'เชื่อม Facebook' : 'เชื่อม LINE OA' }}</button>
        </template>
      </section>
    </div>

    <!-- กฎแจ้งเตือน -->
    <section class="card mb-4">
      <div class="card-title">แจ้งลูกค้า</div>
      <p class="mb-3 text-xs text-stone-500">ส่งทางช่องทางแรกที่ลูกค้ามีข้อมูล ตามลำดับ LINE → Facebook → SMS · ข้อความทาง LINE/Facebook จะขึ้นในศูนย์รวมแชทด้วย (เลือกช่องทางที่อนุญาตในแต่ละเหตุการณ์)</p>
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
            <RouterLink v-if="m.orderId && findOrder(m.orderId)" :to="`/admin/orders/${m.orderId}`" class="ml-1 text-brand-700 underline">{{ findOrder(m.orderId).code }}</RouterLink>
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

    <!-- modal เชื่อมบัญชี -->
    <AppModal v-if="conn.key" :title="conn.key === 'facebook' ? 'เชื่อม Facebook Page' : 'เชื่อม LINE OA'" @close="closeConnect">
      <p class="mb-3 rounded-xl bg-amber-50 p-2 text-xs text-amber-800">จำลองขั้นตอน · ต่อจริงเมื่อมีเซิร์ฟเวอร์ (Supabase)</p>
      <!-- Facebook -->
      <template v-if="conn.key === 'facebook'">
        <div v-if="conn.stage === 'start' || conn.stage === 'login'" class="space-y-3 text-sm text-stone-600">
          <p>เข้าสู่ระบบด้วยบัญชีที่เป็นแอดมินเพจ แล้วเลือกเพจที่ต้องการให้แชทเข้ามาที่ศูนย์รวมแชท</p>
          <button type="button" class="btn-primary h-11 w-full" :disabled="conn.stage === 'login'" @click="fbLogin">{{ conn.stage === 'login' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วย Facebook' }}</button>
        </div>
        <div v-else-if="conn.stage === 'pick'" class="space-y-2">
          <div class="label">เลือกเพจ</div>
          <label v-for="pg in SAMPLE_PAGES" :key="pg.id" class="flex cursor-pointer items-center gap-3 rounded-xl border p-3" :class="conn.pageId === pg.id ? 'border-brand-400 bg-brand-50' : 'border-stone-200'">
            <input v-model="conn.pageId" type="radio" :value="pg.id" />
            <span class="font-medium text-stone-900">{{ pg.name }}</span>
          </label>
        </div>
      </template>
      <!-- LINE -->
      <div v-else-if="conn.stage === 'start'" class="space-y-3">
        <p class="text-sm text-stone-600">
          คัดลอกจาก <a href="https://developers.line.biz/console/" target="_blank" rel="noopener" class="text-brand-700 underline">LINE Developers Console</a> → เลือก Channel (Messaging API) · วางครั้งเดียว ระบบตั้ง Webhook และทดสอบให้อัตโนมัติ
        </p>
        <div>
          <label class="label">Channel access token (long-lived)</label>
          <input v-model="conn.token" type="password" class="input" autocomplete="off" />
        </div>
        <div>
          <label class="label">Channel secret</label>
          <input v-model="conn.secret" type="password" class="input" autocomplete="off" />
        </div>
        <p v-if="conn.error" class="text-sm text-rose-600">{{ conn.error }}</p>
      </div>
      <!-- ขั้นตอนเชื่อม -->
      <ul v-if="conn.stage === 'steps' || conn.stage === 'done'" class="space-y-2">
        <li v-for="(t, i) in connSteps" :key="t" class="flex items-center gap-2 text-sm" :class="i < conn.done ? 'text-emerald-700' : 'text-stone-400'">
          <AppIcon :name="i < conn.done ? 'check' : 'clock'" :size="16" /> {{ t }}
        </li>
      </ul>
      <p v-if="conn.stage === 'done'" class="mt-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-700">เชื่อมแล้ว · {{ db.integrations[conn.key].accountName }}</p>
      <template #footer>
        <button v-if="conn.stage === 'done'" class="btn-primary flex-1 sm:flex-none" @click="closeConnect">เสร็จ</button>
        <template v-else>
          <button class="btn-outline flex-1 sm:flex-none" :disabled="conn.stage === 'steps'" @click="closeConnect">ยกเลิก</button>
          <button v-if="conn.key === 'facebook' ? conn.stage === 'pick' : conn.stage === 'start'" class="btn-primary flex-1 sm:flex-none" @click="runConnect">เชื่อมต่อ</button>
        </template>
      </template>
    </AppModal>
  </ManageShell>
</template>
