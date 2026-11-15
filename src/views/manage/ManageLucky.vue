<script setup>
// ลุ้นโชคท้ายบิล (แอดมิน): เปิด/ปิด ช่วงเวลา URL หน้าเว็บ อายุรหัสรางวัล · ทุกกี่บาทลุ้นได้ 1 ครั้ง · สินค้าที่ร่วมรายการ · รางวัลและโอกาส · สถิติ
import { computed, reactive, ref } from 'vue'
import { db, saveLuckyDraw } from '../../data/store'
import { luckyDefaults, LUCKY_SITE_URL, MAX_DRAWS_PER_BILL } from '../../lib/luckyDraw'
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

const base = { ...luckyDefaults(), ...(db.shop.luckyDraw || {}) }
const st = reactive({
  enabled: !!base.enabled, fromL: toLocal(base.from), toL: toLocal(base.to),
  siteUrl: base.siteUrl || LUCKY_SITE_URL, prizeDays: base.prizeDays || 30,
  perBaht: base.perBaht || 100,
  itemIds: [...(base.itemIds || [])],
  prizes: (base.prizes || []).map((p) => ({ id: p.id, name: p.name, kind: p.kind || 'item', amount: p.amount || 0, chance: p.chance || 0 })),
})
const msg = ref('')
const ok = ref(false)

// ---------- สินค้าที่ร่วมรายการ (จัดกลุ่มตามหมวด · ค้นหาได้) ----------
const itemQuery = ref('')
const itemGroups = computed(() => {
  const q = itemQuery.value.trim().toLowerCase()
  const groups = new Map()
  for (const x of db.retailItems || []) {
    if (x.active === false) continue
    if (q && !String(x.name).toLowerCase().includes(q)) continue
    const key = x.category || 'ไม่มีหมวด'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(x)
  }
  return [...groups.entries()].map(([category, items]) => ({ category, items }))
})
const isPicked = (id) => st.itemIds.includes(id)
function togglePick(id) {
  st.itemIds = isPicked(id) ? st.itemIds.filter((x) => x !== id) : [...st.itemIds, id]
}
const pickedNames = computed(() => st.itemIds.map((id) => db.retailItems.find((x) => x.id === id)?.name || id))

// ---------- รางวัลและโอกาส ----------
const sumChance = computed(() => st.prizes.reduce((s, p) => s + (Number(p.chance) || 0), 0))
const noPrize = computed(() => Math.max(0, Math.round((100 - sumChance.value) * 100) / 100))
const KINDS = [{ v: 'points', l: 'คะแนนสะสม' }, { v: 'coupon', l: 'คูปองส่วนลด' }, { v: 'item', l: 'ของ/อื่น ๆ' }]
function addPrize() { st.prizes.push({ id: '', name: '', kind: 'item', amount: 0, chance: 0 }) }
function removePrize(i) { st.prizes.splice(i, 1) }

// ---------- สถิติ ----------
const stats = computed(() => {
  const recs = db.luckyTokens || []
  const spins = recs.flatMap((r) => r.spins || [])
  return {
    bills: recs.length,
    spins: spins.length,
    won: spins.filter((s) => s.prize).length,
    redeemed: spins.filter((s) => s.redeemedAt).length,
  }
})

function save() {
  const r = saveLuckyDraw({
    enabled: st.enabled, from: toIso(st.fromL), to: toIso(st.toL), siteUrl: st.siteUrl, prizeDays: st.prizeDays,
    perBaht: st.perBaht, itemIds: st.itemIds, prizes: st.prizes,
  })
  ok.value = !r.error
  msg.value = r.error || 'บันทึกแล้ว'
}
</script>

