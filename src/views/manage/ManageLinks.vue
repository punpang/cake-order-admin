<script setup>
import ThaiDateField from '../../components/ThaiDateField.vue'
import { computed, reactive, ref } from 'vue'
import { db, saveLinkSettings, saveShortLink, removeShortLink, shortLinkUrl, purgeOrderLinks, findOrder } from '../../data/store'
import { linkExpiresAt } from '../../lib/orderLink'
import { dateTime, dateOnly } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// ลิงก์ย่อ + นโยบายลิงก์ออร์เดอร์
const pol = reactive({ idleDays: db.shop.linkPolicy.idleDays, neverOpenedDays: db.shop.linkPolicy.neverOpenedDays, allow: db.shop.linkAllowlist.join('\n') })
const msg = ref('')
const err = ref('')
function saveSettings() {
  msg.value = err.value = ''
  const r = saveLinkSettings({ policy: { idleDays: pol.idleDays, neverOpenedDays: pol.neverOpenedDays }, allowlist: pol.allow })
  if (r.error) return (err.value = r.error)
  Object.assign(pol, { idleDays: db.shop.linkPolicy.idleDays, neverOpenedDays: db.shop.linkPolicy.neverOpenedDays, allow: db.shop.linkAllowlist.join('\n') })
  msg.value = 'บันทึกแล้ว'
}

const form = ref(null)
const ferr = ref('')
const blank = () => ({ id: null, code: '', target: '', note: '', expiresAt: '', active: true })
function openForm(l) {
  ferr.value = ''
  form.value = l ? { id: l.id, code: l.code, target: l.target, note: l.note || '', expiresAt: l.expiresAt ? l.expiresAt.slice(0, 10) : '', active: l.active } : blank()
}
function submit() {
  const r = saveShortLink(form.value)
  if (r.error) return (ferr.value = r.error)
  form.value = null
}
async function del(l) {
  if (await askConfirm({ title: 'ลบลิงก์ย่อ', message: `${shortLinkUrl(l.code)} จะใช้ไม่ได้อีก`, okText: 'ลบ', danger: true })) removeShortLink(l.id)
}
// ลิงก์ออร์เดอร์มีได้หลายร้อยรายการ → แสดงทีละ 20 (ล่าสุดก่อน)
const linkLimit = ref(20)
const copied = ref('')
async function copy(l) {
  try {
    await navigator.clipboard.writeText(shortLinkUrl(l.code))
    copied.value = l.id
  } catch { /* ไม่รองรับ */ }
}
const orderLinks = computed(() => {
  purgeOrderLinks()
  return db.orderLinks.map((l) => ({ ...l, code: findOrder(l.orderId)?.code || '-', expires: new Date(linkExpiresAt(l, db.shop.linkPolicy)).toISOString() }))
})
const shownOrderLinks = computed(() => orderLinks.value.slice().reverse().slice(0, linkLimit.value))
</script>

