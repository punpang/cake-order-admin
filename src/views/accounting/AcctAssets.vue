<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { computed, reactive, ref } from 'vue'
import { can } from '../../data/store'
import { assets, ASSET_CATS, saveAsset, disposeAsset, removeAsset, assetSchedule, assetTaxDepr, taxRateOf } from '../../data/acct'
import { monthLabel } from '../../lib/acct/period'
import { askConfirm } from '../../lib/confirm'
import { toDateStr, money, dateOnly } from '../../lib/format'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'

// ทะเบียนสินทรัพย์ถาวร + ค่าเสื่อมราคา (ทางบัญชีรายเดือน + ประมาณการทางภาษี)
const today = toDateStr(new Date())
const canA = computed(() => can('acctAssets'))
const err = ref('')
const blank = () => ({ id: null, name: '', category: 'equipment', cost: '', salvage: 0, lifeYears: 5, method: 'sl', rate: 20, buyDate: today, startDate: today, acquire: 'bank', note: '' })
const f = reactive(blank())
const open = ref(false)
const showId = ref('')
const catLabel = (id) => ASSET_CATS.find((c) => c.id === id)?.label || id
function add() { Object.assign(f, blank()); err.value = ''; open.value = true }
function edit(a) { Object.assign(f, blank(), a); err.value = ''; open.value = true }
function save() { const r = saveAsset(f, f.id); if (r.error) return (err.value = r.error); err.value = ''; open.value = false }
const disp = reactive({ open: false, id: '', date: today, proceeds: '', method: 'cash' })
function dispose() { const r = disposeAsset(disp.id, { date: disp.date, proceeds: disp.proceeds || 0, method: disp.method }); if (r.error) return (err.value = r.error); disp.open = false; err.value = '' }
async function del(a) { if (await askConfirm({ title: 'ลบสินทรัพย์', message: a.name, okText: 'ลบ', danger: true })) { const r = removeAsset(a.id); if (r.error) err.value = r.error } }
const book = (a) => { const s = assetSchedule(a).filter((r) => r.date <= today); return s.length ? s.at(-1).book : a.cost }
const accum = (a) => Math.round((a.cost - book(a)) * 100) / 100
const totals = computed(() => assets().filter((a) => !a.disposal).reduce((t, a) => ({ cost: t.cost + a.cost, book: t.book + book(a) }), { cost: 0, book: 0 }))
</script>

