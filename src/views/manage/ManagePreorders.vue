<script setup>
import { computed, reactive, ref } from 'vue'
import { db } from '../../data/store'
import { preorderCampaigns, savePreorderCampaign, setPreorderCampaignStatus } from '../../data/preorder'
import { blankCampaign, campaignPhase, shipOutsidePickupWarning } from '../../lib/preorderCampaign'
import ManageShell from '../../components/ManageShell.vue'
import PreorderOrdersPanel from './PreorderOrdersPanel.vue'
import PreorderReportsPanel from './PreorderReportsPanel.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// ตั้งและจัดการแคมเปญสั่งล่วงหน้า: รายการแคมเปญ + ฟอร์มสร้าง/แก้ (ตรวจและบันทึกที่ data/preorder.js)
const PHASE = { draft: 'ร่าง', closed: 'ปิดรับ', upcoming: 'รอเปิดรับ', open: 'เปิดรับสั่ง', ended: 'หมดช่วงรับสั่ง' }
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const list = computed(() => preorderCampaigns().map((c) => ({ c, label: PHASE[campaignPhase(c, today())] })))
// สินค้าที่เลือกได้: เปิดขาย ไม่กำหนดราคาเอง ไม่มีตัวเลือก (ตรงกับกติกาใน data/preorder.js)
const sellable = computed(() => db.retailItems.filter((r) => r.active && !r.openPrice && !(r.modifierIds && r.modifierIds.length)))

const form = ref(null)
const ferr = ref('')
const hours = ref('') // เวลาจ่ายมัดจำ เป็นชั่วโมงบนหน้าจอ เก็บเป็นนาที
const sel = reactive({}) // retailId → { on, cap }
const msg = ref('')
const tab = ref('campaigns') // แท็บ: แคมเปญ (ค่าเริ่มต้น) · ออร์เดอร์
// สีป้ายสถานะแคมเปญ (ข้อความเดิมจาก PHASE)
const BADGE = { 'เปิดรับสั่ง': 'bg-emerald-100 text-emerald-800', 'ร่าง': 'bg-stone-100 text-stone-700', 'รอเปิดรับ': 'bg-amber-100 text-amber-800', 'ปิดรับ': 'bg-stone-200 text-stone-700', 'หมดช่วงรับสั่ง': 'bg-stone-200 text-stone-600' }
const badge = (label) => BADGE[label] || 'bg-stone-100 text-stone-700'
const tiers = ref([]) // ขั้นส่วนลดตามยอด (ดีล spend_off เดียวของแคมเปญ) เก็บเป็นข้อความบนหน้าจอ
const parcelOn = ref(false) // ส่งพัสดุไปรษณีย์ (สินค้าทุกชิ้นต้องมีน้ำหนักและขนาด)
const shipWarn = computed(() => (form.value ? shipOutsidePickupWarning({ ...form.value, parcel: { enabled: parcelOn.value } }) : ''))
const addTier = () => tiers.value.push({ min: '', type: 'amount', value: '' })
// ค้นหาและเลือกสินค้าเป็นจำนวนมาก: กรองจากชื่อ เลือกทั้งหมดที่แสดง ล้างที่เลือก (ใช้ได้เมื่อมีสินค้าเป็นร้อยรายการ)
const productQuery = ref('')
const visibleProducts = computed(() => {
  const q = productQuery.value.trim().toLowerCase()
  return q ? sellable.value.filter((r) => String(r.name).toLowerCase().includes(q)) : sellable.value
})
const selectedCount = computed(() => sellable.value.filter((r) => sel[r.id]?.on).length)
const selectedList = computed(() => sellable.value.filter((r) => sel[r.id]?.on))
const nameCount = computed(() => {
  const m = {}
  for (const r of sellable.value) m[r.name] = (m[r.name] || 0) + 1
  return m
})
function selectAllVisible() { for (const r of visibleProducts.value) if (sel[r.id]) sel[r.id].on = true }
function clearSelected() { for (const r of sellable.value) if (sel[r.id]) sel[r.id].on = false }
function unselect(id) { if (sel[id]) sel[id].on = false }
const shipTiers = ref([]) // ขั้นส่วนลดค่าส่งตามยอดซื้อ (ฟิลด์ shipOff ของแคมเปญ · ไม่ปนกับโปรสินค้า)

// รอบเวลา (โหมดเลือกรอบ): เวลากับจำนวนออร์เดอร์ต่อรอบ (ค่าที่กรอกยังเป็นข้อความ แปลงตอนบันทึก)
const roundsIn = ref([])

