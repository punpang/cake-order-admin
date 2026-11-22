<script setup>
import { orderNo } from '../../lib/format'
import SectionTabs from '../../components/SectionTabs.vue'
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import { fbConnectCall, FB_ERRORS } from '../../lib/fbRemote'
import { db, findOrder, saveNotifyRule, clearOutbox, fillTemplate, connectIntegration, disconnectIntegration, sendIntegrationTest } from '../../data/store'
import { CHANNELS, CUSTOMER_CHANNEL_ORDER, NOTIFY_EVENTS, NOTIFY_VARS, channelLabel } from '../../lib/constants'
import { askConfirm } from '../../lib/confirm'
import { dateTime } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// การเชื่อมต่อ & แจ้งเตือน (จำลอง): ยังไม่ส่งจริง ทุกข้อความบันทึกลง "คิวข้อความ" · แผนต่อจริงดู docs/integrations.md
const customerRules = computed(() => db.notifyRules.filter((r) => NOTIFY_EVENTS[r.event]?.audience === 'customer'))
const teamRules = computed(() => db.notifyRules.filter((r) => NOTIFY_EVENTS[r.event]?.audience === 'team'))
const customerChannels = CUSTOMER_CHANNEL_ORDER

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
  ยอดที่ชำระ: '600.00 ฿', ชำระแล้ว: '600.00 ฿', ข้อความรับสินค้า: 'สามารถรับสินค้าได้แล้ว แต่ต้องไม่เกินเวลาร้านปิด 20:00 น.', เวลาปิดร้าน: '20:00', ข้อความขอใช้ภาพ: 'ขออนุญาตนำภาพสินค้าของออร์เดอร์นี้ไปใช้เผยแพร่ หากไม่ยินยอมสามารถแจ้งได้เลยค่ะ', ลิงก์ออร์เดอร์: 'https://…/#/o/xxxx',
  วันนัด: '03-11-2569', เวลานัด: '14:00', ส่งมอบ: 'รับ', ชื่อวันเกิด: 'แม่', คะแนน: '40',
}
const preview = computed(() => fillTemplate(form.template, sampleVars))
function saveTpl() {
  const r = db.notifyRules.find((x) => x.event === form.event)
  saveNotifyRule(form.event, { ...r, template: form.template })
  open.value = false
}

// คิวข้อความ
async function clear() {
  if (await askConfirm({ title: 'ล้างคิวข้อความ', message: `${db.outbox.length} รายการ`, okText: 'ล้าง', danger: true })) clearOutbox()
}
const showAll = ref(false)
// แท็บของหน้า: ช่องทาง · แจ้งลูกค้า · แจ้งทีม · คิวข้อความ
const tab = ref('channels')
const outbox = computed(() => (showAll.value ? db.outbox : db.outbox.slice(0, 20)))

