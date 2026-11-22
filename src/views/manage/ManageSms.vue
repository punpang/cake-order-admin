<script setup>
import { computed, onMounted, reactive } from 'vue'
import { db, can } from '../../data/store'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import { phoneValid, phoneDigits, dateTime } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

// จัดการ SMS Gateway (แอปบนโทรศัพท์) ตาม SMS Gateway API v1
// เรียกผ่าน Edge Function sms-send เท่านั้น · URL/คีย์เป็น secret ฝั่งเซิร์ฟเวอร์ หน้านี้ไม่แสดงค่าลับ
const MAX_TEXT = 350
// DELIVERED มีเฉพาะในรายการข้อความ (GET /v1/messages) · งานเดี่ยว (GET /v1/sms/{id}) ใช้ SENT + delivered_at แทน
const STATUS_TH = { QUEUED: 'รอส่ง', SENDING: 'กำลังส่ง', SENT: 'ส่งแล้ว', DELIVERED: 'ถึงผู้รับแล้ว', FAILED: 'ไม่สำเร็จ' }
const STATUS_CLS = { QUEUED: 'text-stone-500', SENDING: 'text-sky-700', SENT: 'text-emerald-700', DELIVERED: 'text-emerald-700', FAILED: 'text-rose-700' }
// last_error ของงานที่ไม่สำเร็จและจะไม่ลองส่งซ้ำแล้ว (ตามเอกสารเกตเวย์) · ค่าอื่นแสดงตามที่เกตเวย์ส่งมา
const LAST_ERROR_TH = {
  partial_send: 'บางฉบับถึงระบบวิทยุแล้ว จึงไม่ลองส่งซ้ำ',
  outcome_unknown: 'ไม่ได้รับผลกลับจากระบบวิทยุ จึงไม่ลองส่งซ้ำ',
}
const DIRECTIONS = { all: 'ทั้งหมด', out: 'ส่งออก', in: 'รับเข้า' }

const sms = reactive({ configured: null, checking: false, statusErr: '', gateway: null })
const test = reactive({ phone: '', text: `[ทดสอบ] ข้อความทดสอบจาก ${db.shop.name || 'ร้าน'}`, sim: '', busy: false, ok: null, msg: '', id: '', key: '' })
const look = reactive({ id: '', busy: false, ok: null, msg: '', data: null })
const list = reactive({ direction: 'out', items: [], nextBefore: null, busy: false, err: '' })

const canManage = computed(() => can('manage'))
const hasGateway = computed(() => db.integrations.sms?.status === 'connected')
const gatewayHost = computed(() => db.integrations.sms?.accountId || '-')
const textLen = computed(() => test.text.length)
const counts = computed(() => sms.gateway?.sms_counts || null)

const fnClient = async () => (supabaseEnabled ? await getSupabase() : null)

// error จาก Edge Function มาเป็นข้อความไทยใน body แล้ว
async function invokeError(r) {
  try { return (await r.error.context?.json?.())?.error || '' } catch { return '' }
}

// ตรวจค่าตั้งและสถานะเกตเวย์ (configured = secret ครบฝั่งเซิร์ฟเวอร์ · gateway = GET /v1/status)
async function checkStatus() {
  sms.checking = true
  sms.statusErr = ''
  sms.gateway = null
  const c = await fnClient()
  if (!c) { sms.configured = false; sms.checking = false; sms.statusErr = 'ยังไม่ได้เชื่อมระบบฐานข้อมูล'; return }
  try {
    const r = await c.functions.invoke('sms-send', { body: { action: 'status' } })
    if (r.error) throw new Error('status')
    sms.configured = !!r.data?.configured
    if (sms.configured) {
      const g = await c.functions.invoke('sms-send', { body: { action: 'gateway' } })
      if (g.data?.ok) sms.gateway = g.data.gateway
      else sms.statusErr = g.data?.error || (await invokeError(g)) || 'เชื่อมเกตเวย์ไม่ได้'
    }
  } catch {
    sms.configured = false
    sms.statusErr = 'ตรวจสถานะไม่ได้ (ตรวจการล็อกอินหรือ Edge Function sms-send)'
  } finally {
    sms.checking = false
  }
}