function openForm(c) {
  ferr.value = ''
  const base = c ? JSON.parse(JSON.stringify(c)) : blankCampaign()
  form.value = { ...base, dayCap: base.dayCap ?? '' }
  roundsIn.value = (base.rounds ?? []).map((r) => ({ time: r.time, cap: String(r.cap) }))
  hours.value = base.payDueMin ? String(base.payDueMin / 60) : ''
  tiers.value = (base.deals?.[0]?.tiers ?? []).map((t) => ({ min: String(t.min), type: t.type, value: String(t.value) }))
  shipTiers.value = (base.shipOff ?? []).map((t) => ({ min: String(t.min), value: String(t.value) }))
  parcelOn.value = base.parcel?.enabled === true
  for (const k of Object.keys(sel)) delete sel[k]
  for (const r of sellable.value) sel[r.id] = { on: false, cap: '' }
  for (const it of base.items || []) sel[it.retailId] = { on: true, cap: it.dayCap ?? '' }
}

function submit() {
  ferr.value = ''
  const f = form.value
  const items = sellable.value
    .filter((r) => sel[r.id].on)
    .map((r) => ({ retailId: r.id, dayCap: sel[r.id].cap === '' ? null : Number(sel[r.id].cap) }))
  const r = savePreorderCampaign({
    ...f,
    depositPercent: Number(f.depositPercent),
    payDueMin: hours.value === '' ? null : Math.round(Number(hours.value) * 60),
    dayCap: f.dayCap === '' ? null : Number(f.dayCap),
    items,
    deals: tiers.value.length ? [{ kind: 'spend_off', name: 'ส่วนลดตามยอด', tiers: tiers.value.map((t) => ({ min: Number(t.min), type: t.type, value: Number(t.value) })) }] : [],
    shipOff: shipTiers.value.map((t) => ({ min: Number(t.min), value: Number(t.value) })),
    parcel: { enabled: parcelOn.value },
    pickupMode: f.pickupMode === 'slot' ? 'slot' : 'day',
    rounds: f.pickupMode === 'slot' ? roundsIn.value.map((r) => ({ time: String(r.time ?? '').trim(), cap: r.cap === '' ? '' : Number(r.cap) })) : [],
  })
  if (r.error) return (ferr.value = r.error)
  msg.value = 'บันทึกแล้ว'
  form.value = null
}

function toggle(c, status) {
  const r = setPreorderCampaignStatus(c.id, status)
  if (r.error) msg.value = r.error
  else msg.value = status === 'open' ? 'เปิดรับสั่งแล้ว' : 'ปิดรับแล้ว'
}
</script>

