<script setup>
// โหมดทดสอบ (แอดมิน): เปิด/ปิดต่อเครื่องนี้ · ล้างข้อมูลทดสอบ · รายชื่อผู้รับที่ส่งจริงได้ในโหมดทดสอบ (SMS / Telegram / Facebook)
// เปิดแล้วระบบโหลดใหม่ไปใช้สำเนาข้อมูลทดสอบบนฐานข้อมูลเดียวกัน · ข้อมูลจริงไม่ถูกแตะ
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { getSupabase, supabaseEnabled } from '../../lib/supabase'
import { readTestMode, writeTestMode } from '../../lib/testMode'
import { askConfirm } from '../../lib/confirm'
import { RECIPIENT_CHANNEL_LABEL, addRecipients, recipientsOfCustomer } from '../../lib/testRecipients'
import { MEMBER_SCAN_RE } from '../../lib/scan'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const CHANNELS = [
  { v: 'sms', l: 'SMS' },
  { v: 'telegram', l: 'Telegram' },
  { v: 'facebook', l: 'Facebook' },
]
const on = ref(readTestMode())
const msg = ref('')
const ok = ref(false)
const busy = ref(false)
const recipients = reactive([])

function say(text, good) {
  msg.value = text
  ok.value = good
}

async function loadRecipients() {
  if (!on.value || !supabaseEnabled) return
  const c = await getSupabase()
  if (!c) return
  const r = await c.from('punpang_records').select('data').eq('collection', 'testRecipients').eq('id', 'list').maybeSingle()
  const items = Array.isArray(r.data?.data?.items) ? r.data.data.items : []
  recipients.splice(0, recipients.length, ...items.map((x) => ({ channel: x.channel, to: String(x.to ?? ''), name: String(x.name ?? '') })))
}

// เปิด/ปิดโหมดทดสอบ: ต้องยืนยันก่อนเปิด แล้วโหลดหน้าใหม่ให้ทั้งแอปใช้สำเนาข้อมูลทดสอบ (หรือกลับข้อมูลจริง)
async function toggle(next) {
  if (!supabaseEnabled) return say('ยังไม่ได้เชื่อมฐานข้อมูล จึงเปิดโหมดทดสอบไม่ได้', false)
  if (next) {
    const yes = await askConfirm({
      title: 'เปิดโหมดทดสอบ?',
      message: 'ข้อมูลที่บันทึกในโหมดนี้จะไปอยู่ในสำเนาทดสอบ ไม่กระทบข้อมูลจริง เลขเอกสารขึ้นต้นด้วย TEST- · แอปจะโหลดใหม่',
      okText: 'เปิดโหมดทดสอบ',
    })
    if (!yes) return
  }
  writeTestMode(next)
  location.reload()
}

async function resetData() {
  const yes = await askConfirm({
    title: 'ล้างข้อมูลทดสอบทั้งหมด?',
    message: 'ลบออร์เดอร์ ลูกค้า การชำระ บัญชี และแชทในสำเนาทดสอบ แล้วใส่ชุดตัวอย่าง ~90 วันใหม่ · ข้อมูลจริงไม่ถูกลบ',
    okText: 'ล้างข้อมูลทดสอบ',
    danger: true,
  })
  if (!yes) return
  busy.value = true
  const c = await getSupabase()
  const r = c ? await c.rpc('punpang_reset_test_data') : { error: { message: 'ยังไม่ได้เชื่อมฐานข้อมูล' } }
  busy.value = false
  if (r.error) return say(`ล้างไม่สำเร็จ: ${r.error.message}`, false)
  newBotChat()
  say('ล้างข้อมูลทดสอบแล้ว และใส่ชุดตัวอย่าง ~90 วันใหม่แล้ว', true)
}

async function saveRecipients() {
  const items = recipients
    .map((x) => ({ channel: x.channel, to: String(x.to ?? '').trim(), ...(x.name ? { name: x.name } : {}) }))
    .filter((x) => x.to && CHANNELS.some((c) => c.v === x.channel))
  const c = await getSupabase()
  if (!c) return say('ยังไม่ได้เชื่อมฐานข้อมูล', false)
  const r = await c.from('punpang_records').upsert({ collection: 'testRecipients', id: 'list', data: { items } }, { onConflict: 'collection,id' })
  if (r.error) return say(`บันทึกไม่สำเร็จ: ${r.error.message}`, false)
  say(`บันทึกรายชื่อผู้รับทดสอบแล้ว ${items.length} รายการ`, true)
}

