<script setup>
import { computed, reactive, ref } from 'vue'
import { db, saveBotSettings, saveBotRule, removeBotRule, removeLearned, promoteLearned, testBot } from '../../data/store'
import { dateOnly } from '../../lib/format'
import { AUTO_SOURCES, BOT_DEFAULTS, AI_MODELS } from '../../lib/chatBot'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// บอทตอบแชท (กฎคีย์เวิร์ด + เรียนรู้จากพนักงาน · ในเบราว์เซอร์ ไม่ส่งข้อความลูกค้าออกนอก) · ค่าเริ่มต้นปิด
// โหมดรายประเภท: ไม่เคยตั้งไว้ → ใช้โหมดรวมเดิม
const srcInit = () => Object.fromEntries(AUTO_SOURCES.map((k) => [k, db.bot.sourceModes?.[k] || db.bot.mode]))
const snap = () => JSON.parse(JSON.stringify({ enabled: db.bot.enabled, mode: db.bot.mode, channels: db.bot.channels, confidence: db.bot.confidence, delaySec: db.bot.delaySec, offHours: db.bot.offHours, closedNotice: db.bot.closedNotice, handoff: db.bot.handoff, sourceModes: srcInit(), ai: { ...BOT_DEFAULTS.ai, ...(db.bot.ai || {}) } }))
const st = reactive(snap())
const msg = ref('')
const err = ref('')
function save() {
  msg.value = err.value = ''
  const r = saveBotSettings(st)
  if (r.error) return (err.value = r.error)
  Object.assign(st, snap())
  msg.value = 'บันทึกแล้ว'
}
const aiKeyHint = 'ต้องตั้งคีย์ ANTHROPIC_API_KEY เป็น secret ของ Supabase (Edge Function fb-webhook) ก่อน · ไม่มีคีย์ = บอทส่งต่อพนักงานเหมือนเดิม'
const pct = computed({ get: () => Math.round(st.confidence * 100), set: (v) => (st.confidence = (Number(v) || 60) / 100) })

// กฎ
const rule = ref(null)
const rerr = ref('')
const blank = () => ({ id: null, name: '', keywords: '', reply: '', active: true })
function openRule(r) { rerr.value = ''; rule.value = r ? { id: r.id, name: r.name, keywords: r.keywords.join(', '), reply: r.reply, active: r.active !== false } : blank() }
function submitRule() {
  const r = saveBotRule(rule.value)
  if (r.error) return (rerr.value = r.error)
  rule.value = null
}
async function delRule(r) {
  if (await askConfirm({ title: 'ลบกฎ', message: r.name, okText: 'ลบ', danger: true })) removeBotRule(r.id)
}
// ที่เรียนรู้
async function promote(l) {
  const r = promoteLearned(l.id)
  if (r.error) err.value = r.error
}
async function delLearned(l) {
  if (await askConfirm({ title: 'ลบคู่ที่เรียนรู้', message: l.q, okText: 'ลบ', danger: true })) removeLearned(l.id)
}
// ทดสอบ
const test = reactive({ text: '', customerId: '', res: null })
const customers = computed(() => db.customers.filter((c) => !c.deleted))
function runTest() {
  test.res = test.text.trim() ? testBot(test.text, { customerId: test.customerId || null }) : null
}
const SRC = { rule: 'กฎ', faq: 'FAQ หน้าร้าน', hours: 'เวลาเปิด', price: 'ราคา/แนะนำสินค้า', learned: 'เรียนรู้จากพนักงาน', order: 'สถานะออร์เดอร์', ask: 'ขอข้อมูลที่ขาด', offhours: 'นอกเวลาทำการ', handoff: 'ส่งต่อพนักงาน', order_unverified: 'ยืนยันตัวตนไม่ได้ (ส่งต่อ)' }
</script>

