<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { db, saveLegal, saveLegalContact, legalVars, consentStats } from '../../data/store'
import { LEGAL_KINDS, LEGAL_VARS, DEFAULT_PRIVACY, DEFAULT_TERMS, DEFAULT_COOKIE, fillLegal } from '../../lib/legalDefaults'
import { dateOnly } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import PhoneInput from '../../components/PhoneInput.vue'
import LegalText from '../../components/LegalText.vue'

// PDPA / คุกกี้ / เงื่อนไขการใช้งาน (ฉบับมาตรฐานของระบบ) · แก้แล้วขึ้นเวอร์ชันได้ → ลูกค้าต้องกดยอมรับใหม่ · เก็บหลักฐานเวอร์ชัน+เวลาที่ยอมรับ
const DEFAULTS = { privacy: DEFAULT_PRIVACY, terms: DEFAULT_TERMS, cookie: DEFAULT_COOKIE }
const tab = ref('privacy')
const tabs = [{ v: 'privacy', l: 'PDPA' }, { v: 'terms', l: 'เงื่อนไข' }, { v: 'cookie', l: 'คุกกี้' }, { v: 'contact', l: 'ผู้ควบคุมข้อมูล' }]

const form = reactive({ title: '', text: '', bump: true })
const preview = ref(false)
const msg = ref('')
const err = ref('')
function load() {
  const d = db.legal.docs[tab.value]
  if (d) Object.assign(form, { title: d.title, text: d.text, bump: true })
  preview.value = false
  msg.value = err.value = ''
}
watch(tab, load, { immediate: true })
const doc = computed(() => db.legal.docs[tab.value])
const stats = computed(() => (doc.value ? consentStats(tab.value) : null))
const missing = computed(() => fillLegal(form.text, legalVars(), true).missing)
const tag = (k) => '{' + k + '}'
const missingText = computed(() => missing.value.map(tag).join(' '))
const dirty = computed(() => doc.value && (form.text.trim() !== doc.value.text || form.title.trim() !== doc.value.title))

async function save() {
  msg.value = err.value = ''
  if (form.bump && form.text.trim() !== doc.value.text) {
    const who = tab.value === 'cookie' ? 'ผู้เข้าชมจะถูกถามคุกกี้ใหม่' : 'ลูกค้าที่ล็อกอินต้องกดยอมรับใหม่ก่อนใช้บัญชี'
    if (!(await askConfirm({ title: 'ขึ้นเวอร์ชันใหม่', message: `บันทึกเป็นเวอร์ชัน ${doc.value.version + 1} · ${who}`, okText: 'บันทึกและขึ้นเวอร์ชัน' }))) return
  }
  const r = saveLegal(tab.value, form)
  if (r.ok) {
    load()
    msg.value = `บันทึกแล้ว · เวอร์ชัน ${r.version}`
  } else err.value = r.error
}
async function reset() {
  if (!(await askConfirm({ title: 'คืนค่าฉบับมาตรฐาน', message: 'ข้อความในช่องแก้ไขจะถูกแทนด้วยฉบับมาตรฐานของระบบ (ยังไม่บันทึกจนกว่าจะกดบันทึก)', okText: 'คืนค่า', danger: true }))) return
  form.text = DEFAULTS[tab.value]
}

// ---------- ผู้ควบคุมข้อมูล ----------
const c = reactive({ ...db.legal.contact })
const csaved = ref(false)
function saveContact() {
  const r = saveLegalContact(c)
  if (r.ok) {
    Object.assign(c, db.legal.contact)
    csaved.value = true
    setTimeout(() => (csaved.value = false), 1500)
  }
}
const contactMissing = computed(() => ['controller', 'address', 'email', 'phone'].filter((k) => !String(c[k] ?? '').trim()).length)
</script>

