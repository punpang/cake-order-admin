<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import { supabaseEnabled } from '../../lib/supabase'
import { CAMPAIGN_TYPES, CAMPAIGN_LIMITS, CAMPAIGN_FOOTER, validateCampaign, campaignCard, campaignMessageText } from '../../lib/campaigns'
import { campaignCall, uploadCampaignImage } from '../../lib/campaignRemote'
import { askConfirm } from '../../lib/confirm'
import { showToast } from '../../lib/toast'
import { dateTime } from '../../lib/format'

// ประชาสัมพันธ์/โปรโมชั่น: ส่งเป็นการ์ดในแชทเว็บ/แอปของลูกค้าที่กดเปิดรับข่าวสารเอง (และมีบัญชีเว็บ) + แจ้งเตือน push
// ผู้รับถูกคำนวณที่เซิร์ฟเวอร์ทุกครั้งที่ส่ง · ส่งซ้ำไม่ได้ · ยังไม่ถึงเวลาหรือยังไม่ส่งยกเลิกได้
const STATUS = { draft: 'ฉบับร่าง', scheduled: 'ตั้งเวลาไว้', sending: 'กำลังส่ง', sent: 'ส่งแล้ว', cancelled: 'ยกเลิก' }
const STATUS_CLS = { draft: 'bg-stone-100 text-stone-700', scheduled: 'bg-amber-50 text-amber-800', sending: 'bg-brand-50 text-brand-800', sent: 'bg-emerald-50 text-emerald-800', cancelled: 'bg-rose-50 text-rose-700' }
const blank = () => ({ id: '', type: 'promo', title: '', body: '', image: '', url: '', when: 'now', scheduledLocal: '' })

const items = ref([])
const audience = ref(null)
const loading = ref(false)
const open = ref(false)
const busy = ref(false)
const imgBusy = ref(false)
const form = reactive(blank())
let timer = null

// เวลาในรูปแบบของช่องวัน-เวลา (เวลาท้องถิ่น)
const localInput = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const minLocal = () => localInput(new Date(Date.now() + 2 * 60e3))
const scheduledIso = () => (form.scheduledLocal ? new Date(form.scheduledLocal).toISOString() : '')
const payload = () => ({ type: form.type, title: form.title, body: form.body, image: form.image, url: form.url })
const preview = computed(() => campaignCard({ ...payload(), type: form.type }))

async function load() {
  if (!supabaseEnabled) return
  loading.value = true
  const r = await campaignCall('list')
  loading.value = false
  if (r.error) return showToast(r.error, 4000, 'error')
  items.value = r.items || []
  audience.value = r.audience ?? null
  // กำลังส่งอยู่ → รีเฟรชเอง จนกว่าจะจบ
  const live = items.value.some((c) => c.status === 'sending')
  if (live && !timer) timer = setInterval(load, 6000)
  if (!live && timer) { clearInterval(timer); timer = null }
}

function openNew() {
  Object.assign(form, blank(), { scheduledLocal: localInput(new Date(Date.now() + 3600e3)) })
  open.value = true
}
function openEdit(c) {
  Object.assign(form, blank(), { id: c.id, type: c.type, title: c.title, body: c.body, image: c.image || '', url: c.url || '', scheduledLocal: localInput(new Date(Date.now() + 3600e3)) })
  open.value = true
}

async function onPickImage(e) {
  const file = e.target.files?.[0]
  e.target.value = ''
  if (!file) return
  imgBusy.value = true
  const r = await uploadCampaignImage(file)
  imgBusy.value = false
  if (r.error) return showToast(r.error, 4000, 'error')
  form.image = r.url
}

// บันทึกเป็นฉบับร่าง (ยังไม่ส่ง)
async function saveDraft() {
  const v = validateCampaign(payload())
  if (!v.ok) return showToast(v.error, 4000, 'error')
  busy.value = true
  const r = await campaignCall('save', { campaign: { ...payload(), id: form.id || undefined } })
  busy.value = false
  if (r.error) return showToast(r.error, 4000, 'error')
  form.id = r.campaign.id
  showToast('บันทึกฉบับร่างแล้ว')
  open.value = false
  await load()
}

