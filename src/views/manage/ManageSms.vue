<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { supabaseEnabled, getSupabase } from '../../lib/supabase'
import { phoneValid, phoneDigits, dateTime } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

// จัดการ SMS Gateway (บนโทรศัพท์) ตาม API: POST /v1/sms (Idempotency-Key ฝั่งเรียก) · GET /v1/sms/{id}
// เรียกผ่าน Edge Function sms-send เท่านั้น · URL/คีย์เป็น secret ฝั่งเซิร์ฟเวอร์ หน้านี้ไม่แสดงค่าลับ
const MAX_TEXT = 350
const ERR_TH = {
  invalid_to: 'เบอร์ไม่ถูกต้องตามที่เกตเวย์รับ',
  invalid_message: 'ข้อความไม่ถูกต้อง',
  message_too_long: `ข้อความยาวเกินที่เกตเวย์รับ (สูงสุด ${MAX_TEXT} ตัวอักษร / 5 ฉบับ)`,
  invalid_idempotency_key: 'คีย์กันส่งซ้ำไม่ถูกรูปแบบ',
  idempotency_key_reused: 'คีย์ซ้ำกับข้อความอื่นที่ไม่ตรงกัน',
  rate_limited: 'เรียกเกตเวย์ถี่เกินไป ลองใหม่อีกครั้ง',
  daily_limit_reached: 'ถึงโควตาการส่งต่อวันของเกตเวย์แล้ว',
}

const sms = reactive({ configured: null, checking: false, statusErr: '' })
const test = reactive({ phone: '', text: `[ทดสอบ] ข้อความทดสอบจาก ${db.shop.name || 'ร้าน'}`, busy: false, ok: null, msg: '', id: '', key: '' })
const look = reactive({ id: '', busy: false, ok: null, msg: '', data: null })

const canManage = computed(() => can('manage'))
const hasGateway = computed(() => db.integrations.sms?.status === 'connected')
const gatewayHost = computed(() => db.integrations.sms?.accountId || '-')
const recent = computed(() => db.outbox.filter((m) => m.channel === 'sms').slice(0, 20))
const textLen = computed(() => test.text.length)

const fnClient = async () => (supabaseEnabled ? getSupabase() : null)

// อ่านสถานะ: configured = มี secret SMS_GATEWAY_URL และ SMS_API_KEY ฝั่งเซิร์ฟเวอร์
async function checkStatus() {
  sms.checking = true
  sms.statusErr = ''
  const c = await fnClient()
  if (!c) { sms.configured = false; sms.checking = false; sms.statusErr = 'ยังไม่ได้เชื่อมระบบฐานข้อมูล'; return }
  try {
    const r = await c.functions.invoke('sms-send', { body: { action: 'status' } })
    if (r.error) throw new Error('status')
    sms.configured = !!r.data?.configured
  } catch {
    sms.configured = false
    sms.statusErr = 'ตรวจสถานะไม่ได้ (ตรวจการล็อกอินหรือ Edge Function sms-send)'
  } finally {
    sms.checking = false
  }
}

// อ่านข้อความ error จากการตอบของ Edge Function (ส่งมาเป็น JSON ใน context)
async function invokeError(r) {
  try { return (await r.error.context?.json?.())?.error || '' } catch { return '' }
}