<template>
  <div class="space-y-3">
    <div class="grid grid-cols-2 gap-3"><div class="card"><div class="text-xs text-stone-500">ราคาทุนรวม (ที่ยังใช้งาน)</div><div class="mt-1 text-lg font-semibold">{{ money(totals.cost) }}</div></div><div class="card"><div class="text-xs text-stone-500">มูลค่าตามบัญชี</div><div class="mt-1 text-lg font-semibold">{{ money(totals.book) }}</div></div></div>
    <p v-if="err" class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700" role="alert"><AppIcon name="alert" :size="16" /> {{ err }}</p>
    <section class="card text-sm" aria-label="ทะเบียนสินทรัพย์">
      <div class="mb-2 flex items-center justify-between"><div class="card-title mb-0">ทะเบียนสินทรัพย์ ({{ assets().length }})</div><button v-if="canA" class="btn-soft h-9 px-3" @click="add"><AppIcon name="plus" :size="16" /> เพิ่ม</button></div>
      <p v-if="!assets().length" class="py-6 text-center text-stone-400">ยังไม่มีสินทรัพย์ · ราคาต่ำกว่า 500 บาทให้บันทึกเป็นค่าใช้จ่าย</p>
      <ul class="divide-y divide-stone-100">
        <li v-for="a in assets()" :key="a.id" class="py-2.5">
          <button class="flex w-full items-start justify-between gap-2 text-left" :aria-expanded="showId === a.id" @click="showId = showId === a.id ? '' : a.id">
            <span class="min-w-0"><span class="block font-medium text-stone-800">{{ a.code }} · {{ a.name }} <span v-if="a.disposal" class="text-xs text-amber-700">จำหน่ายแล้ว</span></span><span class="block text-xs text-stone-500">{{ catLabel(a.category) }} · {{ a.method === 'sl' ? 'เส้นตรง' : `ยอดลดลง ${a.rate}%` }} · {{ a.lifeYears }} ปี · เริ่มใช้ {{ dateOnly(a.startDate) }}</span></span>
            <span class="shrink-0 text-right"><b class="block">{{ money(a.cost) }}</b><span class="text-xs text-stone-500">คงเหลือ {{ money(a.disposal ? 0 : book(a)) }}</span></span>
          </button>
          <div v-if="showId === a.id" class="mt-2 space-y-2 rounded-xl bg-stone-50 p-2 text-xs">
            <div class="flex justify-between"><span>ค่าเสื่อมสะสมถึงปัจจุบัน</span><b>{{ money(accum(a)) }}</b></div>
            <div v-if="a.disposal" class="flex justify-between"><span>จำหน่าย {{ dateOnly(a.disposal.date) }}</span><b>ขายได้ {{ money(a.disposal.proceeds) }}</b></div>
            <div class="font-semibold text-stone-600">ตารางค่าเสื่อมทางบัญชี</div>
            <div v-for="r in assetSchedule(a)" :key="r.ym" class="flex justify-between" :class="r.date <= today ? 'text-stone-700' : 'text-stone-400'"><span>{{ monthLabel(r.ym) }}</span><span>{{ money(r.amount) }} · คงเหลือ {{ money(r.book) }}{{ r.date <= today ? ' ✓' : '' }}</span></div>
            <div class="font-semibold text-stone-600">ค่าเสื่อมทางภาษี (ประมาณการ อัตราหมวดนี้ {{ taxRateOf(a.category) }}%/ปี — ตรวจกับประกาศกรมสรรพากร)</div>
            <div v-for="(v, y) in assetTaxDepr(a)" :key="y" class="flex justify-between"><span>ปี {{ Number(y) + 543 }}</span><span>{{ money(v) }}</span></div>
            <div v-if="canA" class="flex flex-wrap gap-2 pt-1">
              <button class="btn-soft h-9 px-3" @click="edit(a)">แก้ไข</button>
              <button v-if="!a.disposal" class="btn-outline h-9 px-3" @click="Object.assign(disp, { open: true, id: a.id, date: today, proceeds: '' }); err = ''">จำหน่าย/ขาย</button>
              <button class="btn-outline h-9 px-3 text-rose-700" @click="del(a)">ลบ</button>
            </div>
          </div>
        </li>
      </ul>
    </section>
    <p class="text-xs text-stone-400">ค่าเสื่อมคิดเต็มเดือนตั้งแต่เดือนที่เริ่มใช้ ลงบัญชีเมื่อสิ้นเดือน · อัตราค่าเสื่อมทางภาษีเป็นค่าตั้งต้นที่ต้องตรวจกับประกาศปัจจุบัน</p>

    <AppModal v-if="open" :title="f.id ? 'แก้ไขสินทรัพย์' : 'เพิ่มสินทรัพย์'" @close="open = false">
      <div class="space-y-3">
        <div><label class="label">ชื่อสินทรัพย์</label><input v-model="f.name" class="input" maxlength="100" aria-label="ชื่อสินทรัพย์" /></div>
        <div><label class="label">หมวด</label><select v-model="f.category" class="input" aria-label="หมวดสินทรัพย์"><option v-for="c in ASSET_CATS" :key="c.id" :value="c.id">{{ c.label }}</option></select></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">ราคาทุน</label><MoneyInput v-model="f.cost" class="input" aria-label="ราคาทุน" /></div><div><label class="label">มูลค่าซาก</label><MoneyInput v-model="f.salvage" class="input" aria-label="มูลค่าซาก" /></div></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">อายุใช้งาน (ปี)</label><MoneyInput v-model="f.lifeYears" class="input" aria-label="อายุใช้งานปี" /></div><div><label class="label">วิธีคิดค่าเสื่อม</label><select v-model="f.method" class="input" aria-label="วิธีค่าเสื่อม"><option value="sl">เส้นตรง</option><option value="db">ยอดลดลง</option></select></div></div>
        <div v-if="f.method === 'db'"><label class="label">อัตรา % ต่อปี</label><MoneyInput v-model="f.rate" class="input" aria-label="อัตราค่าเสื่อมต่อปี" /></div>
        <div class="grid grid-cols-2 gap-3"><div><label class="label">วันที่ซื้อ</label><input v-model="f.buyDate" type="date" class="input" aria-label="วันที่ซื้อสินทรัพย์" /></div><div><label class="label">วันที่เริ่มใช้</label><input v-model="f.startDate" type="date" class="input" aria-label="วันที่เริ่มใช้สินทรัพย์" /></div></div>
        <div v-if="!f.id"><label class="label">การซื้อ</label><select v-model="f.acquire" class="input" aria-label="วิธีซื้อสินทรัพย์"><option value="bank">จ่ายธนาคาร/โอน</option><option value="cash">จ่ายเงินสด</option><option value="payable">ค้างจ่าย (เจ้าหนี้)</option><option value="none">ไม่บันทึกการซื้อ (ยกมา/ซื้อผ่อนไว้แล้ว)</option></select></div>
        <div><label class="label">หมายเหตุ</label><input v-model="f.note" class="input" maxlength="300" aria-label="หมายเหตุสินทรัพย์" /></div>
        <p v-if="err" class="text-sm text-rose-700" role="alert">{{ err }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button></template>
    </AppModal>
    <AppModal v-if="disp.open" title="จำหน่าย/ขายสินทรัพย์" @close="disp.open = false">
      <div class="space-y-3">
        <div><label class="label">วันที่จำหน่าย</label><input v-model="disp.date" type="date" class="input" aria-label="วันที่จำหน่าย" /></div>
        <div><label class="label">ยอดที่ขายได้ (0 = ทิ้ง/ตัดจำหน่าย)</label><MoneyInput v-model="disp.proceeds" class="input" aria-label="ยอดขายสินทรัพย์" /></div>
        <div><label class="label">รับเงินทาง</label><select v-model="disp.method" class="input" aria-label="รับเงินขายสินทรัพย์"><option value="cash">เงินสด</option><option value="bank">ธนาคาร</option></select></div>
        <p v-if="err" class="text-sm text-rose-700" role="alert">{{ err }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="disp.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="dispose">ยืนยันจำหน่าย</button></template>
    </AppModal>
  </div>
</template>
