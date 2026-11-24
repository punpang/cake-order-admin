<script setup>
import { computed, reactive, ref } from 'vue'
import { db } from '../../data/store'
import { preorderCampaigns, savePreorderCampaign, setPreorderCampaignStatus } from '../../data/preorder'
import { blankCampaign, campaignPhase, shipOutsidePickupWarning } from '../../lib/preorderCampaign'
import ManageShell from '../../components/ManageShell.vue'
import PreorderOrdersPanel from './PreorderOrdersPanel.vue'
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
const tiers = ref([]) // ขั้นส่วนลดตามยอด (ดีล spend_off เดียวของแคมเปญ) เก็บเป็นข้อความบนหน้าจอ
const parcelOn = ref(false) // ส่งพัสดุไปรษณีย์ (สินค้าทุกชิ้นต้องมีน้ำหนักและขนาด)
const shipWarn = computed(() => (form.value ? shipOutsidePickupWarning({ ...form.value, parcel: { enabled: parcelOn.value } }) : ''))
const addTier = () => tiers.value.push({ min: '', type: 'amount', value: '' })
const shipTiers = ref([]) // ขั้นส่วนลดค่าส่งตามยอดซื้อ (ฟิลด์ shipOff ของแคมเปญ · ไม่ปนกับโปรสินค้า)