// ส่งเลย หรือตั้งเวลาส่ง · ยืนยันจำนวนผู้รับล่าสุดก่อนทุกครั้ง
async function send() {
  const later = form.when === 'later'
  const v = validateCampaign({ ...payload(), scheduledAt: later ? scheduledIso() : '' })
  if (!v.ok) return showToast(v.error, 4000, 'error')
  const count = await campaignCall('audience')
  if (count.error) return showToast(count.error, 4000, 'error')
  if (!count.count) return showToast('ตอนนี้ไม่มีผู้รับ (ลูกค้าต้องกดเปิดรับข่าวสารเองและมีบัญชีเว็บ/แอป)', 5000, 'error')
  const ok = await askConfirm({
    title: later ? 'ตั้งเวลาส่งประชาสัมพันธ์?' : 'ส่งประชาสัมพันธ์เลยตอนนี้?',
    message: `ผู้รับ ${count.count} คน · ${later ? 'ยกเลิกได้จนถึงเวลาส่ง' : 'ส่งแล้วยกเลิกไม่ได้'}`,
    okText: later ? 'ตั้งเวลา' : 'ส่งเลย',
  })
  if (!ok) return
  busy.value = true
  const saved = await campaignCall('save', { campaign: { ...payload(), id: form.id || undefined } })
  if (saved.error) { busy.value = false; return showToast(saved.error, 4000, 'error') }
  form.id = saved.campaign.id
  const r = later
    ? await campaignCall('schedule', { id: form.id, scheduledAt: scheduledIso() })
    : await campaignCall('send_now', { id: form.id })
  busy.value = false
  if (r.error) { showToast(r.error, 5000, 'error'); await load(); return }
  const c = r.campaign
  showToast(later ? 'ตั้งเวลาส่งแล้ว' : c.status === 'sent' ? `ส่งครบแล้ว ${c.stats.sent} คน` : `ส่งแล้ว ${c.stats.sent} คน กำลังส่งต่อให้ครบ`)
  open.value = false
  await load()
}

async function cancel(c) {
  if (!(await askConfirm({ title: 'ยกเลิกการส่งประชาสัมพันธ์?', message: c.title, okText: 'ยกเลิกการส่ง', danger: true }))) return
  const r = await campaignCall('cancel', { id: c.id })
  if (r.error) return showToast(r.error, 4000, 'error')
  showToast('ยกเลิกแล้ว')
  await load()
}

async function resume(c) {
  const r = await campaignCall('resume', { id: c.id })
  if (r.error) return showToast(r.error, 4000, 'error')
  showToast(r.campaign.status === 'sent' ? `ส่งครบแล้ว ${r.campaign.stats.sent} คน` : 'ส่งต่อแล้ว ยังมีที่เหลือ')
  await load()
}

onMounted(load)
onBeforeUnmount(() => { if (timer) clearInterval(timer) })
</script>