<template>
  <ManageShell narrow guard :toolbar="false" perm="managePreorder" title="สั่งล่วงหน้า (Preorder)" subtitle="ตั้งแคมเปญ ช่วงรับสั่ง โควตา และมัดจำ">
    <div role="tablist" aria-label="ส่วนของสั่งล่วงหน้า" class="grid grid-cols-3 gap-1 rounded-2xl bg-stone-100 p-1">
      <button type="button" role="tab" :aria-selected="tab === 'campaigns'" class="h-11 rounded-xl text-sm font-medium transition-colors" :class="tab === 'campaigns' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'" @click="tab = 'campaigns'">แคมเปญ</button>
      <button type="button" role="tab" :aria-selected="tab === 'orders'" class="h-11 rounded-xl text-sm font-medium transition-colors" :class="tab === 'orders' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'" @click="tab = 'orders'">ออร์เดอร์</button>
      <button type="button" role="tab" :aria-selected="tab === 'reports'" class="h-11 rounded-xl text-sm font-medium transition-colors" :class="tab === 'reports' ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600'" @click="tab = 'reports'">รายงาน</button>
    </div>
    <PreorderOrdersPanel v-if="tab === 'orders'" class="mt-4" />
    <PreorderReportsPanel v-if="tab === 'reports'" class="mt-4" />
    <section v-if="tab === 'campaigns'" class="mt-4 mb-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold text-stone-900">แคมเปญ</h2>
        <button class="btn-primary h-11 px-4" @click="openForm(null)">+ สร้างแคมเปญ</button>
      </div>
      <p v-if="msg" class="mt-2 text-sm text-stone-600" role="status">{{ msg }}</p>
      <div v-if="!list.length" class="mt-4 rounded-2xl border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">ยังไม่มีแคมเปญ กดสร้างแคมเปญเพื่อเริ่มรับสั่งล่วงหน้า</div>
      <ul class="mt-4 grid gap-3 md:grid-cols-2">
        <li v-for="x in list" :key="x.c.id" class="rounded-2xl border border-stone-200 bg-white p-4" data-campaign>
          <div class="flex items-start justify-between gap-3">
            <h3 class="min-w-0 truncate text-base font-semibold text-stone-900">{{ x.c.name }}</h3>
            <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium" :class="badge(x.label)">{{ x.label }}</span>
          </div>
          <dl class="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div><dt class="text-xs text-stone-500">รับสั่ง</dt><dd class="text-stone-800">{{ x.c.orderFrom }} ถึง {{ x.c.orderTo }}</dd></div>
            <div><dt class="text-xs text-stone-500">รับสินค้า</dt><dd class="text-stone-800">{{ x.c.pickupFrom }} ถึง {{ x.c.pickupTo }}</dd></div>
            <div><dt class="text-xs text-stone-500">มัดจำขั้นต่ำ</dt><dd class="text-stone-800">{{ x.c.depositPercent }}%</dd></div>
            <div><dt class="text-xs text-stone-500">จ่ายภายใน</dt><dd class="text-stone-800">{{ x.c.payDueMin ? x.c.payDueMin / 60 : '-' }} ชม.</dd></div>
            <div v-if="x.c.payLastDate"><dt class="text-xs text-stone-500">ชำระสุดท้าย</dt><dd class="text-stone-800">{{ x.c.payLastDate }}</dd></div>
          </dl>
          <div class="mt-4 flex gap-2">
            <button v-if="x.c.status !== 'open'" class="btn-primary h-11 flex-1" @click="toggle(x.c, 'open')">เปิดรับสั่ง</button>
            <button v-else class="btn-outline h-11 flex-1" @click="toggle(x.c, 'closed')">ปิดรับ</button>
            <button class="btn-outline h-11 px-4" @click="openForm(x.c)">แก้ไข</button>
          </div>
        </li>
      </ul>
    </section>

    <AppModal v-if="form" :title="form.id ? 'แก้ไขแคมเปญ' : 'สร้างแคมเปญ'" wider @close="form = null">
      <div class="space-y-3">
        <h3 class="text-sm font-semibold text-stone-900">ข้อมูลทั่วไป</h3>
        <div><label class="label" for="pp-name">ชื่อแคมเปญ <span class="text-rose-600">*</span></label><input id="pp-name" v-model="form.name" class="input" maxlength="80" /></div>
        <h3 class="border-t border-stone-200 pt-4 text-sm font-semibold text-stone-900">วันและมัดจำ</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="label" for="pp-of">เริ่มรับสั่ง</label><input id="pp-of" v-model="form.orderFrom" type="date" class="input" /></div>
          <div><label class="label" for="pp-ot">สิ้นสุดรับสั่ง</label><input id="pp-ot" v-model="form.orderTo" type="date" class="input" /></div>
          <div><label class="label" for="pp-pf">เริ่มวันรับสินค้า</label><input id="pp-pf" v-model="form.pickupFrom" type="date" class="input" /></div>
          <div><label class="label" for="pp-pt">สิ้นสุดวันรับสินค้า</label><input id="pp-pt" v-model="form.pickupTo" type="date" class="input" /></div>
        </div>
        <fieldset class="space-y-2" :disabled="form.status === 'open'">
          <legend class="label">โหมดรับสินค้า</legend>
          <div class="flex flex-wrap gap-4 text-sm">
            <label class="inline-flex items-center gap-2"><input v-model="form.pickupMode" type="radio" value="day" class="h-5 w-5" /> รับได้ทั้งวัน</label>
            <label class="inline-flex items-center gap-2"><input v-model="form.pickupMode" type="radio" value="slot" class="h-5 w-5" /> เลือกรอบเวลา</label>
          </div>
          <div v-if="form.pickupMode === 'slot'" class="space-y-2" data-rounds-editor>
            <div v-for="(r, i) in roundsIn" :key="i" class="flex flex-wrap items-center gap-2">
              <input v-model="r.time" type="time" class="input w-32" aria-label="เวลารอบ" />
              <input v-model="r.cap" type="number" min="1" class="input w-28" aria-label="จำนวนออร์เดอร์ต่อรอบ" placeholder="จำนวน" />
              <button type="button" class="btn-outline h-11 px-3" aria-label="ลบรอบนี้" @click="roundsIn.splice(i, 1)">ลบ</button>
            </div>
            <button type="button" class="btn-outline h-11 px-3" :disabled="roundsIn.length >= 12" @click="roundsIn.push({ time: '', cap: '' })">+ เพิ่มรอบ</button>
            <p class="text-xs text-stone-500">ลูกค้าเลือกรอบได้ รับได้ตั้งแต่เวลาที่เลือกถึงสิ้นวัน ตั้งได้สูงสุด 12 รอบ</p>
          </div>
        </fieldset>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div><label class="label" for="pp-dep">มัดจำขั้นต่ำ %</label><input id="pp-dep" v-model="form.depositPercent" type="number" min="1" max="100" class="input" /></div>
          <div><label class="label" for="pp-due">จ่ายมัดจำภายใน (ชม.) <span class="text-rose-600">*</span></label><input id="pp-due" v-model="hours" type="number" min="0" step="0.5" class="input" /></div>
          <div><label class="label" for="pp-cap">โควตารวมต่อวัน</label><input id="pp-cap" v-model="form.dayCap" type="number" min="0" class="input" placeholder="ว่าง = ไม่จำกัด" /></div>
        </div>
        <div>
          <label class="label" for="pp-last">วันชำระมัดจำสุดท้าย (ไม่บังคับ)</label>
          <input id="pp-last" v-model="form.payLastDate" type="date" class="input" />
          <p class="mt-1 text-xs text-stone-500">ถ้าตั้งไว้ ลูกค้าต้องชำระภายในวันนั้น แม้เวลาจ่ายภายในยังไม่หมด (ใช้ตามที่เร็วกว่า)</p>
        </div>
        <h3 class="border-t border-stone-200 pt-4 text-sm font-semibold text-stone-900">สินค้า</h3>
        <div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="label">สินค้าในแคมเปญ (เลือกจากสินค้า POS) <span class="text-rose-600">*</span></div>
            <div class="text-sm text-stone-600" data-product-count>เลือกแล้ว {{ selectedCount }} จาก {{ sellable.length }}</div>
          </div>
          <p v-if="!sellable.length" class="text-sm text-stone-500">ไม่มีสินค้าที่ใช้ได้</p>
          <template v-else>
            <input v-model="productQuery" type="search" class="input mt-2 w-full" placeholder="ค้นหาชื่อสินค้า" aria-label="ค้นหาสินค้าในแคมเปญ" />
            <div class="mt-2 flex flex-wrap gap-2">
              <button type="button" class="btn-outline h-11 px-3 text-sm" :disabled="!visibleProducts.length" @click="selectAllVisible">เลือกทั้งหมดที่แสดง ({{ visibleProducts.length }})</button>
              <button type="button" class="btn-outline h-11 px-3 text-sm" :disabled="!selectedCount" @click="clearSelected">ล้างที่เลือก</button>
            </div>
            <div v-if="selectedList.length" class="mt-2 flex flex-wrap gap-2" data-product-chips>
              <button v-for="r in selectedList" :key="'chip-' + r.id" type="button" class="inline-flex h-8 items-center gap-1 rounded-full bg-brand-50 px-3 text-sm text-brand-700" :aria-label="`เอาออก ${r.name}`" @click="unselect(r.id)">
                {{ r.name }}<span aria-hidden="true">×</span>
              </button>
            </div>
            <div class="mt-2 grid max-h-[40vh] grid-cols-1 gap-x-4 overflow-y-auto overscroll-contain rounded-xl border border-stone-200 px-3 sm:grid-cols-2 landscape:max-h-[55vh]" data-product-list>
              <p v-if="!visibleProducts.length" class="col-span-full py-3 text-sm text-stone-500">ไม่พบสินค้าที่ตรงกับคำค้น</p>
              <div v-for="r in visibleProducts" :key="r.id" class="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 border-b border-stone-100 py-2">
                <label class="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-sm">
                  <input v-model="sel[r.id].on" type="checkbox" class="h-5 w-5 shrink-0" :aria-label="`เลือก ${r.name}`" />
                  <span class="min-w-0 truncate">{{ r.name }}<span v-if="nameCount[r.name] > 1" class="ml-1 text-xs text-stone-400">#{{ r.id }}</span></span>
                </label>
                <input v-if="sel[r.id].on" v-model="sel[r.id].cap" type="number" min="0" class="input h-11 w-24" :aria-label="`เพดานต่อวันของ ${r.name}`" placeholder="ไม่จำกัด" />
                <span v-else></span>
              </div>
            </div>
          </template>
        </div>
        <h3 class="border-t border-stone-200 pt-4 text-sm font-semibold text-stone-900">ส่วนลด</h3>
        <div>
          <div class="label">ส่วนลดตามยอดซื้อ (ไม่บังคับ)</div>
          <div v-for="(t, i) in tiers" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-sm text-stone-600">ครบ</span>
            <input v-model="t.min" type="text" inputmode="numeric" class="input h-11 w-24" :aria-label="`ยอดซื้อขั้นต่ำของขั้นส่วนลด ${i + 1}`" />
            <span class="text-sm">ลด</span>
            <input v-model="t.value" type="text" inputmode="decimal" class="input h-11 w-24" :aria-label="`ค่าส่วนลดของขั้น ${i + 1}`" />
            <select v-model="t.type" class="input h-11 w-24" :aria-label="`ประเภทส่วนลดของขั้น ${i + 1}`"><option value="amount">บาท</option><option value="percent">%</option></select>
            <button type="button" class="btn-danger h-11 px-2" :aria-label="`ลบขั้นส่วนลด ${i + 1}`" @click="tiers.splice(i, 1)"><AppIcon name="trash" :size="14" /></button>
          </div>
          <button type="button" class="btn-outline mt-2 h-11 px-3 text-sm" @click="addTier">+ เพิ่มขั้นส่วนลด</button>
          <p class="mt-1 text-xs text-stone-500">ได้ส่วนลดขั้นสูงสุดที่ถึงยอด · ยอดขั้นต่ำต้องไม่ซ้ำกัน · บาทหรือ % ของยอดสินค้า</p>
        </div>
        <div>
          <div class="label">ส่วนลดค่าส่งตามยอดซื้อ (ไม่บังคับ · ใช้กับส่งพัสดุ)</div>
          <div v-for="(t, i) in shipTiers" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-sm text-stone-600">ยอดถึง</span>
            <input v-model="t.min" type="text" inputmode="numeric" class="input h-11 w-24" :aria-label="`ยอดซื้อขั้นที่ ${i + 1} ของส่วนลดค่าส่ง (บาท)`" />
            <span class="text-sm">บาท ลดค่าส่ง</span>
            <input v-model="t.value" type="text" inputmode="decimal" class="input h-11 w-24" :aria-label="`ส่วนลดค่าส่งขั้นที่ ${i + 1} (บาท)`" />
            <span class="text-sm">บาท</span>
            <button type="button" class="btn-danger h-11 px-2" :aria-label="`ลบขั้นส่วนลดค่าส่ง ${i + 1}`" @click="shipTiers.splice(i, 1)"><AppIcon name="trash" :size="14" /></button>
          </div>
          <button type="button" class="btn-outline mt-2 h-11 px-3 text-sm" @click="shipTiers.push({ min: '', value: '' })">+ เพิ่มขั้นส่วนลดค่าส่ง</button>
          <p class="mt-1 text-xs text-stone-500">ได้ส่วนลดขั้นสูงสุดที่ยอดสินค้าหลังหักส่วนลดทุกประเภทและคะแนน ก่อน VAT ถึง · ไม่สะสม · ลดได้ไม่เกินค่าส่ง</p>
        </div>
        <h3 class="border-t border-stone-200 pt-4 text-sm font-semibold text-stone-900">การจัดส่งพัสดุ</h3>
        <AppSwitch v-model="parcelOn" label="ส่งพัสดุไปรษณีย์ (สินค้าทุกชิ้นต้องมีน้ำหนักและขนาด)" class="flex" />
        <div v-if="parcelOn" class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="label" for="pp-sf">เริ่มวันจัดส่งพัสดุ <span class="text-rose-600">*</span></label><input id="pp-sf" v-model="form.shipFrom" type="date" class="input" /></div>
          <div><label class="label" for="pp-st">สิ้นสุดวันจัดส่งพัสดุ <span class="text-rose-600">*</span></label><input id="pp-st" v-model="form.shipTo" type="date" class="input" /></div>
          <p v-if="shipWarn" class="col-span-2 flex items-center gap-2 text-sm text-amber-700" role="status" data-ship-warn><AppIcon name="alert" :size="16" /> {{ shipWarn }}</p>
        </div>
        <p v-if="ferr" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ ferr }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="form = null">ปิด</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="submit">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