<template>
  <ManageShell narrow guard :toolbar="false" title="ลิงก์ย่อ & ลิงก์ออร์เดอร์" subtitle="ลิงก์ย่อ นับคลิก · นโยบายหมดอายุของลิงก์ออร์เดอร์">

    <section class="card mb-4 space-y-3">
      <h2 class="font-semibold text-stone-900">นโยบายลิงก์ออร์เดอร์</h2>
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="label">หมดอายุหลังเปิดล่าสุด (วัน)</label><input v-model.number="pol.idleDays" type="text" v-num class="input" /></div>
        <div><label class="label">ไม่เคยเปิด หมดอายุหลังสร้าง (วัน)</label><input v-model.number="pol.neverOpenedDays" type="text" v-num class="input" /></div>
      </div>
      <div>
        <label class="label">โฮสต์ภายนอกที่ลิงก์ย่อชี้ไปได้ (https · บรรทัดละ 1 โฮสต์)</label>
        <textarea v-model="pol.allow" rows="4" class="input font-mono text-xs" />
        <p class="mt-1 text-xs text-stone-400">ตรงชื่อโฮสต์เป๊ะเท่านั้น (ซับโดเมนต้องใส่แยก)</p>
      </div>
      <p v-if="err" class="text-sm text-danger-700">{{ err }}</p>
      <p v-if="msg" class="text-sm text-success-700">{{ msg }}</p>
      <button class="btn-primary" @click="saveSettings">บันทึกนโยบาย</button>
    </section>

    <section class="card mb-4">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold text-stone-900">ลิงก์ย่อ ({{ db.shortLinks.length }})</h2>
        <button class="btn-primary h-9 px-3" @click="openForm(null)">+ สร้างลิงก์ย่อ</button>
      </div>
      <p v-if="!db.shortLinks.length" class="py-4 text-center text-sm text-stone-400">ยังไม่มีลิงก์ย่อ</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="l in db.shortLinks" :key="l.id" class="py-2.5 text-sm">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono font-semibold text-brand-700">/s/{{ l.code }}</span>
            <span class="chip" :class="l.active ? 'chip-on' : 'chip-off'">{{ l.active ? 'ใช้งาน' : 'ปิด' }}</span>
            <span class="chip chip-off">{{ l.kind === 'internal' ? 'ภายในเว็บ' : 'ภายนอก' }}</span>
            <span class="ml-auto text-xs text-stone-500">คลิก {{ l.clicks }}</span>
          </div>
          <div class="mt-0.5 break-all text-xs text-stone-500">→ {{ l.target }}<span v-if="l.note"> · {{ l.note }}</span><span v-if="l.expiresAt"> · หมดอายุ {{ dateOnly(l.expiresAt) }}</span></div>
          <div class="mt-1.5 flex gap-2">
            <button class="btn-outline h-8 px-3 text-xs" @click="copy(l)">{{ copied === l.id ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์' }}</button>
            <button class="btn-outline h-8 px-3 text-xs" @click="openForm(l)">แก้ไข</button>
            <button class="btn-outline h-8 px-3 text-xs text-danger-700" @click="del(l)">ลบ</button>
          </div>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2 class="mb-2 font-semibold text-stone-900">ลิงก์ออร์เดอร์ที่ใช้อยู่ ({{ orderLinks.length }})</h2>
      <p v-if="!orderLinks.length" class="py-4 text-center text-sm text-stone-400">ยังไม่มี · สร้างได้จากหน้าออร์เดอร์ (ปุ่ม "ส่งลิงก์ให้ลูกค้า")</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="l in shownOrderLinks" :key="l.id" class="flex flex-wrap justify-between gap-x-3 py-2 text-xs text-stone-600">
          <b class="text-stone-800">{{ l.code }}</b>
          <span>{{ l.openCount ? `เปิด ${l.openCount} ครั้ง · ล่าสุด ${dateTime(l.lastOpenedAt)}` : 'ยังไม่เคยเปิด' }}</span>
          <span class="w-full text-stone-400">หมดอายุ {{ dateTime(l.expires) }}</span>
        </li>
      </ul>
      <button v-if="orderLinks.length > linkLimit" type="button" class="btn-outline mt-2 w-full" @click="linkLimit += 50">ดูเพิ่ม (เหลืออีก {{ orderLinks.length - linkLimit }})</button>
    </section>

    <AppModal v-if="form" :title="form.id ? 'แก้ลิงก์ย่อ' : 'สร้างลิงก์ย่อ'" @close="form = null">
      <div class="space-y-3">
        <div><label class="label">ปลายทาง <span class="text-rose-600">*</span></label><input v-model="form.target" class="input" placeholder="/menu หรือ https://lin.ee/xxxx" maxlength="2000" /></div>
        <div><label class="label">รหัสลิงก์ (เว้นว่าง = สุ่ม)</label><input v-model="form.code" class="input font-mono" maxlength="10" placeholder="เช่น promo" /></div>
        <div><label class="label">หมายเหตุ</label><input v-model="form.note" class="input" maxlength="120" /></div>
        <div><label class="label">หมดอายุ (เว้นว่าง = ไม่หมด)</label><ThaiDateField v-model="form.expiresAt" label="วันหมดอายุ" /></div>
        <AppSwitch v-model="form.active" label="เปิดใช้งาน" />
        <p v-if="ferr" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ ferr }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="form = null">ปิด</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="submit">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
