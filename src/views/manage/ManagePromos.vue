<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { computed, reactive, ref } from 'vue'
import { db, savePosDiscount, savePosBundle, savePointPromo, saveDeal, removePromo, DEAL_KINDS } from '../../data/store'
import { describeDeal, dealWarnings } from '../../lib/promoDeals'
import { describeSchedule, promoLive, blankSchedule } from '../../lib/posPromo'
import { money } from '../../lib/format'
import { isSamplePlaceholder } from '../../lib/storefront'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import ScheduleEditor from '../../components/ScheduleEditor.vue'

// โปรโมชัน POS: ส่วนลด · บันเดิ้ล · โปรคะแนนพิเศษ (ตัวคูณ) กำหนดช่วงเวลาได้ · คำนวณอัตโนมัติ
// ต่อสินค้า 1 ชิ้นใช้อันที่ลดมากสุด ไม่ซ้อนกัน (ส่วนลดท้ายบิลซ้อนกับของรายสินค้าได้ · คูปองใช้ต่อจากนี้)
const tab = ref('discount')
const tabs = [{ v: 'discount', l: 'ส่วนลด' }, { v: 'bundle', l: 'บันเดิ้ล' }, { v: 'deal', l: 'ดีล' }, { v: 'point', l: 'คะแนนพิเศษ' }]
const SCOPES = { items: 'สินค้าที่เลือก', category: 'ทั้งหมวด', all: 'ทุกสินค้า', bill: 'ท้ายบิล' }
const items = computed(() => db.retailItems.filter((x) => x.active !== false))
const categories = computed(() => [...new Set(db.retailItems.map((x) => x.category).filter(Boolean))])
const nameOf = (id) => db.retailItems.find((x) => x.id === id)?.name || '(สินค้าถูกลบ)'
const priceOf = (id) => db.retailItems.find((x) => x.id === id)?.price || 0
const regularOf = (b) => b.items.reduce((s, i) => s + priceOf(i.itemId) * (Number(i.qty) || 1), 0)
// ตรวจชุดบันเดิ้ล: ราคาชุดไม่ต่ำกว่าราคาปกติแล้ว (ราคาสินค้าเปลี่ยน) · สินค้าถูกลบ · ชุดที่ใช้สินค้าซ้ำกัน (ระบบเลือกการจัดชุดที่ประหยัดรวมมากสุดให้ ชิ้นหนึ่งอยู่ได้ชุดเดียว)
const warnings = (b) => {
  const w = []
  if (b.items.some((i) => !db.retailItems.some((x) => x.id === i.itemId))) w.push('มีสินค้าที่ถูกลบ')
  else if (!(b.price < regularOf(b))) w.push('ราคาชุดไม่ต่ำกว่าราคาปกติแล้ว (ชุดนี้จะไม่ถูกใช้)')
  const mine = new Set(b.items.map((i) => i.itemId))
  const near = db.posBundles.filter((o) => o.id !== b.id && o.items.some((i) => mine.has(i.itemId)))
  if (near.length) w.push(`ใช้สินค้าซ้ำกับ: ${near.map((o) => o.name).join(', ')}`)
  return w
}

const lists = computed(() => ({ discount: db.posDiscounts, bundle: db.posBundles, deal: db.posDeals, point: db.pointPromos }))
const scopeText = (x) => (x.scope === 'items' ? (x.itemIds || []).map(nameOf).join(', ') || '-' : x.scope === 'category' ? (x.categories || []).join(', ') || '-' : SCOPES[x.scope])
const summary = (x) => {
  if (tab.value === 'discount') return `${x.type === 'percent' ? `ลด ${x.value}%` : `ลด ${money(x.value)}`} · ${SCOPES[x.scope]}${x.scope === 'items' || x.scope === 'category' ? `: ${scopeText(x)}` : ''}${x.minSpend ? ` · ขั้นต่ำ ${money(x.minSpend)}` : ''}`
  if (tab.value === 'deal') return `${DEAL_KINDS[x.kind]} · ${describeDeal(x, nameOf)}`
  if (tab.value === 'bundle') return `${x.items.map((i) => `${nameOf(i.itemId)}${i.qty > 1 ? ` ×${i.qty}` : ''}`).join(' + ')} = ${money(x.price)} · ราคาเต็ม ${money(regularOf(x))} · ประหยัด ${money(regularOf(x) - x.price)}`
  return `คะแนน ×${x.multiplier} · ${SCOPES[x.scope] || ''}${x.scope === 'all' ? '' : `: ${scopeText(x)}`}`
}