// ---------- เชื่อมบัญชี ----------
// Facebook: คลิกเดียว (Login → เลือกเพจ)
const CONNECTABLE = ['facebook']
const SAMPLE_PAGES = [
  { id: '104512345678901', name: db.shop.name },
  { id: '104598765432109', name: `${db.shop.name} สาขา 2` },
]
const FB_STEPS = ['ขอสิทธิ์รับ-ส่งข้อความของเพจ', 'สมัครรับ webhook ของเพจ', 'ทดสอบรับข้อความ']
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const conn = reactive({ key: '', stage: 'start', pageId: '', done: 0, error: '', nonce: '', pages: [], note: '' })
// โหมด Supabase: Facebook เชื่อมจริงด้วย OAuth (fb-connect) · token เก็บฝั่งเซิร์ฟเวอร์ ไม่ผ่านหน้าเว็บ
const fbReal = supabaseEnabled
const fbPages = computed(() => (fbReal ? conn.pages : SAMPLE_PAGES))
function openConnect(k) {
  Object.assign(conn, { key: k, stage: 'start', pageId: SAMPLE_PAGES[0].id, done: 0, error: '', nonce: '', pages: [], note: '' })
  if (k === 'facebook' && fbReal) conn.pageId = ''
}
const closeConnect = () => (conn.key = '')
const connSteps = computed(() => FB_STEPS)
async function fbLogin() {
  if (fbReal) {
    conn.error = ''
    conn.stage = 'login'
    const r = await fbConnectCall(await getSupabase(), 'start')
    if (r.error || !r.url) { conn.stage = 'start'; return (conn.error = r.error || 'เริ่มเชื่อมไม่สำเร็จ') }
    window.location.href = r.url // ไปหน้าอนุญาตของ Facebook แล้วกลับมาเลือกเพจ
    return
  }
  conn.stage = 'login'
  await wait(700)
  conn.stage = 'pick'
}
async function runConnect() {
  conn.error = ''
  if (conn.key === 'facebook' && fbReal) {
    if (!conn.pageId) return (conn.error = 'เลือกเพจก่อน')
    conn.stage = 'steps'
    conn.done = 0
    const r = await fbConnectCall(await getSupabase(), 'select', { nonce: conn.nonce, pageId: conn.pageId })
    if (r.error || !r.ok) { conn.stage = 'pick'; return (conn.error = r.error || 'เชื่อมไม่สำเร็จ') }
    conn.done = FB_STEPS.length
    connectIntegration('facebook', { accountName: r.page.name, accountId: r.page.id })
    conn.stage = 'done'
    return
  }
  conn.stage = 'steps'
  conn.done = 0
  for (let i = 0; i < connSteps.value.length; i++) {
    await wait(600)
    conn.done = i + 1
  }
  const pg = SAMPLE_PAGES.find((x) => x.id === conn.pageId)
  connectIntegration(conn.key, { accountName: pg.name, accountId: pg.id, tokenHint: '' })
  conn.stage = 'done'
}
// ---------- Telegram ----------
// ไม่มีฟอร์มกรอก token/chat id ในหน้านี้: ค่าตั้งที่ Supabase secrets และสถานะถูกตั้งอัตโนมัติ (ดูหน้า /admin/settings/sms สำหรับ SMS)
const SIMPLE = ['telegram']
const testRes = reactive({ key: '', text: '', error: '' })
function runTest(k) {
  const r = sendIntegrationTest(k)
  Object.assign(testRes, { key: k, text: r.ok ? `ส่งทดสอบแล้ว → ${r.to}: ${r.text}` : '', error: r.error || '' })
}
const EXTRA_EVENT = { test: 'ข้อความทดสอบ', bot_handoff: 'บอทส่งต่อพนักงาน' }
// กลับจากหน้าอนุญาตของ Facebook (?fb=choose&n=… | ?fb=error&m=…)
const route = useRoute()
onMounted(async () => {
  const q = route.query
  if (!fbReal || !q.fb) return
  // ล้างพารามิเตอร์ออกจาก URL โดยไม่ให้ router โหลดหน้าใหม่ (หน้านี้ผูก key กับ fullPath จะรีเซ็ตโมดัล)
  window.history.replaceState(null, '', `${location.pathname}${location.search}#${route.path}`)
  openConnect('facebook')
  if (q.fb === 'error') {
    let extra = '' // รหัสวินิจฉัยจากเซิร์ฟเวอร์ (จำนวนเพจ/สถานะ/สิทธิ์ที่ได้รับ · ไม่มี token)
    try {
      const d = JSON.parse(atob(String(q.d || '').replace(/-/g, '+').replace(/_/g, '/')))
      extra = ` (เพจที่ได้ ${Number(d.a) || 0} · มี token ${Number(d.t) || 0} · เพจที่เลือกไว้ ${Number(d.g) || 0} · HTTP ${Number(d.s) || 0} · สิทธิ์ที่ได้รับ: ${Array.isArray(d.p) && d.p.length ? d.p.map((x) => String(x).slice(0, 40)).join(', ') : 'ไม่มี'}${d.ty ? ` · token ${String(d.ty).slice(0, 20)}${d.v === 0 ? ' (ไม่ถูกต้อง)' : ''}` : ''}${Array.isArray(d.e) && d.e.length ? ` · ผลดึงเพจ [สถานะ,code,sub]: ${d.e.slice(0, 8).map((x) => '[' + [].concat(x).slice(0, 3).map((n) => Number(n) || 0).join(',') + ']').join(' ')}` : ''}${d.m ? ` · ข้อความจาก Facebook: ${String(d.m).slice(0, 150)}` : ''})`
    } catch { /* ไม่มีรหัสวินิจฉัย */ }
    return (conn.error = (FB_ERRORS[q.m] || 'เชื่อม Facebook ไม่สำเร็จ') + extra)
  }
  if (q.fb === 'choose' && /^[0-9a-f]{48}$/.test(String(q.n || ''))) {
    conn.stage = 'login'
    const r = await fbConnectCall(await getSupabase(), 'pages', { nonce: String(q.n) })
    if (r.error) { conn.stage = 'start'; return (conn.error = r.error) }
    conn.nonce = String(q.n)
    conn.pages = r.pages || []
    conn.pageId = conn.pages.length === 1 ? conn.pages[0].id : ''
    try { // เพจที่อนุญาตแล้วแต่ดึงไม่ได้ (จากรหัสวินิจฉัย ไม่มี token)
      const d = q.d ? JSON.parse(atob(String(q.d).replace(/-/g, '+').replace(/_/g, '/'))) : null
      const x = Array.isArray(d?.x) ? d.x.slice(0, 10).map((v) => String(v).replace(/\D/g, '').slice(0, 30)) : []
      if (x.length) conn.note = `อนุญาตแล้วแต่ดึงไม่ได้ ${x.length} เพจ (ID: ${x.join(', ')}${Array.isArray(d.e) && d.e.length ? ` · [สถานะ,code,sub]: ${d.e.slice(0, 8).map((v) => '[' + [].concat(v).slice(0, 3).map((n) => Number(n) || 0).join(',') + ']').join(' ')}` : ''}${d.m ? ` · ข้อความจาก Facebook: ${String(d.m).slice(0, 150)}` : ''})`
    } catch { /* ไม่มีรหัสวินิจฉัย */ }
    conn.stage = 'pick'
  }
})
async function disconnect(k) {
  if (k === 'facebook' && fbReal) {
    if (!(await askConfirm({ title: 'ยกเลิกการเชื่อม Facebook Page', message: `${db.integrations[k].accountName} · แชทใหม่จากช่องทางนี้จะไม่เข้ามา`, okText: 'ยกเลิกการเชื่อม', danger: true }))) return
    const r = await fbConnectCall(await getSupabase(), 'disconnect')
    if (!r.ok) return Object.assign(testRes, { key: k, text: '', error: r.error || 'ยกเลิกการเชื่อมไม่สำเร็จ' })
    return disconnectIntegration(k)
  }
  if (await askConfirm({ title: `ยกเลิกการเชื่อม ${CHANNELS[k].label}`, message: `${db.integrations[k].accountName} · แชทใหม่จากช่องทางนี้จะไม่เข้ามา`, okText: 'ยกเลิกการเชื่อม', danger: true })) disconnectIntegration(k)
}
</script>