function openForm(c) {
  ferr.value = ''
  const base = c ? JSON.parse(JSON.stringify(c)) : blankCampaign()
  form.value = { ...base, dayCap: base.dayCap ?? '' }
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
    <PreorderOrdersPanel />
    <section class="card mb-4">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-base font-semibold text-stone-800">แคมเปญ</h2>
        <button class="btn-primary h-9 px-3" @click="openForm(null)">+ สร้างแคมเปญ</button>
      </div>
      <p v-if="msg" class="mt-2 text-sm text-stone-600" role="status">{{ msg }}</p>
      <p v-if="!list.length" class="mt-3 text-sm text-stone-500">ยังไม่มีแคมเปญ</p>
      <ul class="mt-3 space-y-2">
        <li v-for="x in list" :key="x.c.id" class="rounded-xl border border-stone-200 p-3" data-campaign>
          <div class="flex items-center justify-between gap-2">
            <div class="min-w-0">
              <div class="truncate font-medium text-stone-900">{{ x.c.name }}</div>
              <div class="text-xs text-stone-500">รับสั่ง {{ x.c.orderFrom }} ถึง {{ x.c.orderTo }} · รับสินค้า {{ x.c.pickupFrom }} ถึง {{ x.c.pickupTo }}</div>
              <div class="text-xs text-stone-500">มัดจำขั้นต่ำ {{ x.c.depositPercent }}% · จ่ายภายใน {{ x.c.payDueMin ? x.c.payDueMin / 60 : '-' }} ชม.</div>
            </div>
            <span class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-700">{{ x.label }}</span>
          </div>
          <div class="mt-2 flex flex-wrap gap-2">
            <button class="btn-outline h-9 px-3" @click="openForm(x.c)">แก้ไข</button>
            <button v-if="x.c.status !== 'open'" class="btn-primary h-9 px-3" @click="toggle(x.c, 'open')">เปิดรับสั่ง</button>
            <button v-else class="btn-outline h-9 px-3" @click="toggle(x.c, 'closed')">ปิดรับ</button>
          </div>
        </li>
      </ul>
    </section>

    <AppModal v-if="form" :title="form.id ? 'แก้ไขแคมเปญ' : 'สร้างแคมเปญ'" wider @close="form = null">
      <div class="space-y-3">
        <div><label class="label" for="pp-name">ชื่อแคมเปญ <span class="text-rose-600">*</span></label><input id="pp-name" v-model="form.name" class="input" maxlength="80" /></div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label" for="pp-of">เริ่มรับสั่ง</label><input id="pp-of" v-model="form.orderFrom" type="date" class="input" /></div>
          <div><label class="label" for="pp-ot">สิ้นสุดรับสั่ง</label><input id="pp-ot" v-model="form.orderTo" type="date" class="input" /></div>
          <div><label class="label" for="pp-pf">เริ่มวันรับสินค้า</label><input id="pp-pf" v-model="form.pickupFrom" type="date" class="input" /></div>
          <div><label class="label" for="pp-pt">สิ้นสุดวันรับสินค้า</label><input id="pp-pt" v-model="form.pickupTo" type="date" class="input" /></div>
        </div>
        <div class="grid grid-cols-3 gap-3">
          <div><label class="label" for="pp-dep">มัดจำขั้นต่ำ %</label><input id="pp-dep" v-model="form.depositPercent" type="number" min="1" max="100" class="input" /></div>
          <div><label class="label" for="pp-due">จ่ายมัดจำภายใน (ชม.) <span class="text-rose-600">*</span></label><input id="pp-due" v-model="hours" type="number" min="0" step="0.5" class="input" /></div>
          <div><label class="label" for="pp-cap">โควตารวมต่อวัน</label><input id="pp-cap" v-model="form.dayCap" type="number" min="0" class="input" placeholder="ว่าง = ไม่จำกัด" /></div>
        </div>
        <div>
          <div class="label">สินค้าในแคมเปญ (เลือกจากสินค้า POS) <span class="text-rose-600">*</span></div>
          <p v-if="!sellable.length" class="text-sm text-stone-500">ไม่มีสินค้าที่ใช้ได้</p>
          <div v-for="r in sellable" :key="r.id" class="flex items-center gap-3 border-b border-stone-100 py-2">
            <label class="flex min-w-0 flex-1 items-center gap-2 text-sm">
              <input v-model="sel[r.id].on" type="checkbox" class="h-4 w-4" :aria-label="`เลือก ${r.name}`" />
              <span class="truncate">{{ r.name }}</span>
            </label>
            <input v-if="sel[r.id].on" v-model="sel[r.id].cap" type="number" min="0" class="input h-9 w-24" :aria-label="`เพดานต่อวันของ ${r.name}`" placeholder="ไม่จำกัด" />
          </div>
        </div>
        <div>
          <div class="label">ส่วนลดตามยอดซื้อ (ไม่บังคับ)</div>
          <div v-for="(t, i) in tiers" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-sm text-stone-600">ครบ</span>
            <input v-model="t.min" type="text" inputmode="numeric" class="input h-9 w-24" :aria-label="`ยอดซื้อขั้นต่ำของขั้นส่วนลด ${i + 1}`" />
            <span class="text-sm">ลด</span>
            <input v-model="t.value" type="text" inputmode="decimal" class="input h-9 w-24" :aria-label="`ค่าส่วนลดของขั้น ${i + 1}`" />
            <select v-model="t.type" class="input h-9 w-24" :aria-label="`ประเภทส่วนลดของขั้น ${i + 1}`"><option value="amount">บาท</option><option value="percent">%</option></select>
            <button type="button" class="btn-danger h-9 px-2" :aria-label="`ลบขั้นส่วนลด ${i + 1}`" @click="tiers.splice(i, 1)"><AppIcon name="trash" :size="14" /></button>
          </div>
          <button type="button" class="btn-outline mt-2 h-9 px-3 text-sm" @click="addTier">+ เพิ่มขั้นส่วนลด</button>
          <p class="mt-1 text-xs text-stone-500">ได้ส่วนลดขั้นสูงสุดที่ถึงยอด · ยอดขั้นต่ำต้องไม่ซ้ำกัน · บาทหรือ % ของยอดสินค้า</p>
        </div>
        <div>
          <div class="label">ส่วนลดค่าส่งตามยอดซื้อ (ไม่บังคับ · ใช้กับส่งพัสดุ)</div>
          <div v-for="(t, i) in shipTiers" :key="i" class="mt-2 flex flex-wrap items-center gap-2">
            <span class="text-sm text-stone-600">ยอดถึง</span>
            <input v-model="t.min" type="text" inputmode="numeric" class="input h-9 w-24" :aria-label="`ยอดซื้อขั้นที่ ${i + 1} ของส่วนลดค่าส่ง (บาท)`" />
            <span class="text-sm">บาท ลดค่าส่ง</span>
            <input v-model="t.value" type="text" inputmode="decimal" class="input h-9 w-24" :aria-label="`ส่วนลดค่าส่งขั้นที่ ${i + 1} (บาท)`" />
            <span class="text-sm">บาท</span>
            <button type="button" class="btn-danger h-9 px-2" :aria-label="`ลบขั้นส่วนลดค่าส่ง ${i + 1}`" @click="shipTiers.splice(i, 1)"><AppIcon name="trash" :size="14" /></button>
          </div>
          <button type="button" class="btn-outline mt-2 h-9 px-3 text-sm" @click="shipTiers.push({ min: '', value: '' })">+ เพิ่มขั้นส่วนลดค่าส่ง</button>
          <p class="mt-1 text-xs text-stone-500">ได้ส่วนลดขั้นสูงสุดที่ยอดสินค้าหลังหักส่วนลดทุกประเภทและคะแนน ก่อน VAT ถึง · ไม่สะสม · ลดได้ไม่เกินค่าส่ง</p>
        </div>
        <AppSwitch v-model="parcelOn" label="ส่งพัสดุไปรษณีย์ (สินค้าทุกชิ้นต้องมีน้ำหนักและขนาด)" class="flex" />
        <div v-if="parcelOn" class="grid grid-cols-2 gap-3">
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