// ---------- ฟอร์ม ----------
const open = ref(false)
const err = ref('')
const blank = () => ({ id: null, name: '', active: true, schedule: blankSchedule(), type: 'percent', value: '', scope: 'items', itemIds: [], categories: [], minSpend: '', items: [{ itemId: '', qty: 1 }, { itemId: '', qty: 1 }], price: '', kind: 'bogo', buyQty: '3', giftQty: '1', giftItemId: '', repeat: true, maxGifts: '', n: '3', percent: '100', tiers: [{ min: '', type: 'amount', value: '' }], min: '', itemId: '', limit: '1', multiplier: '2' })
const f = reactive(blank())
function edit(x) {
  err.value = ''
  const b = blank()
  Object.assign(f, b, x ? JSON.parse(JSON.stringify(x)) : {}, x ? { value: String(x.value ?? ''), minSpend: x.minSpend ? String(x.minSpend) : '', price: String(x.price ?? ''), multiplier: String(x.multiplier ?? '2'), ...(x.kind ? { buyQty: String(x.buyQty ?? '3'), giftQty: String(x.giftQty ?? '1'), maxGifts: x.maxGifts ? String(x.maxGifts) : '', n: String(x.n ?? '3'), percent: String(x.percent ?? '100'), min: String(x.min ?? ''), limit: String(x.limit ?? '1'), tiers: (x.tiers || []).map((t) => ({ min: String(t.min), type: t.type, value: String(t.value) })) } : {}), schedule: { ...blankSchedule(), ...(x.schedule || {}), days: [...(x.schedule?.days || [])] } } : {})
  if (tab.value === 'point' && !x) f.scope = 'category'
  open.value = true
}
const toggle = (list, id) => (list.includes(id) ? list.splice(list.indexOf(id), 1) : list.push(id))
const regular = computed(() => f.items.reduce((s, x) => s + priceOf(x.itemId) * (Number(x.qty) || 0), 0))
const saving = computed(() => (regular.value && f.price !== '' ? regular.value - Number(f.price) : 0))
function save() {
  const fn = { discount: savePosDiscount, bundle: savePosBundle, deal: saveDeal, point: savePointPromo }[tab.value]
  const r = fn({ ...JSON.parse(JSON.stringify(f)) })
  if (r.ok) open.value = false
  else err.value = r.error
}
async function del(x) {
  if (await askConfirm({ title: 'ลบโปร', message: x.name, okText: 'ลบ', danger: true })) {
    removePromo(tab.value, x.id)
    open.value = false
  }
}
async function flip(x) {
  x.active = x.active === false
}
</script>

