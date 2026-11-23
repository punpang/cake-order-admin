<script setup>
// แท็บ "ระดับ" ในหน้าคะแนน & รางวัล: โหมด · ระดับ/ตัวคูณ · รอบสมาชิก · รายงาน (ทดลอง/ใช้จริง) · ตัวจำลองต้นทุน
import { computed, onMounted, reactive, ref } from 'vue'
import { db, saveMemberLevels } from '../../data/store'
import { MEMBER_MODES, levelCost, memberCfgErrors } from '../../lib/memberLevels'
import { reportRemote } from '../../lib/memberRemote'
import { askConfirm } from '../../lib/confirm'
import { money } from '../../lib/format'
import MoneyInput from '../../components/MoneyInput.vue'
import AppIcon from '../../components/AppIcon.vue'

const MAX_LEVELS = 10
const CYCLE = [
  { k: 'renewGross', l: 'ยอดต่ออายุต่อวัน (ตัวเลขรวม VAT)', u: 'บาท', n: 'VAT 7% → ต้องซื้อ 140 บาทก่อน VAT · ไม่มี VAT → 150 บาท' },
  { k: 'inactiveDays', l: 'ช่วงใช้งานหลังต่ออายุ', u: 'วัน' },
  { k: 'goldenDays', l: 'วันทอง (จำนวนวันหลังช่วงใช้งาน)', u: 'วัน', n: 'ช่วงนี้ซื้อครบเกณฑ์วันเดียวได้สิทธิ์เต็มทันที' },
  { k: 'downgradeDays', l: 'ครบรอบนี้โดยไม่ต่ออายุ = ลด 1 ขั้น', u: 'วัน' },
  { k: 'bigBill', l: 'บิลใหญ่ที่ปลุกสิทธิ์เต็มได้ (ก่อน VAT)', u: 'บาท' },
]

const d = reactive(JSON.parse(JSON.stringify(db.memberLevels)))
const saved = ref(false)
const cfg = () => ({ mode: d.mode, levels: d.levels, renewGross: d.renewGross, inactiveDays: d.inactiveDays, goldenDays: d.goldenDays, downgradeDays: d.downgradeDays, bigBill: d.bigBill, cakeCategories: d.cakeCategories || [] })
// หมวดสินค้าที่มีในร้าน (เลือกเป็นหมวดเค้กสำหรับส่วนลดเดือนเกิด)
const shopCats = [...new Set(db.retailItems.map((x) => x.category).filter(Boolean))]
const toggleCake = (c) => { const a = d.cakeCategories || []; d.cakeCategories = a.includes(c) ? a.filter((x) => x !== c) : [...a, c] }
const errs = computed(() => memberCfgErrors(cfg()))
const modeDesc = computed(() => MEMBER_MODES.find((m) => m.v === d.mode)?.d || '')

// ---------- โหมด / ระดับ ----------
async function setMode(v) {
  if (v === 'live' && d.mode !== 'live' && !(await askConfirm({ title: 'เปิดใช้จริง', message: 'แต้มจะคูณตามระดับของลูกค้าตั้งแต่ออร์เดอร์ที่ส่งมอบถัดไป · ตรวจรายงานโหมดทดลองแล้วหรือยัง', okText: 'เปิดใช้จริง', danger: true }))) return
  d.mode = v
}
function addLevel() {
  const last = d.levels[d.levels.length - 1]
  d.levels.push({ name: `LV${d.levels.length + 1}`, min: (Number(last?.min) || 0) + 1000, mult: (Number(last?.mult) || 1) + 2 })
}
function removeLevel(i) {
  if (d.levels.length <= 1) return
  d.levels.splice(i, 1)
  if (i === 0) d.levels[0].min = 0 // ขั้นแรกต้องเริ่มที่ 0 เสมอ
}

// ---------- บันทึก ----------
function save() {
  if (errs.value.length) return
  const r = saveMemberLevels(cfg())
  if (r.errors) return
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}

// ---------- รายงาน (ผู้จัดการ) ----------
const days = ref(30)
const redeemPct = ref(40)
const rep = ref(null)
const busy = ref(false)
const REPORT_ERR = { forbidden: 'เฉพาะผู้จัดการ', invalid: 'จำนวนวันต้องอยู่ระหว่าง 1–3650 และอัตราแลกคืน 0–100%', offline: 'ยังไม่ได้เชื่อมต่อเซิร์ฟเวอร์' }
const repErr = computed(() => (rep.value?.error ? REPORT_ERR[rep.value.error] || 'โหลดรายงานไม่สำเร็จ' : ''))
async function loadReport() {
  busy.value = true
  rep.value = await reportRemote(Number(days.value), Math.min(100, Math.max(0, Number(redeemPct.value) || 0)) / 100)
  busy.value = false
}
onMounted(loadReport)