<template>
  <ManageShell title="ลุ้นโชคท้ายบิล" subtitle="QR ท้ายใบเสร็จ → หน้าลุ้นโชคของบิลนั้น" back="/admin/settings" narrow :toolbar="false">
    <div class="space-y-4">
      <section class="card space-y-4">
        <div class="card-title">ตั้งค่า</div>
        <AppSwitch v-model="st.enabled" label="เปิดลุ้นโชคท้ายบิล" aria-label="เปิดลุ้นโชคท้ายบิล" />
        <div class="grid gap-3 sm:grid-cols-2">
          <div>
            <label class="label" for="lk-from">เริ่มลุ้นตั้งแต่</label>
            <input id="lk-from" v-model="st.fromL" type="datetime-local" class="input h-11" />
          </div>
          <div>
            <label class="label" for="lk-to">ถึงเวลา (สิ้นสุด)</label>
            <input id="lk-to" v-model="st.toL" type="datetime-local" class="input h-11" />
          </div>
        </div>
        <div class="grid gap-3 sm:grid-cols-3">
          <div>
            <label class="label" for="lk-per">ทุกกี่บาทลุ้นได้ 1 ครั้ง</label>
            <input id="lk-per" v-model.number="st.perBaht" type="number" min="1" step="1" class="input h-11" />
            <p class="mt-1 text-xs text-stone-500">นับจากยอดที่ลูกค้าจ่ายจริงของสินค้าที่ร่วมรายการ สูงสุด {{ MAX_DRAWS_PER_BILL }} ครั้งต่อบิล</p>
          </div>
          <div>
            <label class="label" for="lk-url">URL หน้าเว็บ (ใช้ทำ QR)</label>
            <input id="lk-url" v-model="st.siteUrl" class="input h-11" placeholder="https://cake-order-admin.pages.dev" />
          </div>
          <div>
            <label class="label" for="lk-days">วันใช้รหัสรางวัลหลังลุ้น</label>
            <input id="lk-days" v-model.number="st.prizeDays" type="number" min="1" max="365" class="input h-11" />
          </div>
        </div>
      </section>

      <section class="card space-y-3">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="card-title">สินค้าที่ร่วมลุ้น</div>
          <span class="text-sm text-stone-600">เลือกแล้ว {{ st.itemIds.length }} รายการ</span>
        </div>
        <p class="text-sm text-stone-600">บิลจะได้ลุ้นเมื่อมีสินค้าที่เลือกไว้ และลุ้นตามยอดของสินค้าเหล่านั้นเท่านั้น</p>
        <p v-if="pickedNames.length" class="rounded-xl bg-brand-50 p-2.5 text-sm text-brand-900">{{ pickedNames.join(' · ') }}</p>
        <p v-else class="rounded-xl bg-amber-50 p-2.5 text-sm text-amber-800">ยังไม่ได้เลือกสินค้า ระบบจะไม่ออก QR ให้บิลใดเลย</p>
        <input v-model="itemQuery" type="search" class="input h-11" placeholder="ค้นหาชื่อสินค้า" aria-label="ค้นหาสินค้า" />
        <div class="max-h-96 space-y-3 overflow-y-auto pr-1">
          <div v-for="g in itemGroups" :key="g.category">
            <div class="mb-1 text-xs font-semibold text-stone-500">{{ g.category }}</div>
            <label v-for="x in g.items" :key="x.id" class="flex cursor-pointer items-center gap-2 rounded-xl px-2 py-2 hover:bg-stone-50">
              <input type="checkbox" class="h-5 w-5 accent-brand-600" :checked="isPicked(x.id)" @change="togglePick(x.id)" />
              <span class="flex-1 text-sm text-stone-800">{{ x.name }}</span>
            </label>
          </div>
          <p v-if="!itemGroups.length" class="py-4 text-center text-sm text-stone-500">ไม่พบสินค้า</p>
        </div>
      </section>

      <section class="card space-y-3">
        <div class="flex items-center justify-between gap-2">
          <div class="card-title">รางวัลและโอกาส</div>
          <button type="button" class="btn-soft h-10 px-3 text-sm" @click="addPrize"><AppIcon name="plus" :size="15" /> เพิ่มรางวัล</button>
        </div>
        <p v-if="!st.prizes.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีรางวัล ทุกครั้งที่ลุ้นจะไม่ได้รางวัล</p>
        <div v-for="(p, i) in st.prizes" :key="i" class="grid gap-2 rounded-2xl border border-stone-200 p-3 sm:grid-cols-[2fr_1.2fr_1fr_1fr_auto] sm:items-end">
          <div>
            <label class="label" :for="'pn-' + i">ชื่อรางวัล</label>
            <input :id="'pn-' + i" v-model="p.name" class="input h-11" placeholder="เช่น ส่วนลด 50 บาท" />
          </div>
          <div>
            <label class="label" :for="'pk-' + i">ประเภท</label>
            <select :id="'pk-' + i" v-model="p.kind" class="input h-11">
              <option v-for="k in KINDS" :key="k.v" :value="k.v">{{ k.l }}</option>
            </select>
          </div>
          <div>
            <label class="label" :for="'pa-' + i">จำนวน</label>
            <MoneyInput :id="'pa-' + i" v-model="p.amount" class="input h-11" placeholder="0" />
          </div>
          <div>
            <label class="label" :for="'pc-' + i">โอกาส (%)</label>
            <input :id="'pc-' + i" v-model.number="p.chance" type="number" min="0" max="100" step="0.01" class="input h-11" />
          </div>
          <button type="button" class="btn-danger h-11 px-3" :aria-label="`ลบรางวัล ${p.name || i + 1}`" @click="removePrize(i)"><AppIcon name="trash" :size="16" /></button>
        </div>
        <p class="rounded-xl p-2.5 text-sm" :class="sumChance > 100 ? 'bg-rose-50 text-rose-700' : 'bg-brand-50 text-brand-900'" role="status">
          โอกาสรวม {{ sumChance.toFixed(2) }}% · ไม่ได้รางวัล {{ noPrize.toFixed(2) }}%
        </p>
      </section>

      <p v-if="msg" class="rounded-xl p-3 text-sm" :class="ok ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700'" role="status">{{ msg }}</p>
      <button type="button" class="btn-primary h-12 w-full" @click="save">บันทึกการตั้งค่า</button>

      <section class="card">
        <div class="card-title">สถิติ</div>
        <div class="mt-2 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">บิลที่มีสิทธิ์ลุ้น</div><div class="text-xl font-semibold">{{ stats.bills }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">ลุ้นแล้ว (ครั้ง)</div><div class="text-xl font-semibold">{{ stats.spins }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">ได้รางวัล</div><div class="text-xl font-semibold">{{ stats.won }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">รับรางวัลที่ร้านแล้ว</div><div class="text-xl font-semibold">{{ stats.redeemed }}</div></div>
        </div>
        <p class="mt-3 text-xs text-stone-500">รับรางวัลที่ร้านด้วยปุ่ม "รับรางวัลลุ้นโชค" ในหน้าขาย · ลุ้นได้ตามจำนวนที่บิลมี แต่ละครั้งได้ผลแยกกัน</p>
      </section>
    </div>
  </ManageShell>
</template>