<template>
  <ManageShell narrow guard title="บอทตอบแชท" subtitle="กฎคีย์เวิร์ด + เรียนรู้จากพนักงาน · ในเบราว์เซอร์">
    <div class="mb-3 flex gap-2 rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
      <AppIcon name="alert" :size="18" class="mt-0.5 shrink-0" />
      <p>บอทไม่ตอบเรื่องเงิน/คืนเงิน/ร้องเรียน (ส่งต่อพนักงานเสมอ) และบอกสถานะออร์เดอร์เฉพาะเมื่อแชทผูกลูกค้าและออร์เดอร์เป็นของลูกค้าคนนั้น · ข้อความลูกค้าประมวลผลในเบราว์เซอร์ ไม่ส่งออกภายนอก · ของจริงรับแชทผ่าน webhook ต้องต่อเซิร์ฟเวอร์</p>
    </div>

    <section class="card mb-4 space-y-3">
      <div class="flex items-center justify-between"><h2 class="font-semibold text-stone-900">ตั้งค่า</h2><AppSwitch v-model="st.enabled" label="เปิดบอท" /></div>
      <div>
        <div class="label">ตอบเองรายประเภท (ไม่ตั้ง = แนะนำให้พนักงานกดส่ง)</div>
        <ul class="divide-y divide-stone-100 rounded-xl border border-stone-200">
          <li v-for="k in AUTO_SOURCES" :key="k" class="flex items-center justify-between gap-2 p-2.5">
            <span class="text-sm text-stone-800">{{ SRC[k] }}</span>
            <div class="grid w-56 grid-cols-2 gap-1 seg-grid">
              <button type="button" class="rounded-lg py-1.5 text-xs font-medium" :class="st.sourceModes[k] === 'suggest' ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-600'" @click="st.sourceModes[k] = 'suggest'">แนะนำ</button>
              <button type="button" class="rounded-lg py-1.5 text-xs font-medium" :class="st.sourceModes[k] === 'auto' ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-600'" @click="st.sourceModes[k] = 'auto'">ตอบเอง</button>
            </div>
          </li>
        </ul>
        <p class="mt-1 text-xs text-stone-400">การส่งต่อพนักงาน และข้อความที่ยืนยันตัวตนไม่ได้ จะให้พนักงานตอบเสมอ · Facebook ส่งเองได้เฉพาะภายใน 24 ชม.</p>
      </div>
      <div class="flex flex-wrap gap-4"><AppSwitch v-model="st.channels.line" label="LINE OA" /><AppSwitch v-model="st.channels.facebook" label="Facebook (ภายใน 24 ชม.)" /></div>
      <div class="space-y-3 rounded-xl border border-violet-200 bg-violet-50/40 p-3">
        <div class="flex items-center justify-between"><h3 class="font-semibold text-stone-900">บอท AI</h3><AppSwitch v-model="st.ai.enabled" label="เปิดบอท AI" /></div>
        <p class="text-xs text-stone-600">ใช้เฉพาะเมื่อกฎเดิมตอบไม่ได้ (ไม่รวมเรื่องเงิน ร้องเรียน และเลขออร์เดอร์ — ส่งต่อพนักงานเสมอ) · ใช้ได้เฉพาะ Facebook · ส่งไปยังผู้ให้บริการ AI (Claude API) เฉพาะข้อความปัจจุบันของลูกค้า พร้อมชื่อร้าน เวลาทำการ คำถามที่พบบ่อย และรายการสินค้าพร้อมราคา · ไม่ส่งประวัติแชท ชื่อ เบอร์ อีเมล หรือข้อมูลออร์เดอร์ ข้อความที่มีข้อมูลส่วนตัวจะไม่ส่งให้ AI เลย</p>
        <p class="text-xs text-amber-700">{{ aiKeyHint }}</p>
        <div class="grid gap-2 sm:grid-cols-2">
          <div class="grid grid-cols-2 gap-1 seg-grid">
            <button type="button" class="rounded-lg py-1.5 text-xs font-medium" :class="st.ai.mode === 'suggest' ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-600'" @click="st.ai.mode = 'suggest'">ร่างให้พนักงานกดส่ง</button>
            <button type="button" class="rounded-lg py-1.5 text-xs font-medium" :class="st.ai.mode === 'auto' ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-600'" @click="st.ai.mode = 'auto'">ส่งเอง</button>
          </div>
          <div><label class="label">เพดานต่อวัน (ครั้ง · 0 = ไม่เรียก)</label><input v-model.number="st.ai.dailyLimit" type="text" v-num class="input" /></div>
          <div><label class="label">โมเดล</label><select v-model="st.ai.model" class="input" aria-label="โมเดล AI"><option v-for="m in AI_MODELS" :key="m" :value="m">{{ m }}</option></select></div>
          <div><label class="label">ความยาวคำตอบสูงสุด (โทเคน)</label><input v-model.number="st.ai.maxTokens" type="text" v-num class="input" /></div>
        </div>
        <p class="text-xs text-stone-400">เริ่มแนะนำให้ใช้โหมดร่างก่อน · โหมดส่งเองควรเปิดหลังทดสอบบนบัญชี Messenger ทดสอบแล้ว · ตั้งงบใช้จ่ายที่ผู้ให้บริการด้วย</p>
      </div>
      <div class="grid gap-3 sm:grid-cols-2">
        <div><label class="label">ความมั่นใจขั้นต่ำ (%) ต่ำกว่านี้ส่งต่อพนักงาน</label><input v-model.number="pct" type="text" v-num class="input" /></div>
        <div><label class="label">หน่วงเวลาก่อนตอบเอง (วินาที)</label><input v-model.number="st.delaySec" type="text" v-num class="input" /></div>
      </div>
      <div>
        <AppSwitch v-model="st.offHours.enabled" label="ตอบข้อความนอกเวลาทำการ" />
        <textarea v-model="st.offHours.text" rows="2" class="input mt-2" maxlength="300" aria-label="ข้อความตอบนอกเวลาทำการ" />
        <p class="mt-1 text-xs text-stone-400">ใช้ {เวลาเปิด} {เวลาปิด} ได้ · เวลาทำการตามตั้งค่าร้าน ({{ db.shop.open }}–{{ db.shop.close }})</p>
      </div>
      <div>
        <AppSwitch v-model="st.closedNotice.enabled" label="แจ้งร้านปิดเมื่อลูกค้าทักครั้งแรกของวัน (ตามวัน-เวลาปิดร้าน)" />
        <textarea v-model="st.closedNotice.text" rows="2" class="input mt-2" maxlength="300" aria-label="ข้อความแจ้งร้านปิด" />
        <p class="mt-1 text-xs text-stone-400">ใช้ {เหตุผล} {เปิดอีกครั้ง} ได้ · แจ้งครั้งเดียวต่อวันต่อแชท แล้วบอทตอบเรื่องอื่นต่อตามปกติ · ลูกค้ายังสั่งวัน-เวลาที่ร้านเปิดได้ · ตั้งวันปิดที่ จัดการ → ตั้งค่าร้าน</p>
      </div>
      <div>
        <label class="label">ข้อความตอนส่งต่อพนักงาน</label>
        <textarea v-model="st.handoff.text" rows="2" class="input" maxlength="300" aria-label="ข้อความตอนส่งต่อพนักงาน" />
        <div class="mt-2"><AppSwitch v-model="st.handoff.notifyTelegram" label="แจ้งทีมทาง Telegram เมื่อส่งต่อ" /></div>
      </div>
      <p v-if="err" class="text-sm text-rose-600">{{ err }}</p>
      <p v-if="msg" class="text-sm text-emerald-700">{{ msg }}</p>
      <button class="btn-primary" @click="save">บันทึกตั้งค่า</button>
    </section>

    <section class="card mb-4 grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
      <div><div class="text-xl font-bold text-stone-900">{{ db.bot.stats.suggested }}</div><div class="text-xs text-stone-500">ร่างที่เสนอ</div></div>
      <div><div class="text-xl font-bold text-emerald-700">{{ db.bot.stats.answered }}</div><div class="text-xs text-stone-500">ตอบแล้ว</div></div>
      <div><div class="text-xl font-bold text-violet-700">{{ db.bot.stats.handoff }}</div><div class="text-xs text-stone-500">ส่งต่อพนักงาน</div></div>
      <div><div class="text-xl font-bold text-amber-700">{{ db.bot.stats.staffEdited }}</div><div class="text-xs text-stone-500">พนักงานแก้ร่าง</div></div>
    </section>

    <section class="card mb-4">
      <h2 class="mb-2 font-semibold text-stone-900">ทดสอบ (ไม่ส่งจริง)</h2>
      <div class="space-y-2">
        <input v-model="test.text" class="input" aria-label="ข้อความลูกค้าที่ใช้ทดสอบ" placeholder="พิมพ์ข้อความลูกค้า เช่น เปิดกี่โมง / ขอเช็คออร์เดอร์ OR-0004" @keyup.enter="runTest" />
        <select v-model="test.customerId" class="input" aria-label="ผูกกับลูกค้า (ทดสอบ)"><option value="">แชทที่ยังไม่ผูกลูกค้า</option><option v-for="c in customers" :key="c.id" :value="c.id">แชทผูกกับ {{ c.name }}</option></select>
        <button class="btn-outline h-10" @click="runTest">ทดสอบ</button>
      </div>
      <div v-if="test.res" class="mt-3 rounded-xl border p-3 text-sm" :class="test.res.handoff ? 'border-violet-200 bg-violet-50' : 'border-emerald-200 bg-emerald-50'">
        <div class="mb-1 text-xs font-semibold" :class="test.res.handoff ? 'text-violet-700' : 'text-emerald-700'">{{ test.res.handoff ? 'ส่งต่อพนักงาน' : 'บอทจะตอบ' }} · {{ SRC[test.res.source] || test.res.source }}<template v-if="test.res.confidence"> · {{ Math.round(test.res.confidence * 100) }}%</template></div>
        <p class="whitespace-pre-line text-stone-800">{{ test.res.reply }}</p>
        <p class="mt-1 text-xs text-stone-500">เหตุผล: {{ test.res.reason }}</p>
      </div>
    </section>

    <section class="card mb-4">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="font-semibold text-stone-900">กฎคีย์เวิร์ด ({{ db.bot.rules.length }})</h2>
        <button class="btn-primary h-9 px-3" @click="openRule(null)">+ เพิ่มกฎ</button>
      </div>
      <p v-if="!db.bot.rules.length" class="py-3 text-center text-sm text-stone-400">ยังไม่มีกฎ · บอทยังตอบเวลาเปิด ราคา และ FAQ หน้าร้านได้เองอยู่แล้ว</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="r in db.bot.rules" :key="r.id" class="py-2.5 text-sm" :class="r.active === false ? 'opacity-60' : ''">
          <div class="flex flex-wrap items-center gap-2"><b class="text-stone-900">{{ r.name }}</b><span class="chip chip-off">{{ r.keywords.join(' · ') }}</span><span class="ml-auto text-xs text-stone-400">ใช้ {{ r.hits || 0 }} ครั้ง</span></div>
          <p class="mt-0.5 text-xs text-stone-500">{{ r.reply }}</p>
          <div class="mt-1.5 flex gap-2"><button class="btn-outline h-8 px-3 text-xs" @click="openRule(r)">แก้ไข</button><button class="btn-outline h-8 px-3 text-xs text-rose-600" @click="delRule(r)">ลบ</button></div>
        </li>
      </ul>
    </section>

    <section class="card">
      <h2 class="mb-1 font-semibold text-stone-900">คำตอบที่เรียนรู้จากพนักงาน ({{ db.bot.learned.length }})</h2>
      <p class="mb-2 text-xs text-stone-500">จดคู่ ถาม→ตอบ เมื่อพนักงานตอบแชทเอง (ตัดเบอร์/อีเมล/เลขออร์เดอร์/ชื่อเป็น placeholder · ไม่เรียนเรื่องเงิน/ร้องเรียน) · กด "ยืนยันเป็นกฎ" เพื่อให้เป็นกฎถาวร</p>
      <p v-if="!db.bot.learned.length" class="py-3 text-center text-sm text-stone-400">ยังไม่มี</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="l in db.bot.learned" :key="l.id" class="py-2.5 text-sm">
          <div class="text-xs text-stone-400">ถาม · ใช้ {{ l.uses }} ครั้ง · {{ dateOnly(l.lastAt) }}</div>
          <p class="text-stone-900">{{ l.q }}</p>
          <div class="mt-1 text-xs text-stone-400">ตอบ</div>
          <p class="whitespace-pre-line text-stone-700">{{ l.a }}</p>
          <div class="mt-1.5 flex gap-2"><button class="btn-soft h-8 px-3 text-xs" @click="promote(l)">ยืนยันเป็นกฎ</button><button class="btn-outline h-8 px-3 text-xs text-rose-600" @click="delLearned(l)">ลบ</button></div>
        </li>
      </ul>
    </section>

    <AppModal v-if="rule" :title="rule.id ? 'แก้กฎ' : 'เพิ่มกฎ'" @close="rule = null">
      <div class="space-y-3">
        <div><label class="label">ชื่อกฎ <span class="text-rose-500">*</span></label><input v-model="rule.name" class="input" maxlength="60" /></div>
        <div><label class="label">คีย์เวิร์ด (คั่นด้วย ,) <span class="text-rose-500">*</span></label><input v-model="rule.keywords" class="input" placeholder="จอดรถ, ที่จอด" /></div>
        <div><label class="label">คำตอบ <span class="text-rose-500">*</span></label><textarea v-model="rule.reply" rows="3" class="input" maxlength="500" /></div>
        <AppSwitch v-model="rule.active" label="เปิดใช้งาน" />
        <p v-if="rerr" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ rerr }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rule = null">ปิด</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="submitRule">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