<template>
  <ManageShell narrow guard title="PDPA / คุกกี้ / เงื่อนไข" subtitle="ข้อความที่ลูกค้าต้องยินยอม" :toolbar="false">
    <div class="mb-3 flex gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
      <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
      <p>ข้อความเขียนตามระบบที่ใช้งานจริง (Supabase, Facebook, SMS, Telegram, ขนส่ง) · กรอกชื่อผู้ควบคุมข้อมูล ที่อยู่ อีเมล เบอร์ ให้ครบก่อนเปิดให้ลูกค้าใช้ · เมื่อเพิ่มบริการใหม่ (เช่น Facebook จริง ระบบวิเคราะห์) ต้องแก้ข้อความให้ตรง · แนะนำให้ที่ปรึกษากฎหมายตรวจทาน</p>
    </div>

    <div class="mb-4 grid grid-cols-4 gap-1 seg-grid">
      <button v-for="t in tabs" :key="t.v" type="button" class="h-10 rounded-xl text-xs font-semibold transition sm:text-sm" :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="tab = t.v">{{ t.l }}</button>
    </div>

    <!-- ผู้ควบคุมข้อมูล -->
    <section v-if="tab === 'contact'" class="card space-y-3">
      <div class="card-title">ผู้ควบคุมข้อมูลส่วนบุคคล + ระยะเก็บข้อมูล</div>
      <p v-if="contactMissing" class="text-sm text-amber-700">ยังไม่ได้กรอก {{ contactMissing }} ช่อง (ข้อความที่ลูกค้าเห็นจะแสดง "-" แทน)</p>
      <div><label class="label">ชื่อผู้ควบคุมข้อมูล (บุคคล/นิติบุคคล)</label><input v-model="c.controller" class="input" maxlength="120" /></div>
      <div><label class="label">ที่อยู่</label><textarea v-model="c.address" rows="2" class="input" maxlength="250"></textarea></div>
      <div><label class="label">อีเมลรับเรื่องสิทธิ์ข้อมูลส่วนบุคคล</label><input v-model="c.email" class="input" inputmode="email" maxlength="120" /></div>
      <div><label class="label">เบอร์โทรติดต่อ</label><PhoneInput v-model="c.phone" /></div>
      <div class="grid gap-3 sm:grid-cols-3">
        <div><label class="label">เก็บข้อมูลบัญชีหลังเลิกใช้ (เดือน)</label><input v-model="c.retentionAccount" type="text" v-num class="input" /></div>
        <div><label class="label">เก็บหลักฐานออร์เดอร์/ชำระ (ปี)</label><input v-model="c.retentionAccounting" type="text" v-num class="input" /></div>
        <div><label class="label">เก็บประวัติแชท (เดือน)</label><input v-model="c.retentionChat" type="text" v-num class="input" /></div>
      </div>
      <p class="text-xs text-stone-400">ระยะเก็บเป็นตัวเลขตัวอย่าง กรุณายืนยันกับนักบัญชี/ที่ปรึกษากฎหมาย (ระยะเก็บบัญชีตามกฎหมายขึ้นกับประเภทกิจการ)</p>
      <div class="flex items-center gap-3">
        <button class="btn-primary" @click="saveContact">บันทึก</button>
        <span v-if="csaved" class="flex items-center gap-1 text-sm text-emerald-700"><AppIcon name="check" :size="16" /> บันทึกแล้ว</span>
      </div>
    </section>

    <!-- เอกสาร -->
    <template v-else-if="doc">
      <div class="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-stone-600">
        <span>เวอร์ชัน <b>{{ doc.version }}</b></span>
        <span>ปรับปรุง {{ dateOnly(doc.updatedAt) }}</span>
        <span v-if="stats && stats.total != null">ยอมรับเวอร์ชันนี้แล้ว <b>{{ stats.accepted }}</b> / {{ stats.total }} บัญชี</span>
        <span v-else-if="stats">ผู้เลือกคุกกี้เวอร์ชันนี้ <b>{{ stats.accepted }}</b> ครั้ง</span>
        <RouterLink :to="`/legal/${tab}`" target="_blank" class="ml-auto text-brand-700 underline">ดูหน้าลูกค้า</RouterLink>
      </div>

      <section class="card space-y-3">
        <div><label class="label">หัวข้อเอกสาร</label><input v-model="form.title" class="input" maxlength="120" /></div>
        <div>
          <div class="mb-1.5 flex items-center justify-between">
            <label class="label !mb-0">ข้อความ</label>
            <button type="button" class="text-sm text-brand-700 underline" @click="preview = !preview">{{ preview ? 'กลับไปแก้ไข' : 'ดูตัวอย่าง' }}</button>
          </div>
          <textarea v-if="!preview" v-model="form.text" aria-label="ข้อความ" rows="20" class="input font-mono !text-sm leading-relaxed"></textarea>
          <div v-else class="max-h-[28rem] overflow-y-auto rounded-xl border border-stone-200 bg-white p-4"><LegalText :text="form.text" mark /></div>
          <p class="mt-1 text-xs text-stone-400">รูปแบบ: <code>## หัวข้อ</code> · <code>- รายการ</code> · เว้นบรรทัดเพื่อขึ้นย่อหน้าใหม่ · ตัวแปรแทนค่าอัตโนมัติ เช่น {ชื่อร้าน} {อัตราสะสม} {อายุคะแนน}</p>
        </div>
        <details class="rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
          <summary class="cursor-pointer py-2 font-medium">ตัวแปรที่ใช้ได้</summary>
          <ul class="mt-2 space-y-0.5"><li v-for="(d, k) in LEGAL_VARS" :key="k"><code>{{ tag(k) }}</code> · {{ d }}</li></ul>
        </details>
        <p v-if="missing.length" class="text-sm text-amber-700">ตัวแปรที่ยังไม่มีค่า: {{ missingText }} → ไปกรอกที่แท็บ "ผู้ควบคุมข้อมูล"</p>
        <AppSwitch v-model="form.bump" :label="tab === 'cookie' ? 'ขึ้นเวอร์ชันใหม่ (ถามคุกกี้ผู้เข้าชมใหม่)' : 'ขึ้นเวอร์ชันใหม่ (ลูกค้าต้องกดยอมรับอีกครั้ง)'" />
        <p v-if="msg" class="rounded-xl bg-brand-50 p-2.5 text-sm text-brand-800">{{ msg }}</p>
        <p v-if="err" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>
        <div class="flex flex-wrap gap-2">
          <button class="btn-primary flex-1 sm:flex-none" :disabled="!dirty" @click="save">บันทึก</button>
          <button class="btn-outline" @click="reset">คืนค่าฉบับมาตรฐาน</button>
        </div>
      </section>
    </template>
  </ManageShell>
</template>