// ผู้รับ: เลือกจากลูกค้าจริง (SMS = เบอร์ · Facebook = PSID) · Telegram ยังพิมพ์รหัสกลุ่มเอง
const picking = ref(false)
const q = ref('')
const found = reactive([])
const pickBusy = ref(false)
const pickErr = ref('')
let searchSeq = 0
let searchTimer = 0

// อ่านรายชื่อลูกค้าจากฐานข้อมูลจริง (schema public) ไม่ใช่สำเนาทดสอบ · อ่านอย่างเดียว ไม่เขียนอะไรกลับ
async function searchCustomers() {
  const seq = ++searchSeq
  pickErr.value = ''
  const c = await getSupabase()
  if (!c) { found.splice(0, found.length); pickErr.value = 'ยังไม่ได้เชื่อมฐานข้อมูล'; return }
  const term = q.value.replace(/[,()*"\\%]/g, ' ').trim()
  pickBusy.value = true
  let query = c.schema('public').from('punpang_customers').select('id,name,phone,data').order('name').limit(30)
  // เบอร์ในฐานข้อมูลเก็บเป็นตัวเลขล้วน: ค้นเบอร์ด้วยตัวเลขที่พิมพ์ (ตัดขีด/ช่องว่าง) · ไม่มีตัวเลข = ค้นชื่ออย่างเดียว
  const digits = term.replace(/\D/g, '')
  if (MEMBER_SCAN_RE.test(term)) query = query.eq('data->>scanCode', term) // สแกนรหัสสมาชิก
  else if (term) query = query.or(digits ? `name.ilike.*${term}*,phone.ilike.*${digits}*` : `name.ilike.*${term}*`)
  const r = await query
  if (seq !== searchSeq) return
  pickBusy.value = false
  found.splice(0, found.length)
  if (r.error) { pickErr.value = `อ่านรายชื่อลูกค้าไม่ได้: ${r.error.message}`; return }
  found.push(...(r.data || []).filter((x) => !x.data?.deleted).map((x) => ({ id: x.id, name: x.name || '', phone: x.phone || '', fbPsid: x.data?.fbPsid || '' })))
}
function onSearchInput() {
  clearTimeout(searchTimer)
  searchTimer = setTimeout(searchCustomers, 250)
}
function openPicker() {
  picking.value = true
  searchCustomers()
}
function closePicker() {
  clearTimeout(searchTimer)
  picking.value = false
}
const channelsOf = (c) => recipientsOfCustomer(c).map((r) => RECIPIENT_CHANNEL_LABEL[r.channel])
function pickCustomer(c) {
  const rows = recipientsOfCustomer(c)
  const who = c.name || 'ลูกค้านี้'
  if (!rows.length) return say(`${who} ไม่มีเบอร์หรือ Facebook ที่ส่งทดสอบได้`, false)
  const r = addRecipients(recipients, rows)
  if (!r.added) return say(`${who} อยู่ในรายชื่อแล้ว`, false)
  recipients.splice(0, recipients.length, ...r.list)
  say(`เพิ่ม ${who} ${r.added} ช่องทางแล้ว · กดบันทึกเพื่อใช้จริง`, true)
}
function addTelegram() { recipients.push({ channel: 'telegram', to: '', name: '' }) }
function removeRecipient(i) { recipients.splice(i, 1) }
onBeforeUnmount(() => clearTimeout(searchTimer))

// ทดสอบบอท (AI): คุยเป็นลูกค้าทดสอบ · บอทตอบในแชททดสอบนี้เท่านั้น ไม่ส่งถึงลูกค้าจริง
const botText = ref('')
const botChatId = ref('')
const botBusy = ref(false)
const botErr = ref('')
const botLog = reactive([])

function newBotChat() {
  botChatId.value = ''
  botLog.splice(0, botLog.length)
  botErr.value = ''
}

async function askBot() {
  const text = botText.value.trim()
  if (!text || botBusy.value) return
  botBusy.value = true
  botErr.value = ''
  botLog.push({ from: 'customer', text })
  botText.value = ''
  try {
    const c = await getSupabase()
    if (!c) throw new Error('ยังไม่ได้เชื่อมฐานข้อมูล')
    const r = await c.functions.invoke('bot-test', { body: { text, chatId: botChatId.value || undefined } })
    if (r.error) {
      let m = 'ทดสอบบอทไม่สำเร็จ'
      try { const j = await r.error.context.json(); if (j?.error) m = j.error } catch { /* ใช้ข้อความทั่วไป */ }
      throw new Error(m)
    }
    const d = r.data || {}
    if (d.chatId) botChatId.value = d.chatId
    if (d.reply) botLog.push({ from: 'bot', text: d.reply, note: d.replySource === 'ai' ? 'ตอบโดย AI' : 'ตอบตามกติกาของบอท' })
    else if (d.draft) botLog.push({ from: 'bot', text: d.draft, note: 'เป็นร่างให้พนักงานกดส่ง ไม่ได้ส่งเอง' })
    else botLog.push({ from: 'note', text: d.handoff ? 'บอทส่งต่อให้พนักงาน' : d.note || 'บอทไม่ได้ตอบ', note: d.handoffReason || d.draftReason || '' })
  } catch (e) {
    botErr.value = e.message || 'ทดสอบบอทไม่สำเร็จ'
  } finally {
    botBusy.value = false
  }
}

onMounted(loadRecipients)
</script>

<template>
  <ManageShell title="โหมดทดสอบ" subtitle="ทดสอบบนฐานข้อมูลเดียวกัน · ข้อมูลแยกจากข้อมูลจริง" back="/admin/settings" narrow :toolbar="false">
    <div class="space-y-4">
      <section class="card space-y-3">
        <div class="card-title">สถานะ</div>
        <AppSwitch :model-value="on" label="โหมดทดสอบ (เฉพาะเครื่องนี้)" @update:model-value="toggle" />
        <p class="text-sm text-stone-600">เปิดแล้วทั้งแอปใช้สำเนาข้อมูลทดสอบ · เลขเอกสารขึ้นต้น TEST- · ข้อมูลจริงและยอดขายจริงไม่ถูกแก้ไข</p>
        <p v-if="!supabaseEnabled" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">ยังไม่ได้เชื่อมฐานข้อมูล จึงใช้โหมดทดสอบไม่ได้</p>
      </section>

      <section v-if="on" class="card space-y-3">
        <div class="card-title">ล้างข้อมูลทดสอบ</div>
        <p class="text-sm text-stone-600">ลบข้อมูลทดสอบทั้งหมดในเครื่องนี้ แต่ไม่แตะข้อมูลจริง</p>
        <button type="button" class="btn-danger h-12 w-full" :disabled="busy" @click="resetData"><AppIcon name="trash" :size="16" /> ล้างข้อมูลทดสอบ</button>
      </section>

      <section v-if="on" class="card space-y-3">
        <div class="card-title">ผู้รับที่ส่งจริงได้ในโหมดทดสอบ</div>
        <p class="text-sm text-stone-600">ในโหมดทดสอบส่งข้อความได้เฉพาะปลายทางในรายชื่อนี้ (เช่น เบอร์ของพนักงาน) ปลายทางอื่นจะถูกปฏิเสธ</p>
        <p class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">รายชื่อที่เลือกมาจากลูกค้าจริง · ข้อความทดสอบที่ส่งไปจะถึงลูกค้าคนนั้นจริง</p>
        <div v-for="(x, i) in recipients" :key="i" class="grid grid-cols-[7rem_1fr_auto] items-center gap-2">
          <span class="text-sm font-medium text-stone-700">{{ RECIPIENT_CHANNEL_LABEL[x.channel] || x.channel }}</span>
          <input v-if="x.channel === 'telegram'" v-model="x.to" class="input h-11" placeholder="รหัสกลุ่มหรือผู้รับ" :aria-label="`รหัส Telegram ของผู้รับที่ ${i + 1}`" />
          <div v-else class="min-w-0 truncate rounded-xl bg-stone-50 px-3 py-2.5 text-sm">{{ x.name ? `${x.name} · ` : '' }}{{ x.to }}</div>
          <button type="button" class="btn-outline h-11 w-11" :aria-label="`ลบผู้รับที่ ${i + 1}`" @click="removeRecipient(i)"><AppIcon name="trash" :size="15" /></button>
        </div>
        <div v-if="picking" class="space-y-2 rounded-xl border border-stone-200 p-3">
          <input v-model="q" class="input h-11 w-full" placeholder="ค้นหาชื่อหรือเบอร์ลูกค้า" aria-label="ค้นหาลูกค้า" @input="onSearchInput" />
          <p v-if="pickErr" class="text-sm text-rose-700" role="alert">{{ pickErr }}</p>
          <div class="max-h-72 space-y-1 overflow-y-auto" aria-live="polite">
            <button v-for="c in found" :key="c.id" type="button" class="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-stone-50 disabled:opacity-50" :disabled="!channelsOf(c).length" @click="pickCustomer(c)">
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium">{{ c.name || 'ไม่มีชื่อ' }}</span>
                <span class="block truncate text-xs text-stone-500">{{ c.phone || 'ไม่มีเบอร์' }}</span>
              </span>
              <span class="shrink-0 text-xs text-stone-600">{{ channelsOf(c).join(' · ') || 'ไม่มีช่องทาง' }}</span>
            </button>
            <p v-if="!found.length && !pickBusy && !pickErr" class="text-sm text-stone-500">ไม่พบลูกค้า</p>
          </div>
          <div class="flex gap-2">
            <button type="button" class="btn-outline h-10 px-3 text-sm" @click="addTelegram">+ Telegram</button>
            <button type="button" class="btn-soft h-10 flex-1 text-sm" @click="closePicker">เสร็จ</button>
          </div>
        </div>
        <div class="flex gap-2">
          <button type="button" class="btn-soft h-10 px-3 text-sm" :disabled="picking" @click="openPicker"><AppIcon name="plus" :size="15" /> เพิ่มผู้รับ</button>
          <button type="button" class="btn-primary h-10 flex-1" @click="saveRecipients">บันทึกผู้รับทดสอบ</button>
        </div>
      </section>

      <section v-if="on" class="card space-y-3">
        <div class="card-title">ทดสอบบอทตอบแชท (AI)</div>
        <p class="text-sm text-stone-600">พิมพ์เป็นลูกค้าทดสอบ บอทตอบในแชททดสอบนี้เท่านั้น ไม่ส่งถึง Facebook หรือลูกค้าจริง · AI ใช้ได้ไม่เกิน 30 ครั้งต่อวัน</p>
        <div class="max-h-80 space-y-2 overflow-y-auto" aria-live="polite">
          <div v-for="(m, i) in botLog" :key="i" class="flex flex-col" :class="m.from === 'customer' ? 'items-end' : 'items-start'">
            <div class="max-w-[85%] rounded-2xl px-3 py-2 text-sm" :class="m.from === 'customer' ? 'bg-sky-50 text-stone-800' : m.from === 'note' ? 'bg-stone-100 text-stone-600' : 'bg-white text-stone-800 ring-1 ring-stone-200'">{{ m.text }}</div>
            <div v-if="m.note" class="mt-0.5 text-xs text-stone-500">{{ m.note }}</div>
          </div>
          <p v-if="!botLog.length" class="text-sm text-stone-500">ยังไม่มีข้อความ พิมพ์ด้านล่างเพื่อเริ่มทดสอบ</p>
        </div>
        <form class="flex gap-2" @submit.prevent="askBot">
          <input v-model="botText" class="input h-11 flex-1" maxlength="1000" placeholder="เช่น เปิดกี่โมงคะ" aria-label="ข้อความทดสอบ" :disabled="botBusy" />
          <button type="submit" class="btn-primary h-11 px-4" :disabled="botBusy || !botText.trim()">{{ botBusy ? 'กำลังตอบ…' : 'ส่ง' }}</button>
        </form>
        <div class="flex items-center justify-between gap-2">
          <button type="button" class="btn-outline h-10 px-3 text-sm" @click="newBotChat">เริ่มแชทใหม่</button>
          <span v-if="botErr" class="text-sm text-rose-700" role="alert">{{ botErr }}</span>
        </div>
      </section>

      <p v-if="msg" class="rounded-xl p-3 text-sm" :class="ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'" role="status">{{ msg }}</p>
    </div>
  </ManageShell>
</template>