<template>
  <ManageShell narrow title="การเชื่อมต่อ & แจ้งเตือน" subtitle="ตั้งค่าช่องทางและดูคิวข้อความ" :toolbar="false">
    <p class="mb-4 flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
      <AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" />
      ยังไม่ได้ต่อเซิร์ฟเวอร์ ข้อความทั้งหมดถูกบันทึกลง แท็บ "คิวข้อความ"เพื่อดูว่าจะส่งอะไรถึงใคร · ต่อจริงทีหลังพร้อม Supabase (token เก็บที่เซิร์ฟเวอร์ ไม่กรอกในหน้านี้)
    </p>

    <SectionTabs v-model="tab" :tabs="[{ key: 'channels', label: 'ช่องทาง' }, { key: 'customer', label: 'แจ้งลูกค้า' }, { key: 'team', label: 'แจ้งทีม' }, { key: 'outbox', label: 'คิวข้อความ', badge: db.outbox.length }]" />

    <!-- ช่องทาง -->
    <div v-show="tab === 'channels'" class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <section v-for="(c, k) in CHANNELS" :key="k" class="card">
        <div class="mb-1 flex items-center justify-between gap-2">
          <span class="font-semibold text-stone-900">{{ c.label }}</span>
          <AppSwitch v-model="db.integrations[k].enabled" :aria-label="`เปิดใช้ช่องทาง ${c.label}`" />
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
          <button v-else type="button" class="btn-primary mt-3 h-10 w-full" @click="openConnect(k)">เชื่อม Facebook</button>
        </template>
        <template v-else-if="k === 'sms'">
          <div class="mt-3 space-y-2 text-xs text-stone-500">
            <p v-if="db.integrations.sms.status === 'connected'">เชื่อมผ่านเกตเวย์ของร้านแล้ว (ตั้งค่าที่เซิร์ฟเวอร์)</p>
            <p v-else>ยังไม่พร้อม: ตั้ง secret <code>SMS_API_KEY</code> ที่ Supabase</p>
            <RouterLink to="/admin/settings/sms" class="btn-primary inline-flex h-10 w-full items-center justify-center">ไปหน้า SMS Gateway</RouterLink>
          </div>
        </template>
        <template v-else-if="SIMPLE.includes(k)">
          <div class="mt-3 space-y-2">
            <button type="button" class="btn-soft h-9 px-3 text-sm" @click="runTest(k)">ส่งข้อความทดสอบ</button>
            <p v-if="testRes.key === k && testRes.text" class="rounded-lg bg-emerald-50 p-2 text-xs text-emerald-800">{{ testRes.text }}</p>
            <p v-if="testRes.key === k && testRes.error" class="text-xs text-rose-700">{{ testRes.error }}</p>
          </div>
        </template>
      </section>
    </div>

    <!-- กฎแจ้งเตือน -->
    <section v-show="tab === 'customer'" class="card mb-4">
      <div class="card-title">แจ้งลูกค้า</div>
      <p class="mb-2 rounded-lg bg-brand-50 px-3 py-2 text-xs text-stone-600">ช่องทางที่ตั้งไว้ตรงนี้คือ <b>ค่าของระบบ</b> · ถ้าตั้งช่องทางที่ข้อมูลลูกค้า หรือที่หน้าออร์เดอร์ จะใช้ค่านั้นก่อน (ออร์เดอร์ &gt; ลูกค้า &gt; ระบบ)</p>
      <p class="mb-3 text-xs text-stone-500">ส่งทางช่องทางแรกที่ลูกค้ามีข้อมูล ตามลำดับ Facebook → SMS · ข้อความทาง Facebook จะขึ้นในศูนย์รวมแชทด้วย (เลือกช่องทางที่อนุญาตในแต่ละเหตุการณ์)</p>
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
            <button type="button" class="btn-outline h-9 shrink-0 px-3" :aria-label="`แก้ข้อความ ${NOTIFY_EVENTS[r.event].label}`" @click="edit(r)"><AppIcon name="edit" :size="14" /></button>
            <AppSwitch :model-value="r.enabled" :aria-label="`เปิดใช้กฎ ${NOTIFY_EVENTS[r.event].label || r.event}`" @update:model-value="setEnabled(r, $event)" />
          </div>
          <div class="mt-2 flex flex-wrap gap-1.5">
            <button v-for="ch in customerChannels" :key="ch" type="button" class="chip" :class="r.channels.includes(ch) ? 'chip-on' : 'chip-off'" @click="toggleChannel(r, ch)">{{ channelLabel(ch) }}</button>
          </div>
        </li>
      </ul>
    </section>

    <section v-show="tab === 'team'" class="card mb-4">
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
          <button type="button" class="btn-outline h-9 shrink-0 px-3" :aria-label="`แก้ข้อความ ${NOTIFY_EVENTS[r.event].label}`" @click="edit(r)"><AppIcon name="edit" :size="14" /></button>
          <AppSwitch :model-value="r.enabled" :aria-label="`เปิดใช้กฎ ${NOTIFY_EVENTS[r.event].label}`" @update:model-value="setEnabled(r, $event)" />
        </li>
      </ul>
    </section>

    <!-- คิวข้อความ -->
    <section v-show="tab === 'outbox'" class="card">
      <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div class="text-[15px] font-semibold text-stone-900">คิวข้อความ <span class="text-sm font-normal text-stone-400">{{ db.outbox.length }}</span></div>
        <div class="flex flex-wrap items-center gap-2">
          <button type="button" class="btn-outline h-9 px-3" :disabled="!db.outbox.length" @click="clear">ล้าง</button>
        </div>
      </div>
      <p v-if="!db.outbox.length" class="rounded-xl bg-stone-50 p-4 text-center text-sm text-stone-500">ยังไม่มีข้อความ</p>
      <ul class="space-y-2">
        <li v-for="m in outbox" :key="m.id" class="rounded-xl border border-stone-200 p-3">
          <div class="flex flex-wrap items-center gap-1.5 text-xs">
            <span class="rounded-full px-2 py-0.5 font-semibold" :class="m.channel ? 'bg-brand-50 text-brand-800' : 'bg-rose-50 text-rose-700'">{{ m.channel ? channelLabel(m.channel) : 'ไม่มีช่องทาง' }}</span>
            <span class="text-stone-600">{{ NOTIFY_EVENTS[m.event]?.label || EXTRA_EVENT[m.event] }}</span>
            <span v-if="m.status === 'sent'" class="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700">ส่งแล้ว</span>
            <span v-else-if="m.status === 'sending'" class="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">กำลังส่ง</span>
            <span v-else-if="m.status === 'failed'" class="rounded-full bg-rose-50 px-2 py-0.5 font-semibold text-rose-700" :title="m.error">ส่งไม่สำเร็จ</span>
            <span class="ml-auto text-stone-400">{{ dateTime(m.at) }}</span>
          </div>
          <div class="mt-1 text-xs text-stone-500">
            ถึง {{ m.to }}
            <RouterLink v-if="m.orderId && findOrder(m.orderId)" :to="`/admin/orders/${m.orderId}`" class="ml-1 text-brand-700 underline">{{ orderNo(findOrder(m.orderId).code) }}</RouterLink>
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
    <AppModal v-if="conn.key" :title="'เชื่อม Facebook Page'" @close="closeConnect">
      <p v-if="conn.error && conn.key === 'facebook'" class="mb-3 flex items-center gap-2 rounded-xl bg-rose-50 p-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ conn.error }}</p>
      <!-- Facebook -->
      <template v-if="conn.key === 'facebook'">
        <div v-if="conn.stage === 'start' || conn.stage === 'login'" class="space-y-3 text-sm text-stone-600">
          <p>เข้าสู่ระบบด้วยบัญชีที่เป็นแอดมินเพจ แล้วเลือกเพจที่ต้องการให้แชทเข้ามาที่ศูนย์รวมแชท</p>
          <button type="button" class="btn-primary h-11 w-full" :disabled="conn.stage === 'login'" @click="fbLogin">{{ conn.stage === 'login' ? 'กำลังเข้าสู่ระบบ…' : 'เข้าสู่ระบบด้วย Facebook' }}</button>
        </div>
        <div v-else-if="conn.stage === 'pick'" class="space-y-2">
          <div class="label">เลือกเพจ</div>
          <label v-for="pg in fbPages" :key="pg.id" class="flex cursor-pointer items-center gap-3 rounded-xl border p-3" :class="conn.pageId === pg.id ? 'border-brand-400 bg-brand-50' : 'border-stone-200'">
            <input v-model="conn.pageId" type="radio" :value="pg.id" />
            <span class="font-medium text-stone-900">{{ pg.name }}</span>
          </label>
          <p v-if="conn.note" class="break-words text-xs text-stone-500">{{ conn.note }}</p>
        </div>
      </template>
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
          <button v-if="conn.stage === 'pick'" class="btn-primary flex-1 sm:flex-none" @click="runConnect">เชื่อมต่อ</button>
        </template>
      </template>
    </AppModal>
  </ManageShell>
</template>
