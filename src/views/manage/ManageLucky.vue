<script setup>
// ลุ้นโชคท้ายบิล (แอดมิน): หลายโครงการพร้อมกัน · แต่ละโครงการมีเงื่อนไขเดียว (ซื้อสินค้าที่เลือก หรือ ซื้อครบทุก X บาท)
// ช่วงวันที่ซื้อบิล อายุคูปอง และรางวัลวนตามลำดับของโครงการนั้น · บิลที่เข้าหลายโครงการได้ลุ้นแยกกัน
// แบบซื้อครบทุก X บาท: ระบบคิดเพดานมูลค่ารางวัลต่อรอบ (ทุกกี่บาท × ครั้งในรอบ × %) และบันทึกไม่ได้ถ้ารางวัลในรอบเกินเพดาน
import { reactive, ref } from 'vue'
import { db, saveLuckyDraw } from '../../data/store'
import { LUCKY_SITE_URL, MAX_DRAWS_PER_BILL, PRIZE_KINDS, PROJECT_KINDS, ROUND_DRAWS_DEFAULT, PRIZE_PCT_DEFAULT, luckyBudgetOf, luckyProjectsOf, newLuckyProject, prizeValueOf } from '../../lib/luckyDraw'
import { money } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import MoneyInput from '../../components/MoneyInput.vue'