// ---------- ตัวจำลองต้นทุน ----------
const sampleBase = ref(1000)
const sim = computed(() => d.levels.map((l, i) => ({
  name: l.name || `ขั้น ${i + 1}`,
  mult: Number(l.mult) || 1,
  ...levelCost({ mult: Number(l.mult) || 1, base: Number(sampleBase.value) || 0, earnPer: db.loyalty.earnPer, pointValue: db.loyalty.pointValue, redeem: (Number(redeemPct.value) || 0) / 100 }),
})))
</script>

<template>
  <div class="space-y-4">
    <section class="card space-y-3">
      <div class="font-semibold text-stone-800">โหมดระดับสมาชิก</div>
      <div class="grid grid-cols-3 gap-1 seg-grid">
        <button
          v-for="m in MEMBER_MODES"
          :key="m.v"
          type="button"
          class="min-h-10 rounded-xl px-1 text-sm font-semibold transition"
          :class="d.mode === m.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'"
          :aria-pressed="d.mode === m.v"
          @click="setMode(m.v)"
        >{{ m.l }}</button>
      </div>
      <p class="text-sm text-stone-500">{{ modeDesc }}</p>
    </section>

    <section class="card space-y-3">
      <div class="flex items-center justify-between">
        <div class="font-semibold text-stone-800">ระดับและตัวคูณแต้ม</div>
        <span class="text-xs text-stone-500">{{ d.levels.length }}/{{ MAX_LEVELS }} ขั้น</span>
      </div>
      <div v-for="(l, i) in d.levels" :key="i" class="grid grid-cols-[1fr_1fr_0.8fr_auto] items-end gap-2">
        <div>
          <label class="label">ชื่อ</label>
          <input v-model="l.name" class="input" maxlength="20" :aria-label="`ชื่อขั้นที่ ${i + 1}`" />
        </div>
        <div>
          <label class="label">ยอดสะสม (฿)</label>
          <MoneyInput v-if="i > 0" v-model.number="l.min" min="0" class="input" :aria-label="`ยอดสะสมขั้นที่ ${i + 1}`" />
          <input v-else class="input" value="0" disabled aria-label="ยอดสะสมขั้นแรก" />
        </div>
        <div>
          <label class="label">ตัวคูณ</label>
          <input v-model.number="l.mult" type="number" inputmode="decimal" min="1" step="0.5" class="input" :aria-label="`ตัวคูณขั้นที่ ${i + 1}`" />
        </div>
        <button type="button" class="btn-outline h-11 px-3" :disabled="d.levels.length <= 1" :aria-label="`ลบขั้นที่ ${i + 1}`" @click="removeLevel(i)">
          <AppIcon name="trash" :size="18" />
        </button>
      </div>
      <button type="button" class="btn-outline w-full" :disabled="d.levels.length >= MAX_LEVELS" @click="addLevel">
        <AppIcon name="plus" :size="18" /> เพิ่มขั้น
      </button>
    </section>

    <section class="card space-y-3">
      <div class="font-semibold text-stone-800">รอบของสมาชิก</div>
      <div v-for="f in CYCLE" :key="f.k">
        <label class="label">{{ f.l }}</label>
        <div class="flex items-center gap-2">
          <MoneyInput v-model.number="d[f.k]" min="0" class="input" />
          <span class="w-14 shrink-0 text-sm text-stone-500">{{ f.u }}</span>
        </div>
        <p v-if="f.n" class="mt-1 text-xs text-stone-500">{{ f.n }}</p>
      </div>
    </section>

    <section class="card space-y-3" aria-label="ส่วนลดเดือนเกิด">
      <div class="font-semibold text-stone-800">ส่วนลดเดือนเกิด (หมวดเค้ก)</div>
      <p class="text-sm text-stone-500">LV3 ลด 5% (สูงสุด 25 บาท) · LV4 ลด 10% (สูงสุด 50 บาท) เฉพาะสินค้าหมวดที่เลือก · ไม่ซ้อนคูปอง ระบบเลือกส่วนลดที่ได้มากกว่า</p>
      <p v-if="!shopCats.length" class="text-sm text-stone-500">ยังไม่มีหมวดสินค้า เพิ่มสินค้าในหน้าสินค้าก่อน</p>
      <div class="flex flex-wrap gap-2">
        <button v-for="c in shopCats" :key="c" type="button" class="chip h-auto py-1" :class="(d.cakeCategories || []).includes(c) ? 'chip-on' : 'chip-off'" :aria-pressed="(d.cakeCategories || []).includes(c)" @click="toggleCake(c)">{{ c }}</button>
      </div>
    </section>

    <p v-if="errs.length" class="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">
      {{ errs[0] }}{{ errs.length > 1 ? ` (และอีก ${errs.length - 1} รายการ)` : '' }}
    </p>
    <button type="button" class="btn-primary w-full" :disabled="errs.length > 0" @click="save">
      <AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึกระดับสมาชิก' }}
    </button>

    <section class="card space-y-3">
      <div class="font-semibold text-stone-800">รายงานสมาชิก</div>
      <div class="grid grid-cols-2 gap-2">
        <div>
          <label class="label">ช่วง (วัน)</label>
          <input v-model.number="days" type="number" inputmode="numeric" min="1" max="3650" class="input" />
        </div>
        <div>
          <label class="label">แลกแต้มจริง (%)</label>
          <input v-model.number="redeemPct" type="number" inputmode="decimal" min="0" max="100" class="input" />
        </div>
      </div>
      <button type="button" class="btn-outline w-full" :disabled="busy" @click="loadReport">{{ busy ? 'กำลังโหลด…' : 'ดูรายงาน' }}</button>
      <p v-if="repErr" class="text-sm text-stone-500">{{ repErr }}</p>
      <div v-else-if="rep?.levels" class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead class="text-left text-xs text-stone-500">
            <tr>
              <th class="py-1 pr-2 font-medium">ระดับ</th>
              <th class="py-1 pr-2 text-right font-medium">คน</th>
              <th class="py-1 pr-2 text-right font-medium">ยอดฐาน</th>
              <th class="py-1 pr-2 text-right font-medium">แต้มเพิ่ม</th>
              <th class="py-1 text-right font-medium">ต้นทุน</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="r in rep.levels" :key="r.levelNo" class="border-t border-stone-100">
              <td class="py-2 pr-2">{{ r.levelName }}</td>
              <td class="py-2 pr-2 text-right">{{ r.members }}</td>
              <td class="py-2 pr-2 text-right">{{ money(r.base) }}</td>
              <td class="py-2 pr-2 text-right">{{ r.extraPoints }}</td>
              <td class="py-2 text-right whitespace-nowrap">
                <div>ส่วนเพิ่ม {{ r.costPct }}%</div>
                <div class="text-xs text-stone-500">สูตรเต็ม {{ r.fullCostPct }}%</div>
              </td>
            </tr>
            <tr class="border-t border-stone-300 font-semibold">
              <td class="py-2 pr-2">รวม</td>
              <td class="py-2 pr-2 text-right">{{ rep.total.members }}</td>
              <td class="py-2 pr-2 text-right">{{ money(rep.total.base) }}</td>
              <td class="py-2 pr-2 text-right">{{ rep.total.extraPoints }}</td>
              <td class="py-2 text-right whitespace-nowrap">
                <div>ส่วนเพิ่ม {{ rep.total.costPct }}%</div>
                <div class="text-xs text-stone-500 font-normal">สูตรเต็ม {{ rep.total.fullCostPct }}%</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-stone-500">ต้นทุนประมาณการเฉพาะแต้มจากตัวคูณ · ส่วนเพิ่ม = แต้มที่เกินแต้มปกติ · สูตรเต็ม = รวมแต้มปกติทั้งหมด · ยังไม่รวมคูปองรายเดือนและค่าส่ง</p>
    </section>

    <section class="card space-y-3">
      <div class="font-semibold text-stone-800">ตัวจำลองต้นทุนต่อระดับ</div>
      <div>
        <label class="label">ยอดซื้อตัวอย่าง (ก่อน VAT)</label>
        <MoneyInput v-model.number="sampleBase" min="0" class="input" />
      </div>
      <ul class="space-y-1 text-sm">
        <li v-for="s in sim" :key="s.name" class="flex justify-between gap-2">
          <span>{{ s.name }} · x{{ s.mult }}</span>
          <span class="text-right text-stone-600">แต้มเพิ่ม {{ s.extraPoints.toFixed(1) }}<br />ส่วนเพิ่ม {{ s.costPct.toFixed(2) }}% · สูตรเต็ม {{ s.fullCostPct.toFixed(2) }}%</span>
        </li>
      </ul>
      <p class="text-xs text-stone-500">คิดจากตั้งค่าคะแนน (ทุกกี่บาทได้ 1 แต้ม {{ db.loyalty.earnPer }} บาท · มูลค่า 1 แต้ม {{ db.loyalty.pointValue }} บาท) และอัตราแลกคืนด้านบน</p>
    </section>
  </div>
</template>