<template>
  <ManageShell title="โปรโมชัน POS / คะแนนพิเศษ" subtitle="ตั้งเวลาได้ · คำนวณอัตโนมัติใน POS" :toolbar="false" :add-label="tab === 'discount' ? 'เพิ่มส่วนลด' : tab === 'bundle' ? 'เพิ่มบันเดิ้ล' : tab === 'deal' ? 'เพิ่มดีล' : 'เพิ่มโปรคะแนน'" @add="edit(null)">
    <div class="mb-4 grid grid-cols-2 gap-1 sm:grid-cols-4 seg-grid">
      <button v-for="t in tabs" :key="t.v" type="button" class="h-10 rounded-xl text-sm font-semibold transition" :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="tab = t.v">{{ t.l }} ({{ lists[t.v].length }})</button>
    </div>
    <p class="mb-3 rounded-xl bg-stone-50 p-3 text-xs text-stone-600">
      <template v-if="tab === 'discount'">ส่วนลดรายสินค้า/หมวด: ต่อสินค้า 1 ชิ้นใช้อันที่ลดมากสุด ไม่ซ้อนกัน · "ท้ายบิล" ลดจากยอดหลังส่วนลดรายสินค้า ซ้อนกันได้ แต่ใช้อันที่ลดมากสุดเพียงอันเดียว · ขั้นต่ำเทียบยอดสินค้าก่อนลด</template>
      <template v-else-if="tab === 'deal'">ดีล: ซื้อแถม · ชิ้นที่ N ลด · ซื้อครบลด/ฟรี/ราคาพิเศษ · ส่งฟรี — ใช้ได้ทั้ง POS และออร์เดอร์ (สินค้าสำเร็จ + ยอดทั้งบิลรวมเค้กสั่งทำ) · สินค้า 1 ชิ้นใช้ได้โปรรายชิ้นเดียว (ลดมากสุด) แต่ดีลตามยอดและของแถมซ้อนได้ · ของแถมแสดงเป็นแถวราคา 0 และตัดสต็อก</template>
      <template v-else-if="tab === 'bundle'">บันเดิ้ล: ซื้อสินค้าครบชุดได้ราคาชุด ระบบจัดชุดให้อัตโนมัติ และใช้ก็ต่อเมื่อประหยัดกว่าส่วนลดรายสินค้าของสินค้าชิ้นนั้น</template>
      <template v-else>โปรคะแนนพิเศษ: คูณคะแนนที่ได้จากยอดสินค้านั้น (หลังส่วนลดทุกประเภท) หลายโปรซ้อนกันใช้ตัวคูณสูงสุด · นับตามเวลาที่สร้างออร์เดอร์</template>
    </p>

    <p v-if="!lists[tab].length" class="card py-10 text-center text-stone-500">ยังไม่มีรายการ กดปุ่มเพิ่มด้านบน</p>
    <div class="grid gap-2.5 lg:grid-cols-2 lg:items-start">
      <div v-for="x in lists[tab]" :key="x.id" class="card flex items-center gap-2 p-2.5" :class="x.active === false ? 'opacity-60' : ''">
        <button type="button" class="min-w-0 flex-1 rounded-xl p-1.5 text-left" @click="edit(x)">
          <span class="flex flex-wrap items-center gap-1.5">
            <span class="font-medium text-stone-900">{{ x.name }}</span>
            <span v-if="x.active === false" class="rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิด</span>
            <span v-else-if="promoLive(x)" class="rounded-full bg-success-50 px-2 py-0.5 text-xs text-success-700">ใช้อยู่ตอนนี้</span>
            <span v-else class="rounded-full bg-warning-50 px-2 py-0.5 text-xs text-warning-700">นอกช่วงเวลา</span>
            <span v-if="x.active !== false && isSamplePlaceholder(x.name)" class="rounded-full bg-warning-50 px-2 py-0.5 text-xs text-warning-700">ชื่อยังเป็นตัวอย่าง · แก้ก่อนใช้จริง</span>
          </span>
          <span class="mt-0.5 block text-sm text-stone-600">{{ summary(x) }}</span>
          <span v-for="w in (tab === 'bundle' ? warnings(x) : tab === 'deal' ? dealWarnings(x, db.retailItems) : [])" :key="w" class="mt-0.5 block text-xs text-warning-700">⚠ {{ w }}</span>
          <span class="block text-xs text-stone-400">{{ describeSchedule(x.schedule) }}</span>
        </button>
        <AppSwitch :model-value="x.active !== false" aria-label="เปิด/ปิด" @update:model-value="flip(x)" />
      </div>
    </div>

    <AppModal v-if="open" wider :title="`${f.id ? 'แก้ไข' : 'เพิ่ม'}${tab === 'discount' ? 'ส่วนลด' : tab === 'bundle' ? 'บันเดิ้ล' : tab === 'deal' ? 'ดีล' : 'โปรคะแนนพิเศษ'}`" @close="open = false">
      <div class="space-y-4 dlg-cols">
        <div><label class="label">ชื่อ <span class="text-danger-700">*</span></label><input v-model="f.name" class="input" maxlength="80" /></div>

        <!-- ส่วนลด -->
        <template v-if="tab === 'discount'">
          <div class="grid grid-cols-2 gap-1 seg-grid">
            <button v-for="t in [{ v: 'percent', l: 'ลดเป็น %' }, { v: 'amount', l: 'ลดเป็นบาท' }]" :key="t.v" type="button" class="h-9 rounded-lg text-sm font-medium" :class="f.type === t.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="f.type = t.v">{{ t.l }}</button>
          </div>
          <div class="grid grid-cols-2 gap-3">
            <div><label class="label">{{ f.type === 'percent' ? 'เปอร์เซ็นต์' : 'บาท' }}</label><MoneyInput v-model="f.value" class="input" /></div>
            <div><label class="label">ยอดสินค้าขั้นต่ำ (บาท)</label><MoneyInput v-model="f.minSpend" class="input" placeholder="ไม่มีขั้นต่ำ" /></div>
          </div>
        </template>

        <!-- บันเดิ้ล -->
        <template v-else-if="tab === 'bundle'">
          <div>
            <div class="label">สินค้าในชุด (อย่างน้อย 2 ชิ้น)</div>
            <div class="space-y-2">
              <div v-for="(x, i) in f.items" :key="i" class="flex items-center gap-2">
                <select v-model="x.itemId" class="input min-w-0 flex-1">
                  <option value="" disabled>เลือกสินค้า</option>
                  <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }} · {{ money(p.price) }}</option>
                </select>
                <input v-model.number="x.qty" type="text" v-num class="input w-16 shrink-0 text-center" aria-label="จำนวน" />
                <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบ" @click="f.items.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
              </div>
            </div>
            <button type="button" class="btn-soft mt-2 h-9 w-full" @click="f.items.push({ itemId: '', qty: 1 })"><AppIcon name="plus" :size="16" /> เพิ่มสินค้า</button>
          </div>
          <div>
            <label class="label">ราคาชุด (บาท)</label>
            <MoneyInput v-model="f.price" class="input" />
            <p class="mt-1 text-xs" :class="saving > 0 ? 'text-success-700' : 'text-stone-400'">ราคาปกติรวม {{ money(regular) }}<template v-if="saving > 0"> · ประหยัด {{ money(saving) }}</template></p>
          </div>
        </template>

        <!-- ดีล -->
        <template v-else-if="tab === 'deal'">
          <div>
            <label class="label" for="deal-kind">ประเภทดีล</label>
            <select id="deal-kind" v-model="f.kind" class="input" :disabled="!!f.id">
              <option v-for="(l, k) in DEAL_KINDS" :key="k" :value="k">{{ l }}</option>
            </select>
          </div>
          <template v-if="f.kind === 'bogo'">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">ซื้อ (ชิ้น)</label><input v-model="f.buyQty" type="text" v-num class="input" /></div>
              <div><label class="label">แถม (ชิ้น)</label><input v-model="f.giftQty" type="text" v-num class="input" /></div>
            </div>
            <div>
              <label class="label" for="deal-gift">สินค้าที่แถม</label>
              <select id="deal-gift" v-model="f.giftItemId" class="input">
                <option value="">ชิ้นเดียวกับที่ซื้อ</option>
                <option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }} · {{ money(p.price) }}</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">แถมสูงสุดต่อบิล</label><input v-model="f.maxGifts" type="text" v-num class="input" placeholder="ไม่จำกัด" /></div>
              <AppSwitch v-model="f.repeat" label="แถมซ้ำทุกครบรอบ" class="flex self-end pb-3" />
            </div>
          </template>
          <template v-else-if="f.kind === 'nth'">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">ชิ้นที่ (N)</label><input v-model="f.n" type="text" v-num class="input" /></div>
              <div><label class="label">ลด (%)</label><MoneyInput v-model="f.percent" class="input" /></div>
            </div>
            <p class="text-xs text-stone-500">ทุก {{ f.n || 'N' }} ชิ้น ชิ้นที่ถูกสุดในกลุ่มลด {{ f.percent || '–' }}% (100% = ซื้อ {{ f.n || 'N' }} จ่าย {{ (Number(f.n) || 1) - 1 }})</p>
          </template>
          <template v-else-if="f.kind === 'spend_off'">
            <div class="label">ขั้นส่วนลด (ใช้ขั้นสูงสุดที่ยอดถึง)</div>
            <div class="space-y-2">
              <div v-for="(t, i) in f.tiers" :key="i" class="flex items-center gap-2">
                <MoneyInput v-model="t.min" class="input min-w-0 flex-1" placeholder="ครบ (บาท)" :aria-label="`ขั้น ${i + 1} ยอดครบ`" />
                <select v-model="t.type" class="input w-24 shrink-0" :aria-label="`ขั้น ${i + 1} ชนิดส่วนลด`"><option value="amount">ลด ฿</option><option value="percent">ลด %</option></select>
                <MoneyInput v-model="t.value" class="input w-20 shrink-0" placeholder="ลด" :aria-label="`ขั้น ${i + 1} ส่วนลด`" />
                <button type="button" class="btn-danger h-11 w-11 shrink-0 px-0" aria-label="ลบขั้น" :disabled="f.tiers.length <= 1" @click="f.tiers.splice(i, 1)"><AppIcon name="trash" :size="16" /></button>
              </div>
            </div>
            <button type="button" class="btn-soft mt-2 h-9 w-full" @click="f.tiers.push({ min: '', type: 'amount', value: '' })"><AppIcon name="plus" :size="16" /> เพิ่มขั้น</button>
          </template>
          <template v-else-if="f.kind === 'spend_free'">
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">ซื้อครบ (บาท)</label><MoneyInput v-model="f.min" class="input" /></div>
              <div><label class="label">จำนวนที่ฟรี</label><input v-model="f.giftQty" type="text" v-num class="input" /></div>
            </div>
            <div>
              <label class="label" for="deal-free">สินค้าที่ฟรี</label>
              <select id="deal-free" v-model="f.giftItemId" class="input"><option value="" disabled>เลือกสินค้า</option><option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }} · {{ money(p.price) }}</option></select>
            </div>
          </template>
          <template v-else-if="f.kind === 'spend_addon'">
            <div><label class="label">ซื้อครบ (บาท)</label><MoneyInput v-model="f.min" class="input" /></div>
            <div>
              <label class="label" for="deal-addon">สินค้าที่ขายราคาพิเศษ</label>
              <select id="deal-addon" v-model="f.itemId" class="input"><option value="" disabled>เลือกสินค้า</option><option v-for="p in items" :key="p.id" :value="p.id">{{ p.name }} · {{ money(p.price) }}</option></select>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div><label class="label">ราคาพิเศษ (บาท)</label><MoneyInput v-model="f.price" class="input" /></div>
              <div><label class="label">สูงสุดต่อบิล (ชิ้น)</label><input v-model="f.limit" type="text" v-num class="input" /></div>
            </div>
          </template>
          <template v-else-if="f.kind === 'free_ship'">
            <div><label class="label">ซื้อครบ (บาท)</label><MoneyInput v-model="f.min" class="input" /></div>
            <p class="text-xs text-stone-500">ใช้กับออร์เดอร์ที่จัดส่งเท่านั้น · ค่าส่งเป็น 0 เมื่อยอดสินค้าถึงเกณฑ์</p>
          </template>
        </template>

        <!-- คะแนนพิเศษ -->
        <template v-else>
          <div><label class="label">ตัวคูณคะแนน (เช่น 2 = สองเท่า)</label><MoneyInput v-model="f.multiplier" class="input" /></div>
        </template>

        <!-- ขอบเขต -->
        <div v-if="tab !== 'bundle' && (tab !== 'deal' || ['bogo', 'nth'].includes(f.kind))">
          <div class="label">ใช้กับ</div>
          <div class="flex flex-wrap gap-1.5">
            <button v-for="(l, k) in SCOPES" v-show="k !== 'bill' || tab === 'discount'" :key="k" type="button" class="chip" :class="f.scope === k ? 'chip-on' : 'chip-off'" @click="f.scope = k">{{ l }}</button>
          </div>
          <div v-if="f.scope === 'items'" class="mt-2 flex max-h-40 flex-wrap gap-1.5 overflow-y-auto">
            <button v-for="p in items" :key="p.id" type="button" class="chip" :class="f.itemIds.includes(p.id) ? 'chip-on' : 'chip-off'" @click="toggle(f.itemIds, p.id)">{{ p.name }}</button>
          </div>
          <div v-else-if="f.scope === 'category'" class="mt-2">
            <div class="label">เลือกหมวดที่ใช้</div>
            <div class="flex flex-wrap gap-1.5">
              <button v-for="c in categories" :key="c" type="button" class="chip" :class="f.categories.includes(c) ? 'chip-on' : 'chip-off'" @click="toggle(f.categories, c)">{{ c }}</button>
            </div>
          </div>
        </div>

        <div><div class="label">ช่วงเวลา</div><ScheduleEditor v-model="f.schedule" /></div>
        <AppSwitch v-model="f.active" label="เปิดใช้งาน" class="flex" />
        <p v-if="err" class="flex items-center gap-2 text-sm text-danger-700"><AppIcon name="alert" :size="16" /> {{ err }}</p>
      </div>
      <template #footer>
        <button v-if="f.id" class="btn-danger mr-auto" @click="del(f)">ลบ</button>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