<template>
  <ManageShell title="ประชาสัมพันธ์ & โปรโมชั่น" subtitle="ส่งเข้าแชทเว็บ/แอปของลูกค้า พร้อมแจ้งเตือน" :toolbar="false" add-label="สร้างประชาสัมพันธ์" @add="openNew">
    <p v-if="!supabaseEnabled" class="card mb-4 p-4 text-sm text-rose-700">หน้านี้ต้องเชื่อมต่อฐานข้อมูลออนไลน์ก่อน จึงจะส่งข้อความถึงลูกค้าได้</p>

    <div class="card mb-4 flex flex-wrap items-center justify-between gap-3 p-4">
      <div>
        <p class="text-sm text-stone-500">ผู้รับได้ตอนนี้</p>
        <p class="font-display text-2xl text-stone-900">{{ audience ?? '-' }} <span class="text-sm font-normal text-stone-500">คน</span></p>
      </div>
      <p class="max-w-md text-xs leading-relaxed text-stone-500">เฉพาะลูกค้าที่กดเปิดรับข่าวสารเองในหน้าบัญชี และมีบัญชีเว็บ/แอป · ลูกค้าที่ร้านเพิ่มเองต้องเปิดรับเองก่อนจึงจะได้รับ</p>
    </div>

    <p v-if="!items.length && !loading" class="card py-10 text-center text-stone-500">ยังไม่มีประชาสัมพันธ์ กดปุ่ม "สร้างประชาสัมพันธ์" เพื่อเริ่ม</p>

    <div class="space-y-2">
      <div v-for="c in items" :key="c.id" class="card p-4">
        <div class="flex flex-wrap items-center gap-2 text-xs">
          <span class="rounded-full bg-brand-50 px-2 py-0.5 font-semibold text-brand-800">{{ CAMPAIGN_TYPES[c.type] }}</span>
          <span class="rounded-full px-2 py-0.5 font-semibold" :class="STATUS_CLS[c.status]">{{ STATUS[c.status] }}</span>
          <span class="ml-auto text-stone-400">{{ dateTime(c.createdAt) }}</span>
        </div>
        <p class="mt-2 font-semibold text-stone-900">{{ c.title }}</p>
        <p class="mt-1 line-clamp-2 whitespace-pre-line text-sm text-stone-600">{{ c.body }}</p>
        <p class="mt-2 text-xs text-stone-500">
          <template v-if="c.status === 'draft'">ยังไม่ได้ส่ง</template>
          <template v-else-if="c.status === 'scheduled'">ส่งเวลา {{ dateTime(c.scheduledAt) }} · ผู้รับ {{ c.stats.targets }} คน</template>
          <template v-else-if="c.status === 'cancelled'">ยกเลิกแล้ว</template>
          <template v-else>ส่งแล้ว {{ c.stats.sent }} / {{ c.stats.targets }} คน · ข้าม {{ c.stats.skipped }} · ไม่สำเร็จ {{ c.stats.failed }}</template>
        </p>
        <div v-if="['draft', 'scheduled', 'sending'].includes(c.status)" class="mt-3 flex flex-wrap gap-2">
          <button v-if="c.status === 'draft'" type="button" class="btn-outline h-9 px-3 text-sm" @click="openEdit(c)">แก้ไข / ส่ง</button>
          <button v-if="c.status === 'scheduled'" type="button" class="btn-outline h-9 px-3 text-sm" @click="cancel(c)">ยกเลิกการส่ง</button>
          <button v-if="c.status === 'sending'" type="button" class="btn-outline h-9 px-3 text-sm" @click="resume(c)">ส่งต่อ</button>
        </div>
      </div>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขประชาสัมพันธ์' : 'สร้างประชาสัมพันธ์'" wide @close="open = false">
      <div class="grid gap-5 md:grid-cols-2">
        <div class="space-y-4">
          <div>
            <p class="label">ประเภท</p>
            <div class="flex flex-wrap gap-2">
              <button v-for="(l, k) in CAMPAIGN_TYPES" :key="k" type="button" class="chip" :class="form.type === k ? 'chip-on' : 'chip-off'" @click="form.type = k">{{ l }}</button>
            </div>
          </div>
          <div>
            <label class="label" for="cp-title">หัวข้อ <span class="text-rose-600">*</span></label>
            <input id="cp-title" v-model="form.title" class="input" :maxlength="CAMPAIGN_LIMITS.title" placeholder="เช่น ลด 10% ทุกเค้กวันศุกร์นี้" />
            <p class="mt-1 text-right text-xs text-stone-400">{{ form.title.length }}/{{ CAMPAIGN_LIMITS.title }}</p>
          </div>
          <div>
            <label class="label" for="cp-body">ข้อความ <span class="text-rose-600">*</span></label>
            <textarea id="cp-body" v-model="form.body" class="input min-h-32" :maxlength="CAMPAIGN_LIMITS.body" />
            <p class="mt-1 text-xs text-stone-400">ระบบต่อท้ายบรรทัดวิธีปิดรับข่าวสารให้อัตโนมัติ · {{ form.body.length }}/{{ CAMPAIGN_LIMITS.body }}</p>
          </div>
          <div>
            <p class="label">รูปประกอบ (ไม่บังคับ)</p>
            <div class="flex flex-wrap items-center gap-3">
              <img v-if="form.image" :src="form.image" alt="" class="h-16 w-24 rounded-xl object-cover" />
              <label class="btn-soft h-10 cursor-pointer px-3 text-sm">{{ imgBusy ? 'กำลังอัปโหลด...' : form.image ? 'เปลี่ยนรูป' : 'เลือกรูป' }}
                <input type="file" accept="image/*" class="sr-only" :disabled="imgBusy" @change="onPickImage" />
              </label>
              <button v-if="form.image" type="button" class="text-sm text-rose-600" @click="form.image = ''">ลบรูป</button>
            </div>
          </div>
          <div>
            <label class="label" for="cp-url">ลิงก์ปุ่ม (ไม่บังคับ)</label>
            <input id="cp-url" v-model="form.url" class="input" placeholder="https://..." />
          </div>
          <div>
            <p class="label">เวลาส่ง</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="chip" :class="form.when === 'now' ? 'chip-on' : 'chip-off'" @click="form.when = 'now'">ส่งทันที</button>
              <button type="button" class="chip" :class="form.when === 'later' ? 'chip-on' : 'chip-off'" @click="form.when = 'later'">ตั้งเวลา</button>
            </div>
            <input v-if="form.when === 'later'" v-model="form.scheduledLocal" type="datetime-local" class="input mt-2" :min="minLocal()" />
            <p v-if="form.when === 'later'" class="mt-1 text-xs text-stone-500">ระบบเริ่มส่งภายใน 15 นาทีหลังถึงเวลาที่ตั้งไว้</p>
          </div>
        </div>

        <div>
          <p class="label">ตัวอย่างที่ลูกค้าจะเห็นในแชท</p>
          <div class="overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
            <img v-if="preview.image" :src="preview.image" alt="" class="h-40 w-full object-cover" />
            <div class="p-3.5">
              <p class="text-xs font-semibold text-brand-700">{{ CAMPAIGN_TYPES[form.type] }}</p>
              <p class="font-display text-base leading-snug text-stone-900">{{ form.title || 'หัวข้อ' }}</p>
              <p class="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-stone-700">{{ campaignMessageText({ body: form.body || 'ข้อความ' }) }}</p>
              <span v-if="form.url" class="btn-soft mt-3 flex h-10 w-full items-center justify-center text-sm">ดูรายละเอียด</span>
            </div>
          </div>
          <p class="mt-2 text-xs text-stone-500">บรรทัดท้าย: {{ CAMPAIGN_FOOTER }}</p>
        </div>
      </div>
      <template #footer>
        <button type="button" class="btn-outline" :disabled="busy" @click="saveDraft">บันทึกฉบับร่าง</button>
        <button type="button" class="btn-primary" :disabled="busy || imgBusy" @click="send">{{ form.when === 'later' ? 'ตั้งเวลาส่ง' : 'ส่งเลย' }}</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