// รายการข้อความจากเกตเวย์: GET /v1/messages (direction, limit ≤ 200, before เพื่อแบ่งหน้า)
async function loadMessages(more = false) {
  const c = await fnClient()
  if (!c) return
  list.busy = true
  list.err = ''
  try {
    const body = { action: 'messages', direction: list.direction, limit: 20 }
    if (more && list.nextBefore) body.before = list.nextBefore
    const r = await c.functions.invoke('sms-send', { body })
    if (r.data?.ok) {
      list.items = more ? [...list.items, ...r.data.messages] : r.data.messages
      list.nextBefore = r.data.next_before ?? null
    } else {
      list.err = r.data?.error || (await invokeError(r)) || 'โหลดรายการไม่สำเร็จ'
    }
  } finally {
    list.busy = false
  }
}

function setDirection(d) {
  list.direction = d
  list.nextBefore = null
  loadMessages()
}

// idempotency key ใหม่ต่อการกดหนึ่งครั้ง · ลองซ้ำด้วยคีย์เดิมไม่ส่งซ้ำ · เปลี่ยนเบอร์/ข้อความ/ซิมแล้วขอคีย์ใหม่
const newKey = () => `sms-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
function resetKey() { test.key = '' }

async function sendTest() {
  test.ok = null
  test.msg = ''
  test.id = ''
  if (!phoneValid(test.phone)) { test.ok = false; test.msg = 'กรอกเบอร์โทร 9–10 หลัก (ขึ้นต้น 0)'; return }
  if (!test.text.trim()) { test.ok = false; test.msg = 'ไม่มีข้อความ'; return }
  if (textLen.value > MAX_TEXT) { test.ok = false; test.msg = `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร (สูงสุด 5 ฉบับ)`; return }
  const c = await fnClient()
  if (!c) { test.ok = false; test.msg = 'ยังไม่ได้เชื่อมระบบฐานข้อมูล'; return }
  test.busy = true
  test.key = test.key || newKey()
  try {
    const body = { number: phoneDigits(test.phone), text: test.text.trim(), kind: 'test', idempotencyKey: test.key }
    if (test.sim) body.sim = Number(test.sim)
    const r = await c.functions.invoke('sms-send', { body })
    if (r.error) {
      test.ok = false
      test.msg = (await invokeError(r)) || 'ส่งไม่สำเร็จ'
    } else if (r.data?.ok) {
      test.ok = true
      test.id = r.data.id ? String(r.data.id) : ''
      test.msg = r.data.created === false
        ? `คีย์นี้เคยส่งแล้ว (คืนงานเดิม ไม่ส่งซ้ำ) · สถานะ ${STATUS_TH[r.data.status] || r.data.status || '-'}`
        : `เกตเวย์รับงานแล้ว · สถานะ ${STATUS_TH[r.data.status] || r.data.status || 'รอส่ง'} (ยังไม่รับรองว่าถึงผู้รับ)`
      look.id = test.id
    } else {
      test.ok = false
      test.msg = r.data?.error || 'ส่งไม่สำเร็จ'
    }
  } finally {
    test.busy = false
  }
}

// สถานะงาน: GET /v1/sms/{id} → id, status, attempts, last_error, created_at, updated_at
async function lookupStatus() {
  look.ok = null
  look.msg = ''
  look.data = null
  const id = look.id.trim()
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) { look.ok = false; look.msg = 'รหัสงานไม่ถูกต้อง'; return }
  const c = await fnClient()
  if (!c) { look.ok = false; look.msg = 'ยังไม่ได้เชื่อมระบบฐานข้อมูล'; return }
  look.busy = true
  try {
    const r = await c.functions.invoke('sms-send', { body: { action: 'lookup', id } })
    if (r.error) {
      look.ok = false
      look.msg = (await invokeError(r)) || 'ตรวจสถานะไม่สำเร็จ'
    } else if (r.data?.ok) {
      look.ok = true
      look.data = r.data.sms ?? {}
      look.msg = 'ดึงสถานะแล้ว'
    } else {
      look.ok = false
      look.msg = r.data?.error || 'ตรวจสถานะไม่สำเร็จ'
    }
  } finally {
    look.busy = false
  }
}

const lookupFields = computed(() => {
  const d = look.data
  if (!d) return []
  return [
    ['สถานะ', STATUS_TH[d.status] || d.status || '-'],
    ['จำนวนครั้งที่ลองส่ง', d.attempts ?? '-'],
    ['ซิม', d.sim ?? 'ค่าเริ่มต้น'],
    ['สร้างเมื่อ', d.created_at ? dateTime(d.created_at) : '-'],
    ['อัปเดตเมื่อ', d.updated_at ? dateTime(d.updated_at) : '-'],
    ['ถึงผู้รับเมื่อ', d.delivered_at ? dateTime(d.delivered_at) : 'ยังไม่มีรายงาน (ผู้ให้บริการบางรายไม่รองรับ)'],
    ['ข้อผิดพลาดล่าสุด', LAST_ERROR_TH[d.last_error] || d.last_error || '-'],
  ]
})

onMounted(() => {
  if (!canManage.value) return
  checkStatus()
  loadMessages()
})
</script>

<template>
  <ManageShell narrow guard :toolbar="false" title="SMS Gateway" subtitle="สถานะเกตเวย์ · ส่งทดสอบ · ตรวจสถานะงาน · รายการข้อความ">
    <p v-if="!canManage" class="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">เฉพาะผู้มีสิทธิ์จัดการการเชื่อมต่อ</p>

    <template v-else>
      <div class="mb-3 flex gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
        <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
        <p>SMS ส่งผ่านแอปบนโทรศัพท์ (ต้องมีรีเลย์/Tunnel ที่เข้าถึง LAN ได้) · "รับงานแล้ว" ยังไม่ได้แปลว่าถึงผู้รับ · ข้อความสูงสุด {{ MAX_TEXT }} ตัวอักษร (5 ฉบับ) · ถ้าฉบับใดล้มเหลว เกตเวย์อาจส่งข้อความทั้งชุดซ้ำ</p>
      </div>

      <!-- สถานะ -->
      <section class="card mb-3 p-4">
        <div class="flex items-center justify-between gap-2">
          <h2 class="font-semibold">สถานะเกตเวย์</h2>
          <button type="button" class="btn-ghost h-9 px-3 text-sm" :disabled="sms.checking" @click="checkStatus">{{ sms.checking ? 'กำลังตรวจ…' : 'ตรวจอีกครั้ง' }}</button>
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-sm">
          <dt class="text-stone-500">ฝั่งเซิร์ฟเวอร์</dt>
          <dd>
            <span v-if="sms.configured === null">…</span>
            <span v-else-if="sms.configured" class="font-medium text-emerald-700">ตั้งค่า secret ครบ</span>
            <span v-else class="font-medium text-rose-700">ยังไม่พร้อม</span>
          </dd>
          <dt class="text-stone-500">การทำงานของแอป</dt>
          <dd>
            <span v-if="sms.gateway" :class="sms.gateway.running ? 'text-emerald-700' : 'text-rose-700'">{{ sms.gateway.running ? 'กำลังทำงาน' : 'หยุดอยู่' }}</span>
            <span v-else class="text-stone-400">-</span>
          </dd>
          <dt class="text-stone-500">ปลายทางที่บันทึกไว้</dt>
          <dd class="font-mono text-xs break-all">{{ gatewayHost }}</dd>
          <dt class="text-stone-500">ช่องทาง SMS</dt>
          <dd>{{ db.integrations.sms?.enabled ? 'เปิดใช้' : 'ปิดอยู่' }}</dd>
        </dl>
        <div v-if="counts" class="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
          <div class="rounded-xl bg-stone-50 p-2"><div class="text-base font-semibold">{{ counts.queued ?? 0 }}</div>รอส่ง</div>
          <div class="rounded-xl bg-stone-50 p-2"><div class="text-base font-semibold">{{ counts.sending ?? 0 }}</div>กำลังส่ง</div>
          <div class="rounded-xl bg-emerald-50 p-2"><div class="text-base font-semibold text-emerald-700">{{ counts.sent ?? 0 }}</div>ส่งแล้ว</div>
          <div class="rounded-xl bg-rose-50 p-2"><div class="text-base font-semibold text-rose-700">{{ counts.failed ?? 0 }}</div>ไม่สำเร็จ</div>
        </div>
        <p v-if="sms.statusErr" class="mt-2 text-xs text-rose-700">{{ sms.statusErr }}</p>
        <p v-else-if="sms.configured === false" class="mt-2 text-xs text-stone-500">ตั้ง secret ที่ Supabase: <code>SMS_API_KEY</code> (สิทธิ์ส่งและลบ)</p>
        <RouterLink to="/admin/settings/integrations" class="mt-1 inline-block py-2.5 text-sm text-brand-700 underline">ไปหน้าการเชื่อมต่อ</RouterLink>
        <p v-if="!hasGateway" class="mt-1 text-xs text-stone-400">ยังไม่ได้บันทึกการเชื่อมในระบบ (ตั้งที่หน้าการเชื่อมต่อ)</p>
      </section>

      <!-- ส่งทดสอบ -->
      <section class="card mb-3 p-4">
        <h2 class="font-semibold">ส่งข้อความทดสอบ</h2>
        <div class="mt-3 grid gap-2">
          <div>
            <label class="label">เบอร์ปลายทาง</label>
            <input v-model="test.phone" type="tel" inputmode="numeric" maxlength="12" class="input font-mono" placeholder="0812345678" @input="resetKey" />
          </div>
          <div>
            <label class="label">ข้อความ ({{ textLen }}/{{ MAX_TEXT }})</label>
            <textarea v-model="test.text" rows="3" class="input" :class="textLen > MAX_TEXT ? 'border-rose-400' : ''" @input="resetKey"></textarea>
          </div>
          <div>
            <label class="label">ซิม</label>
            <select v-model="test.sim" class="input" @change="resetKey">
              <option value="">ค่าเริ่มต้นของเครื่อง</option>
              <option value="1">ซิม 1</option>
              <option value="2">ซิม 2</option>
            </select>
          </div>
          <button type="button" class="btn-primary h-10" :disabled="test.busy" @click="sendTest">{{ test.busy ? 'กำลังส่ง…' : 'ส่งทดสอบ' }}</button>
          <p v-if="test.msg" class="text-sm" :class="test.ok ? 'text-emerald-700' : 'text-rose-700'">{{ test.msg }}</p>
          <p v-if="test.id" class="text-xs text-stone-500">รหัสงาน <span class="font-mono">{{ test.id }}</span> · คีย์ <span class="font-mono">{{ test.key }}</span></p>
        </div>
      </section>

      <!-- ตรวจสถานะงาน -->
      <section class="card mb-3 p-4">
        <h2 class="font-semibold">ตรวจสถานะงาน</h2>
        <div class="mt-3 flex gap-2">
          <input v-model="look.id" class="input flex-1 font-mono text-sm" maxlength="64" placeholder="รหัสงาน" />
          <button type="button" class="btn-primary h-10 px-4" :disabled="look.busy" @click="lookupStatus">{{ look.busy ? '…' : 'ตรวจ' }}</button>
        </div>
        <p v-if="look.msg" class="mt-2 text-sm" :class="look.ok ? 'text-emerald-700' : 'text-rose-700'">{{ look.msg }}</p>
        <dl v-if="look.data" class="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <template v-for="[k, v] in lookupFields" :key="k">
            <dt class="text-stone-500">{{ k }}</dt>
            <dd class="break-all" :class="k === 'สถานะ' ? STATUS_CLS[look.data.status] : ''">{{ v }}</dd>
          </template>
        </dl>
      </section>

      <!-- รายการข้อความจากเกตเวย์ -->
      <section class="card p-4">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="font-semibold">รายการข้อความ</h2>
          <div class="flex gap-1">
            <button v-for="(label, d) in DIRECTIONS" :key="d" type="button" class="h-8 rounded-full px-3 text-xs pointer-coarse:h-10 pointer-coarse:text-sm" :class="list.direction === d ? 'bg-brand-600 text-white' : 'bg-stone-100 text-stone-600'" @click="setDirection(d)">{{ label }}</button>
          </div>
        </div>
        <p v-if="list.err" class="mt-2 text-sm text-rose-700">{{ list.err }}</p>
        <p v-else-if="!list.items.length && !list.busy" class="mt-2 text-sm text-stone-500">ยังไม่มีรายการ</p>
        <ul v-else class="mt-2 divide-y divide-stone-100 text-sm">
          <li v-for="m in list.items" :key="m.kind + m.id" class="py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate">{{ m.kind === 'in' ? 'รับจาก' : 'ส่งถึง' }} <span class="font-mono">{{ m.peer }}</span></span>
              <span class="shrink-0 text-xs" :class="m.kind === 'in' ? 'text-sky-700' : STATUS_CLS[m.status] || 'text-stone-500'">
                {{ m.kind === 'in' ? 'ขาเข้า' : STATUS_TH[m.status] || m.status || '-' }}
              </span>
            </div>
            <div class="text-xs text-stone-500">{{ dateTime(m.time) }}<span v-if="m.sim"> · ซิม {{ m.sim }}</span> · #{{ m.id }}</div>
            <div class="mt-0.5 line-clamp-2 text-xs text-stone-700">{{ m.body }}</div>
          </li>
        </ul>
        <div v-if="list.nextBefore" class="mt-2 text-center">
          <button type="button" class="btn-ghost h-9 px-4 text-sm" :disabled="list.busy" @click="loadMessages(true)">{{ list.busy ? 'กำลังโหลด…' : 'โหลดเพิ่ม' }}</button>
        </div>
      </section>
    </template>
  </ManageShell>
</template>