// idempotency key ใหม่ต่อการกดหนึ่งครั้ง (ลองซ้ำด้วยคีย์เดิมได้ ไม่ส่งซ้ำ)
const newKey = () => `sms-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

async function sendTest() {
  test.ok = null
  test.msg = ''
  test.id = ''
  if (!phoneValid(test.phone)) { test.ok = false; test.msg = 'กรอกเบอร์โทร 9–10 หลัก (ขึ้นต้น 0)'; return }
  if (!test.text.trim()) { test.ok = false; test.msg = 'ไม่มีข้อความ'; return }
  if (textLen.value > MAX_TEXT) { test.ok = false; test.msg = `ข้อความยาวเกิน ${MAX_TEXT} ตัวอักษร`; return }
  const c = await fnClient()
  if (!c) { test.ok = false; test.msg = 'ยังไม่ได้เชื่อมระบบฐานข้อมูล'; return }
  test.busy = true
  test.key = test.key || newKey()
  try {
    const r = await c.functions.invoke('sms-send', { body: { number: phoneDigits(test.phone), text: test.text.trim(), kind: 'test', idempotencyKey: test.key } })
    if (r.error) {
      test.ok = false
      test.msg = (await invokeError(r)) || 'ส่งไม่สำเร็จ'
    } else if (r.data?.ok) {
      test.ok = true
      test.id = r.data.id ? String(r.data.id) : ''
      test.msg = `เกตเวย์รับงานแล้ว (ยังไม่ยืนยันว่าถึงผู้รับ) · คีย์ ${test.key}`
      look.id = test.id
    } else {
      test.ok = false
      test.msg = r.data?.error || 'ส่งไม่สำเร็จ'
    }
  } finally {
    test.busy = false
  }
}

// กดส่งซ้ำด้วยคีย์เดิมได้ (กันส่งซ้ำ) · เปลี่ยนเบอร์/ข้อความแล้วคีย์ใหม่ให้อัตโนมัติ
function resetKey() { test.key = '' }

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

const dataText = computed(() => (look.data ? JSON.stringify(look.data, null, 2) : ''))
const errText = (e) => ERR_TH[e] || e

onMounted(() => { if (canManage.value) checkStatus() })
</script>

<template>
  <ManageShell narrow guard title="SMS Gateway" subtitle="ส่งทดสอบ · ตรวจสถานะงาน · ดูรายการที่ส่งจากระบบ">
    <p v-if="!canManage" class="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">เฉพาะผู้มีสิทธิ์จัดการการเชื่อมต่อ</p>

    <template v-else>
      <div class="mb-3 flex gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
        <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
        <p>SMS ส่งผ่านเกตเวย์บนโทรศัพท์ (ต้องมีรีเลย์/Tunnel ที่เข้าถึง LAN ได้) · "รับงานแล้ว" ยังไม่ได้แปลว่าถึงผู้รับ · ข้อความยาวสูงสุด {{ MAX_TEXT }} ตัวอักษร (5 ฉบับ)</p>
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
          <dt class="text-stone-500">ปลายทางที่บันทึกไว้</dt>
          <dd class="font-mono text-xs break-all">{{ gatewayHost }}</dd>
          <dt class="text-stone-500">ช่องทาง SMS</dt>
          <dd>{{ db.integrations.sms?.enabled ? 'เปิดใช้' : 'ปิดอยู่' }}</dd>
        </dl>
        <p v-if="sms.statusErr" class="mt-2 text-xs text-rose-600">{{ sms.statusErr }}</p>
        <p v-else-if="sms.configured === false" class="mt-2 text-xs text-stone-500">ตั้ง secret ที่ Supabase: <code>SMS_GATEWAY_URL</code> (ลิงก์รีเลย์) และ <code>SMS_API_KEY</code> (สิทธิ์ส่งและลบ) · ตั้งชื่อ/URL ที่หน้า "การเชื่อมต่อ &amp; แจ้งเตือน"</p>
        <RouterLink to="/admin/settings/integrations" class="mt-2 inline-block text-xs text-brand-700 underline">ไปหน้าการเชื่อมต่อ</RouterLink>
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
          <button type="button" class="btn-primary h-10" :disabled="test.busy" @click="sendTest">{{ test.busy ? 'กำลังส่ง…' : 'ส่งทดสอบ' }}</button>
          <p v-if="test.msg" class="text-sm" :class="test.ok ? 'text-emerald-700' : 'text-rose-600'">
            {{ test.ok === false ? errText(test.msg) : test.msg }}
          </p>
          <p v-if="test.id" class="text-xs text-stone-500">รหัสงาน <span class="font-mono">{{ test.id }}</span> (ตรวจสถานะด้านล่างได้)</p>
        </div>
      </section>

      <!-- ตรวจสถานะงาน -->
      <section class="card mb-3 p-4">
        <h2 class="font-semibold">ตรวจสถานะงาน</h2>
        <div class="mt-3 flex gap-2">
          <input v-model="look.id" class="input flex-1 font-mono text-sm" maxlength="64" placeholder="รหัสงาน" />
          <button type="button" class="btn-primary h-10 px-4" :disabled="look.busy" @click="lookupStatus">{{ look.busy ? '…' : 'ตรวจ' }}</button>
        </div>
        <p v-if="look.msg" class="mt-2 text-sm" :class="look.ok ? 'text-emerald-700' : 'text-rose-600'">{{ look.ok === false ? errText(look.msg) : look.msg }}</p>
        <pre v-if="dataText" class="mt-2 max-h-72 overflow-auto rounded-xl bg-stone-50 p-3 text-xs">{{ dataText }}</pre>
      </section>

      <!-- รายการที่ส่งจากระบบ -->
      <section class="card p-4">
        <h2 class="font-semibold">รายการ SMS จากระบบ (ล่าสุด 20)</h2>
        <p v-if="!recent.length" class="mt-2 text-sm text-stone-500">ยังไม่มีรายการ</p>
        <ul v-else class="mt-2 divide-y divide-stone-100 text-sm">
          <li v-for="m in recent" :key="m.id" class="py-2">
            <div class="flex items-center justify-between gap-2">
              <span class="truncate">{{ m.to }}</span>
              <span class="shrink-0 text-xs" :class="m.status === 'sent' ? 'text-emerald-700' : m.status === 'failed' ? 'text-rose-600' : 'text-stone-500'">
                {{ m.status === 'sent' ? 'รับงานแล้ว' : m.status === 'failed' ? 'ไม่สำเร็จ' : m.status === 'simulated' ? 'จำลอง' : 'รอส่ง' }}
              </span>
            </div>
            <div class="text-xs text-stone-500">{{ dateTime(m.at) }}</div>
            <div v-if="m.status === 'failed' && m.error" class="text-xs text-rose-600">{{ m.error }}</div>
          </li>
        </ul>
      </section>
    </template>
  </ManageShell>
</template>
