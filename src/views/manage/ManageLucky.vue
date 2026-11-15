<script setup>
// ลุ้นโชคท้ายบิล (แอดมิน): เปิด/ปิด ช่วงเวลา URL หน้าเว็บ อายุรหัสรางวัล และรายการรางวัล+โอกาส · ดูสถิติการลุ้น
import { computed, reactive, ref } from 'vue'
import { db, saveLuckyDraw } from '../../data/store'
import { luckyDefaults, LUCKY_SITE_URL } from '../../lib/luckyDraw'
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
  prizes: (base.prizes || []).map((p) => ({ id: p.id, name: p.name, kind: p.kind || 'item', amount: p.amount || 0, chance: p.chance || 0 })),
})
const msg = ref('')
const ok = ref(false)

const sumChance = computed(() => st.prizes.reduce((s, p) => s + (Number(p.chance) || 0), 0))
const noPrize = computed(() => Math.max(0, Math.round((100 - sumChance.value) * 100) / 100))
const stats = computed(() => {
  const t = db.luckyTokens || []
  return { issued: t.length, spun: t.filter((r) => r.spunAt).length, won: t.filter((r) => r.prize).length, redeemed: t.filter((r) => r.redeemedAt).length }
})
const KINDS = [{ v: 'points', l: 'คะแนนสะสม' }, { v: 'coupon', l: 'คูปองส่วนลด' }, { v: 'item', l: 'ของ/อื่น ๆ' }]

function addPrize() { st.prizes.push({ id: '', name: '', kind: 'item', amount: 0, chance: 0 }) }
function removePrize(i) { st.prizes.splice(i, 1) }
function save() {
  const r = saveLuckyDraw({ enabled: st.enabled, from: toIso(st.fromL), to: toIso(st.toL), siteUrl: st.siteUrl, prizeDays: st.prizeDays, prizes: st.prizes })
  ok.value = !r.error
  msg.value = r.error || 'บันทึกแล้ว'
}
</script>

<template>
  <ManageShell title="ลุ้นโชคท้ายบิล" subtitle="QR ท้ายใบเสร็จ → หน้าลุ้นโชคของบิลนั้น · ลุ้นได้ 1 ครั้งต่อบิล" back="/admin/settings" narrow :toolbar="false">
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
        <div class="grid gap-3 sm:grid-cols-2">
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
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">ออก QR แล้ว</div><div class="text-xl font-semibold">{{ stats.issued }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">ลุ้นแล้ว</div><div class="text-xl font-semibold">{{ stats.spun }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">ได้รางวัล</div><div class="text-xl font-semibold">{{ stats.won }}</div></div>
          <div class="rounded-xl bg-stone-50 p-3"><div class="text-xs text-stone-500">รับรางวัลที่ร้านแล้ว</div><div class="text-xl font-semibold">{{ stats.redeemed }}</div></div>
        </div>
        <p class="mt-3 text-xs text-stone-500">QR ออกเฉพาะบิลที่ขายเสร็จในช่วงเวลาที่เปิด · รับรางวัลที่ร้านด้วยปุ่ม "รับรางวัลลุ้นโชค" ในหน้าขาย</p>
      </section>
    </div>
  </ManageShell>
</template>