// เวลาในฟอร์ม (datetime-local) ↔ ISO ที่เก็บ
const pad = (n) => String(n).padStart(2, '0')
const toLocal = (iso) => {
  const d = iso ? new Date(iso) : null
  if (!d || Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
// ช่องวันเวลากรอกไม่ครบ/อ่านไม่ได้ → ได้ค่าว่าง (ตรวจในกติกาบันทึกแทน ไม่ให้หน้าพัง)
const toIso = (v) => {
  const d = v ? new Date(v) : null
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : ''
}

let seq = 0
const newId = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`

// ฟอร์มของโครงการ: เวลาเป็นข้อความ datetime-local · ค้นหาสินค้า (q) ไม่บันทึก
const formOf = (p) => ({
  id: p.id,
  name: p.name || '',
  enabled: !!p.enabled,
  kind: p.kind === 'amount' ? 'amount' : 'items',
  itemIds: [...(p.itemIds || [])],
  everyBaht: p.everyBaht ?? 100,
  roundDraws: p.roundDraws ?? ROUND_DRAWS_DEFAULT,
  prizePct: p.prizePct ?? PRIZE_PCT_DEFAULT,
  fromL: toLocal(p.from),
  toL: toLocal(p.to),
  couponDays: p.couponDays || 30,
  prizes: (p.prizes || []).map((x) => ({ id: x.id, name: x.name, kind: x.kind || 'discount', amount: x.amount || 0, value: x.value || 0, points: x.points || 10 })),
  q: '',
})

const st = reactive({
  siteUrl: db.shop.luckyDraw?.siteUrl || LUCKY_SITE_URL,
  projects: luckyProjectsOf(db.shop.luckyDraw).map(formOf),
})
const msg = ref('')
const ok = ref(false)

// ---------- สินค้าที่ร่วมโครงการ (จัดกลุ่มตามหมวด · ค้นหาได้) ----------
function groupsOf(q) {
  const s = String(q || '').trim().toLowerCase()
  const groups = new Map()
  for (const x of db.retailItems || []) {
    if (x.active === false) continue
    if (s && !String(x.name).toLowerCase().includes(s)) continue
    const key = x.category || 'ไม่มีหมวด'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(x)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
}
const nameOf = (id) => db.retailItems.find((x) => x.id === id)?.name || id
function togglePick(p, id) {
  p.itemIds = p.itemIds.includes(id) ? p.itemIds.filter((x) => x !== id) : [...p.itemIds, id]
}

// ---------- โครงการ ----------
function addProject(kind) {
  st.projects.push(formOf(newLuckyProject(newId('lpj'), kind)))
}
async function removeProject(i) {
  const p = st.projects[i]
  const yes = await askConfirm({
    title: 'ลบโครงการนี้?',
    message: `ลบ "${p.name || 'ไม่มีชื่อ'}" และรางวัลของโครงการนี้ เมื่อกดบันทึก บิลที่ยังไม่ได้ลุ้นจะไม่เห็นโครงการนี้อีก`,
    okText: 'ลบโครงการ',
    danger: true,
  })
  if (yes) st.projects.splice(i, 1)
}

// ---------- งบรางวัลต่อรอบ (แบบซื้อครบทุก X บาท) ----------
// คิดจากค่าในฟอร์มทันที ให้เห็นก่อนบันทึก · กติกาเดียวกับตอนบันทึกใน luckyDraw.js
function budgetOf(p) {
  return luckyBudgetOf({ everyBaht: p.everyBaht, roundDraws: p.roundDraws, prizePct: p.prizePct, prizes: p.prizes }, db.loyalty.pointValue)
}

// ---------- รางวัลของแต่ละโครงการ (ไม่จำกัดจำนวน · วนตามลำดับที่ออก) ----------
function addPrize(p) { p.prizes.push({ id: '', name: '', kind: 'discount', amount: 0, value: 0, points: 10 }) }
function removePrize(p, i) { p.prizes.splice(i, 1) }
// เลื่อนลำดับขึ้น/ลง (dir = -1 ขึ้น · 1 ลง) · ลำดับนี้คือลำดับที่รางวัลถูกออก
function movePrize(p, i, dir) {
  const j = i + dir
  if (j < 0 || j >= p.prizes.length) return
  const a = p.prizes[i]
  p.prizes.splice(i, 1, p.prizes[j])
  p.prizes.splice(j, 1, a)
}

// ---------- สถิติของโครงการ (จากบิลที่ออก QR และการลุ้นที่ซิงก์แล้ว) ----------
function statOf(p) {
  const mine = (db.luckyTokens || []).filter((r) => r.draws && typeof r.draws === 'object' && (r.draws[p.id] || 0) > 0)
  const spins = mine.flatMap((r) => (r.spins || []).filter((s) => s.projectId === p.id))
  return { bills: mine.length, spins: spins.length, won: spins.filter((s) => s.prize && s.prize.kind !== 'none').length }
}

function save() {
  const r = saveLuckyDraw({
    siteUrl: st.siteUrl,
    projects: st.projects.map((p) => ({
      id: p.id, name: p.name, enabled: p.enabled, kind: p.kind, itemIds: p.itemIds, everyBaht: p.everyBaht,
      roundDraws: p.roundDraws, prizePct: p.prizePct,
      from: toIso(p.fromL), to: toIso(p.toL), couponDays: p.couponDays, prizes: p.prizes,
    })),
  })
  ok.value = !r.error
  msg.value = r.error || 'บันทึกแล้ว'
}
</script>

<template>
  <ManageShell title="ลุ้นโชคท้ายบิล" subtitle="QR ท้ายใบเสร็จ → หน้าลุ้นโชคของบิลนั้น" back="/admin/settings" narrow :toolbar="false">
    <div class="space-y-4">
      <section class="card space-y-3">
        <div class="card-title">ตั้งค่าทั่วไป</div>
        <div>
          <label class="label" for="lk-url">URL หน้าเว็บ (ใช้ทำ QR)</label>
          <input id="lk-url" v-model="st.siteUrl" class="input h-11" placeholder="https://cake-order-admin.pages.dev" />
        </div>
        <p class="text-sm text-stone-600">บิลที่ขายในช่วงเวลาของโครงการที่เปิดอยู่ จะได้ QR ไปลุ้น · บิลหนึ่งใบลุ้นได้ทุกโครงการที่เข้าเงื่อนไข และลุ้นแยกกันตามโครงการ</p>
      </section>

      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="card-title">โครงการ ({{ st.projects.length }})</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="k in PROJECT_KINDS" :key="k.v" type="button" class="btn-soft h-10 px-3 text-sm" @click="addProject(k.v)">
            <AppIcon name="plus" :size="15" /> {{ k.l }}
          </button>
        </div>
      </div>
      <p v-if="!st.projects.length" class="rounded-xl bg-stone-50 p-4 text-center text-sm text-stone-500">ยังไม่มีโครงการ กดปุ่มด้านบนเพื่อเพิ่มโครงการแรก</p>

      <section v-for="(p, pi) in st.projects" :key="p.id" class="card space-y-4">
        <div class="flex items-start gap-2">
          <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{{ pi + 1 }}</span>
          <input :id="'pname-' + pi" v-model="p.name" class="input h-11 min-w-0 flex-1" placeholder="ชื่อโครงการ เช่น ซื้อชอคโกแลตลุ้นทุกบิล" :aria-label="`ชื่อโครงการที่ ${pi + 1}`" />
          <button type="button" class="btn-outline h-11 w-11 shrink-0" :aria-label="`ลบโครงการที่ ${pi + 1}`" @click="removeProject(pi)"><AppIcon name="trash" :size="16" /></button>
        </div>
        <AppSwitch v-model="p.enabled" label="เปิดใช้งานโครงการนี้" />

        <div>
          <div class="label">เงื่อนไข</div>
          <div class="grid grid-cols-2 gap-2">
            <button v-for="k in PROJECT_KINDS" :key="k.v" type="button" class="chip" :class="p.kind === k.v ? 'chip-on' : 'chip-off'" :aria-pressed="p.kind === k.v" @click="p.kind = k.v">{{ k.l }}</button>
          </div>
        </div>

        <div v-if="p.kind === 'items'" class="space-y-2">
          <details class="rounded-2xl border border-stone-200 p-3">
            <summary class="cursor-pointer text-sm font-medium text-stone-800">สินค้าที่ร่วมโครงการ · เลือกแล้ว {{ p.itemIds.length }} รายการ</summary>
            <div class="mt-3 space-y-3">
              <p v-if="p.itemIds.length" class="rounded-xl bg-brand-50 p-2.5 text-sm text-brand-900">{{ p.itemIds.map(nameOf).join(' · ') }}</p>
              <input v-model="p.q" type="search" class="input h-11" placeholder="ค้นหาชื่อสินค้า" :aria-label="`ค้นหาสินค้าของโครงการที่ ${pi + 1}`" />
              <div class="max-h-80 space-y-3 overflow-y-auto pr-1">
                <div v-for="g in groupsOf(p.q)" :key="g.category">
                  <div class="mb-1 text-xs font-semibold text-stone-500">{{ g.category }}</div>
                  <label v-for="x in g.items" :key="x.id" class="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 hover:bg-stone-50">
                    <input type="checkbox" class="h-5 w-5 accent-brand-600" :checked="p.itemIds.includes(x.id)" @change="togglePick(p, x.id)" />
                    <span class="flex-1 text-sm text-stone-800">{{ x.name }}</span>
                  </label>
                </div>
                <p v-if="!groupsOf(p.q).length" class="py-4 text-center text-sm text-stone-500">ไม่พบสินค้า</p>
              </div>
            </div>
          </details>
          <p class="text-xs text-stone-500">บิลที่มีสินค้าที่เลือกอย่างน้อย 1 ชิ้น ได้ลุ้น 1 ครั้ง ไม่ดูจำนวนหรือราคา</p>
        </div>
        <div v-else class="space-y-3">
          <div class="grid gap-3 sm:grid-cols-3">
            <div>
              <label class="label" :for="'pe-' + pi">ทุกกี่บาทลุ้นได้ 1 ครั้ง</label>
              <input :id="'pe-' + pi" v-model.number="p.everyBaht" type="number" min="1" step="1" class="input h-11" />
            </div>
            <div>
              <label class="label" :for="'prd-' + pi">ลุ้นกี่ครั้งต่อ 1 รอบ</label>
              <input :id="'prd-' + pi" v-model.number="p.roundDraws" type="number" min="1" step="1" class="input h-11" />
            </div>
            <div>
              <label class="label" :for="'ppc-' + pi">มูลค่ารางวัลต่อรอบ (%)</label>
              <input :id="'ppc-' + pi" v-model.number="p.prizePct" type="number" min="0.01" max="100" step="0.01" class="input h-11" />
            </div>
          </div>
          <div class="rounded-xl p-3 text-sm" :class="budgetOf(p).over ? 'bg-rose-50 text-rose-800' : 'bg-emerald-50 text-emerald-800'" role="status">
            <div>เพดานรางวัลต่อ 1 รอบ = {{ budgetOf(p).per }} × {{ budgetOf(p).roundDraws }} × {{ budgetOf(p).prizePct }}% = <b>{{ money(budgetOf(p).ceiling) }}</b></div>
            <div>รางวัลในรอบมากสุดตอนนี้ = <b>{{ money(budgetOf(p).worst) }}</b> · {{ budgetOf(p).over ? 'เกินเพดาน บันทึกไม่ได้' : 'ไม่เกินเพดาน' }}</div>
          </div>
          <p class="text-xs text-stone-500">นับจากยอดที่ลูกค้าจ่ายจริงทั้งบิล (หลังส่วนลดและคูปอง) สูงสุด {{ MAX_DRAWS_PER_BILL }} ครั้งต่อบิล · รางวัลวนตามลำดับ ระบบคิดรอบที่มีมูลค่ารวมมากที่สุด (นับทุกจุดเริ่มของรอบ)</p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" :for="'pf-' + pi">ซื้อบิลตั้งแต่</label>
            <input :id="'pf-' + pi" v-model="p.fromL" type="datetime-local" class="input h-11" />
          </div>
          <div>
            <label class="label" :for="'pt-' + pi">ถึงเวลา (สิ้นสุด)</label>
            <input :id="'pt-' + pi" v-model="p.toL" type="datetime-local" class="input h-11" />
          </div>
        </div>
        <p class="-mt-2 text-xs text-stone-500">นับจากเวลาที่ขายบิล · ลุ้นได้จนถึงเวลาสิ้นสุด</p>
        <div>
          <label class="label" :for="'pd-' + pi">อายุคูปองที่ได้จากการลุ้น (วัน)</label>
          <input :id="'pd-' + pi" v-model.number="p.couponDays" type="number" min="1" max="365" class="input h-11" />
        </div>

        <div class="space-y-3">
          <div class="flex items-center justify-between gap-2">
            <div class="text-sm font-semibold text-stone-800">รางวัลตามลำดับที่ออก</div>
            <button type="button" class="btn-soft h-10 px-3 text-sm" @click="addPrize(p)"><AppIcon name="plus" :size="15" /> เพิ่มรางวัล</button>
          </div>
          <p v-if="!p.prizes.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีรางวัล ทุกครั้งที่ลุ้นจะได้ "ไม่ได้รางวัล"</p>
          <div v-for="(x, i) in p.prizes" :key="i" class="space-y-3 rounded-2xl border border-stone-200 p-3">
            <div class="flex items-center gap-2">
              <span class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-800">{{ i + 1 }}</span>
              <input :id="'pn-' + pi + '-' + i" v-model="x.name" class="input h-11 min-w-0 flex-1" placeholder="ชื่อรางวัล เช่น ส่วนลด 50 บาท" :aria-label="`ชื่อรางวัลลำดับที่ ${i + 1} ของโครงการที่ ${pi + 1}`" />
              <button type="button" class="btn-outline h-11 w-11 shrink-0" :disabled="i === 0" :aria-label="`เลื่อนลำดับที่ ${i + 1} ขึ้น`" @click="movePrize(p, i, -1)"><span class="inline-flex rotate-90"><AppIcon name="back" :size="16" /></span></button>
              <button type="button" class="btn-outline h-11 w-11 shrink-0" :disabled="i === p.prizes.length - 1" :aria-label="`เลื่อนลำดับที่ ${i + 1} ลง`" @click="movePrize(p, i, 1)"><span class="inline-flex -rotate-90"><AppIcon name="back" :size="16" /></span></button>
            </div>
            <div class="grid gap-2 sm:grid-cols-2">
              <div>
                <label class="label" :for="'pk-' + pi + '-' + i">ประเภท</label>
                <select :id="'pk-' + pi + '-' + i" v-model="x.kind" class="input h-11">
                  <option v-for="k in PRIZE_KINDS" :key="k.v" :value="k.v">{{ k.l }}</option>
                </select>
              </div>
              <div v-if="x.kind === 'discount'">
                <label class="label" :for="'pa-' + pi + '-' + i">มูลค่าส่วนลด (บาท)</label>
                <MoneyInput :id="'pa-' + pi + '-' + i" v-model="x.amount" class="input h-11" placeholder="0" />
              </div>
              <div v-if="x.kind === 'reward'">
                <label class="label" :for="'pv-' + pi + '-' + i">มูลค่าของรางวัล (บาท)</label>
                <MoneyInput :id="'pv-' + pi + '-' + i" v-model="x.value" class="input h-11" placeholder="0" />
              </div>
              <div v-if="x.kind === 'points'">
                <label class="label" :for="'pp-' + pi + '-' + i">คะแนนที่ได้</label>
                <input :id="'pp-' + pi + '-' + i" v-model.number="x.points" type="number" min="1" step="1" class="input h-11" />
                <p class="mt-1 text-xs text-stone-500">มูลค่า {{ money(prizeValueOf(x, db.loyalty.pointValue)) }}</p>
              </div>
            </div>
            <div class="flex justify-end">
              <button type="button" class="btn-danger h-10 px-3 text-sm" :aria-label="`ลบรางวัล ${x.name || i + 1} ของโครงการที่ ${pi + 1}`" @click="removePrize(p, i)"><AppIcon name="trash" :size="15" /> ลบรางวัลนี้</button>
            </div>
          </div>
        </div>

        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-stone-50 p-2.5"><div class="text-xs text-stone-500">บิลที่ได้ลุ้น</div><div class="font-semibold">{{ statOf(p).bills }}</div></div>
          <div class="rounded-xl bg-stone-50 p-2.5"><div class="text-xs text-stone-500">ลุ้นแล้ว (ครั้ง)</div><div class="font-semibold">{{ statOf(p).spins }}</div></div>
          <div class="rounded-xl bg-stone-50 p-2.5"><div class="text-xs text-stone-500">ได้รางวัล</div><div class="font-semibold">{{ statOf(p).won }}</div></div>
        </div>
      </section>

      <p v-if="msg" class="rounded-xl p-3 text-sm" :class="ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'" role="status">{{ msg }}</p>
      <button type="button" class="btn-primary h-12 w-full" @click="save">บันทึกการตั้งค่า</button>
      <p class="text-center text-xs text-stone-500">รางวัลที่ได้เข้าเมนู "คูปอง" ของบัญชีสมาชิก ใช้ที่ร้านด้วยวิธีเดียวกับคูปองทั่วไป</p>
    </div>
  </ManageShell>
</template>
