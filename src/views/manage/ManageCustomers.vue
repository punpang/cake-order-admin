<script setup>
import MoneyInput from '../../components/MoneyInput.vue'
import { orderNo } from '../../lib/format'
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref, watch } from 'vue'
import { customerScale, CUSTOMER_WARN_AT, CUSTOMER_PAGE } from '../../lib/customersSync'
import { resolveMemberScan } from '../../lib/scan'
import NotifyChannelPicker from '../../components/NotifyChannelPicker.vue'
import { db, saveCustomer, setCustomerNotifyChannel, customerOrderCount, ensureOrders, ensureOrderCounts, orderCounts, loadMoreCustomers, birthdayList, savePlace, removePlace, placeFirst, findCustomer, customerPoints, adjustPointsRemote, convertPointsRemote, can, adminResetCustomerPin, remoteCustomerSearch } from '../../data/store'
import { isPin } from '../../lib/customerAuth'
import { askConfirm } from '../../lib/confirm'
import { orderTotals } from '../../lib/pricing'
import { STATUS } from '../../lib/constants'
import { money, dateTime, formatPhone, phoneDigits, phoneValid } from '../../lib/format'
import PhoneInput from '../../components/PhoneInput.vue'
import { mdLabel } from '../../lib/birthday'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import { validTaxId, validBranch } from '../../lib/acct/taxid'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import TaxAddressField from '../../components/TaxAddressField.vue'
import { addressChoices } from '../../lib/thaiAddress'

const q = ref('')
// สแกนรหัสสมาชิกในช่องค้นหา = เปิดข้อมูลลูกค้านั้นทันที
watch([q, () => db.customers.length], ([v]) => { remoteCustomerSearch(v); const c = resolveMemberScan(v, db.customers); if (c) { q.value = ''; edit(c) } })
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.customers
    .filter((c) => inactive.value || c.active !== false)
    .filter((c) => !s || [c.name, c.phone].some((v) => v?.toLowerCase().includes(s)) || (phoneDigits(s) && c.phone?.includes(phoneDigits(s))))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
})

const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

const open = ref(false)
const form = reactive({ id: null, name: '', phone: '', note: '', active: true, promoOptIn: false, tax: { name: '', taxId: '', branch: '00000', address: '' } })
const error = ref('')
function edit(c) {
  Object.assign(form, c ? { promoOptIn: false, ...c } : { id: null, name: '', phone: '', note: '', active: true, promoOptIn: false, fbPsid: '' })
  form.tax = { name: '', taxId: '', branch: '00000', address: '', ...(c?.tax || {}) }
  form.notifyChannels = { ...(c?.notifyChannels || {}) }
  error.value = ''
  open.value = true
}
// ประวัติลูกค้า: ออร์เดอร์ทั้งหมด (ใหม่สุดก่อน), ยอดซื้อรวม (ไม่นับยกเลิก), วันเกิดที่เคยสั่ง
// จำนวนออร์เดอร์บนการ์ดลูกค้า: นับที่เซิร์ฟเวอร์ (เข้าหน้านี้ใหม่ = นับใหม่) · ประวัติของลูกค้าที่เปิดดู: ดึงเฉพาะของลูกค้าคนนั้น
orderCounts.clear()
watch(() => list.value.map((c) => c.id), (ids) => ensureOrderCounts(ids), { immediate: true })
watch(() => form.id, (id) => { if (id) ensureOrders({ customerId: id }) })
// หน้าถัดไปจากเซิร์ฟเวอร์ (โหมดโหลดเฉพาะที่ใช้) · ได้น้อยกว่าขนาดหน้า = ครบแล้ว
const pageOffset = ref(0)
const pageDone = ref(false)
const pageBusy = ref(false)
const pageErr = ref('')
async function nextPage() {
  pageBusy.value = true
  pageErr.value = ''
  try {
    const n = await loadMoreCustomers(pageOffset.value)
    pageOffset.value += n
    if (n < CUSTOMER_PAGE) pageDone.value = true
  } catch { pageErr.value = 'โหลดลูกค้าไม่สำเร็จ ลองใหม่อีกครั้ง' } finally { pageBusy.value = false }
}
const history = computed(() => {
  if (!form.id) return null
  const orders = db.orders
    .filter((o) => o.customerId === form.id)
    .slice()
    .sort((a, b) => b.pickupAt.localeCompare(a.pickupAt))
    .map((o) => ({ o, total: orderTotals(o).total }))
  const spent = orders.filter((r) => r.o.status !== 'cancelled').reduce((s, r) => s + r.total, 0)
  return { orders, spent, birthdays: birthdayList(form.id) }
})

// ---------- คะแนนของลูกค้า (แอดมินปรับได้) ----------
const live = computed(() => (form.id ? findCustomer(form.id) : null))
const balance = computed(() => (live.value ? customerPoints(live.value) : 0))
const ledger = computed(() => (live.value?.ledger || []).filter((e) => !e.refunded || e.delta < 0).slice(-8).reverse())
const adj = reactive({ open: false, sign: 1, amount: '', reason: '', error: '' })
function openAdj() {
  Object.assign(adj, { open: true, sign: 1, amount: '', reason: '', error: '' })
}
async function saveAdj() {
  const n = Math.round(Number(adj.amount))
  if (!(n > 0)) return (adj.error = 'ใส่จำนวนคะแนนมากกว่า 0')
  if (!adj.reason.trim()) return (adj.error = 'ใส่เหตุผล')
  if (!(await askConfirm({ title: adj.sign > 0 ? 'เพิ่มคะแนน' : 'ลดคะแนน', message: `${form.name}: ${adj.sign > 0 ? '+' : '−'}${n} คะแนน`, okText: 'ยืนยัน', danger: adj.sign < 0 }))) return
  const r = await adjustPointsRemote(form.id, adj.sign * n, adj.reason)
  if (r.error) return (adj.error = r.error)
  adj.open = false
}
// แปลงคะแนนที่ใช้ได้ทั้งหมดเป็นคูปองใบเดียว (ใช้ครั้งเดียว มูลค่าเท่ายอดคะแนน หมดอายุ 30 วันนับจากวันแปลง)
const conv = reactive({ msg: '', error: '' })
async function convertPoints() {
  conv.msg = ''
  conv.error = ''
  if (!(balance.value > 0)) return (conv.error = 'ไม่มีคะแนนที่ใช้ได้ให้แปลง')
  if (!(await askConfirm({ title: 'แปลงคะแนนเป็นคูปอง', message: `${form.name}: ${balance.value} คะแนน → คูปอง ${money(balance.value)} ใช้ได้ครั้งเดียว หมดอายุใน 30 วัน`, okText: 'แปลงเป็นคูปอง', danger: true }))) return
  const r = await convertPointsRemote(form.id)
  if (r.error) return (conv.error = r.error)
  conv.msg = `แปลง ${r.points} คะแนนเป็นคูปอง ${money(r.amount)} แล้ว`
}

// ---------- สถานที่จัดส่งที่จำไว้ ----------
const places = computed(() => (form.id ? findCustomer(form.id)?.places || [] : []))
const pl = reactive({ open: false, id: null, placeName: '', address: '', mapUrl: '', detail: '', distanceKm: '', error: '' })
function editPlace(p) {
  Object.assign(pl, { open: true, id: p?.id || null, placeName: p?.name || '', address: p?.address || '', mapUrl: p?.mapUrl || '', detail: p?.detail || '', distanceKm: p?.distanceKm ?? '', error: '' })
}
function savePl() {
  const r = savePlace(form.id, { id: pl.id, placeName: pl.placeName, address: pl.address, mapUrl: pl.mapUrl, detail: pl.detail, distanceKm: pl.distanceKm })
  if (r.error) return (pl.error = r.error)
  pl.open = false
}
async function delPlace(p) {
  if (await askConfirm({ title: 'ลบสถานที่', message: p.name || p.address, okText: 'ลบ', danger: true })) removePlace(form.id, p.id)
}

// แอดมินตั้ง PIN ใหม่ให้ลูกค้าที่ลืม PIN (ใช้ได้เมื่อมีเบอร์และบันทึกแล้ว)
const pinNew = ref('')
const pinMsg = ref('')
const pinBusy = ref(false)
async function resetCustomerPin() {
  pinMsg.value = ''
  if (!isPin(pinNew.value)) return (pinMsg.value = 'PIN ต้องเป็นตัวเลข 6 หลัก')
  if (!(await askConfirm({ title: 'ตั้ง PIN ใหม่ให้ลูกค้า', message: `ตั้ง PIN ใหม่ให้ ${form.name || 'ลูกค้า'} · ลูกค้าจะถูกออกจากระบบทุกเครื่อง`, okText: 'ตั้ง PIN' }))) return
  pinBusy.value = true
  const r = await adminResetCustomerPin(form.phone, pinNew.value)
  pinBusy.value = false
  if (r.ok) {
    pinNew.value = ''
    pinMsg.value = 'ตั้ง PIN ใหม่แล้ว'
  } else pinMsg.value = r.error
}

async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อลูกค้า')
  if (!phoneValid(form.phone)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง (บังคับ)')
  if (form.tax.taxId && !validTaxId(form.tax.taxId)) return (error.value = 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก ตรวจตัวเลขท้าย)')
  if (form.tax.taxId && !validBranch(form.tax.branch)) return (error.value = 'สาขาต้อง 5 หลัก (สำนักงานใหญ่ 00000)')
  if (!(await confirmDeactivate(db.customers, form, form.name))) return
  const r = saveCustomer({ ...form })
  if (r.error) return (error.value = r.error)
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="ลูกค้า"
    :subtitle="`${list.length} รายการ`"
    add-label="เพิ่มลูกค้า"
    search-placeholder="ค้นหา ชื่อ / เบอร์"
    @add="edit(null)"
  >
    <p v-if="customerScale.lazy" class="mb-3 rounded-xl bg-sky-50 p-3 text-sm text-sky-900">แสดงเฉพาะลูกค้าที่โหลดไว้ในเครื่อง (ลูกค้าทั้งหมด {{ customerScale.count?.toLocaleString() ?? '–' }} ราย) · พิมพ์ชื่อหรือเบอร์ในช่องค้นหาเพื่อดึงลูกค้าคนอื่น</p>
    <p v-else-if="customerScale.count >= CUSTOMER_WARN_AT && can('manage')" class="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">ลูกค้าในระบบ {{ customerScale.count.toLocaleString() }} ราย ใกล้เกณฑ์ที่ควรเปิด "โหลดข้อมูลลูกค้าเฉพาะที่ใช้" (ตั้งค่าร้าน) · ควรทดสอบกับข้อมูลจำนวนมากก่อนเปิด</p>
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบลูกค้า</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <button
        v-for="c in list"
        :key="c.id"
        class="card flex items-start gap-3 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="c.active === false ? 'opacity-60' : ''"
        @click="edit(c)"
      >
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-50 font-semibold text-brand-700">{{ initial(c.name) }}</span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold text-stone-900">{{ c.name }}</span>
            <span v-if="c.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="block truncate text-sm text-stone-500"><template v-if="c.phone">{{ formatPhone(c.phone) }}</template><span v-else class="rounded bg-amber-50 px-1 text-xs text-amber-700">ไม่มีเบอร์</span></span>
          <span v-if="c.note" class="block truncate text-sm text-stone-400">{{ c.note }}</span>
        </span>
        <span class="shrink-0 rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-500">{{ customerOrderCount(c.id) }} ออร์เดอร์</span>
      </button>
    </div>
    <!-- โหมดโหลดเฉพาะที่ใช้: ดึงลูกค้าทีละหน้าจากเซิร์ฟเวอร์ (เรียงตามชื่อ) -->
    <div v-if="customerScale.lazy && !pageDone" class="mt-4 text-center">
      <button type="button" class="btn-outline h-11 px-5" :disabled="pageBusy" @click="nextPage">{{ pageBusy ? 'กำลังโหลด…' : 'โหลดลูกค้าเพิ่ม (เรียงตามชื่อ)' }}</button>
      <p v-if="pageErr" class="mt-2 text-sm text-rose-700" role="alert">{{ pageErr }}</p>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-600">*</span></label><input v-model="form.name" class="input" /></div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label class="label">เบอร์โทร <span class="text-rose-600">*</span></label><PhoneInput v-model="form.phone" /></div>
        </div>
        <div><label class="label">หมายเหตุ</label><textarea v-model="form.note" rows="2" class="input" /></div>
        <details class="rounded-2xl border border-stone-200 p-3" :open="!!form.tax.taxId">
          <summary class="cursor-pointer py-2 text-sm font-semibold text-stone-800">ข้อมูลออกใบกำกับภาษี (ไม่บังคับ)</summary>
          <div class="mt-3 space-y-3">
            <div><label class="label">ชื่อตามใบกำกับ</label><input v-model="form.tax.name" class="input" maxlength="120" aria-label="ชื่อตามใบกำกับ" /></div>
            <div class="grid grid-cols-3 gap-3">
              <div class="col-span-2"><label class="label">เลขประจำตัวผู้เสียภาษี</label><input v-model="form.tax.taxId" inputmode="numeric" maxlength="13" class="input" aria-label="เลขผู้เสียภาษีลูกค้า" /></div>
              <div><label class="label">สาขา</label><input v-model="form.tax.branch" inputmode="numeric" maxlength="5" class="input" aria-label="สาขาลูกค้า" /></div>
            </div>
            <div><label class="label">ที่อยู่ตามใบกำกับ</label><TaxAddressField v-model="form.tax.address" label="ที่อยู่ใบกำกับลูกค้า" :suggestions="addressChoices(places)" /></div>
          </div>
        </details>
        <div>
          <div class="label">ช่องทางแจ้งเตือน</div>
          <div class="flex flex-wrap gap-1.5 text-xs">
            <span class="rounded-full px-2 py-0.5" :class="form.fbPsid ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'">Facebook: {{ form.fbPsid ? 'ผูกแล้ว' : 'ยังไม่ผูก' }}</span>
            <span class="rounded-full px-2 py-0.5" :class="form.phone ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-100 text-stone-500'">SMS: {{ form.phone ? 'มีเบอร์' : 'ไม่มีเบอร์' }}</span>
          </div>
          <p class="mt-1 text-xs text-stone-400">ผูก Facebook ได้ในหน้าแชท (เมื่อลูกค้าทักมาทาง Facebook)</p>
        </div>
        <div v-if="form.id && form.phone && can('manage')" class="rounded-xl border border-stone-200/70 p-3">
          <div class="text-sm font-semibold text-stone-800">PIN สำหรับเข้าบัญชีลูกค้า</div>
          <p class="mt-1 text-xs text-stone-500">ตั้งหรือเปลี่ยน PIN ให้ลูกค้า (ถ้ายังไม่มีบัญชี ระบบจะสร้างให้) · ลูกค้าจะถูกออกจากระบบทุกเครื่อง</p>
          <div class="mt-2 flex gap-2">
            <input v-model="pinNew" inputmode="numeric" maxlength="6" class="input" placeholder="PIN ใหม่ 6 หลัก" aria-label="PIN ใหม่ของลูกค้า" />
            <button type="button" class="btn-soft h-11 shrink-0" :disabled="pinBusy" @click="resetCustomerPin">{{ pinBusy ? 'กำลังตั้ง…' : 'ตั้ง PIN' }}</button>
          </div>
          <p v-if="pinMsg" class="mt-2 text-sm" :class="pinMsg === 'ตั้ง PIN ใหม่แล้ว' ? 'text-emerald-700' : 'text-rose-700'" role="status">{{ pinMsg }}</p>
        </div>
        <div v-if="form.id && live" class="rounded-xl border border-stone-200/70 p-3">
          <div class="flex items-center justify-between gap-2">
            <div><div class="text-xs text-stone-500">คะแนนคงเหลือ</div><div class="text-xl font-semibold text-stone-900" aria-label="คะแนนคงเหลือ">{{ balance }}</div></div>
            <div class="flex flex-wrap justify-end gap-2">
              <button v-if="can('adjustPoints') && balance > 0" type="button" class="btn-soft h-9" @click="convertPoints">แปลงเป็นคูปอง</button>
              <button v-if="can('adjustPoints')" type="button" class="btn-soft h-9" @click="openAdj">ปรับคะแนน</button>
            </div>
          </div>
          <p v-if="conv.error" class="mt-2 text-sm text-rose-700" role="alert">{{ conv.error }}</p>
          <p v-if="conv.msg" class="mt-2 text-sm text-emerald-700" role="status">{{ conv.msg }}</p>
          <ul v-if="ledger.length" class="mt-2 divide-y divide-stone-100 text-xs">
            <li v-for="e in ledger" :key="e.id" class="flex items-start justify-between gap-2 py-1.5">
              <span class="min-w-0 break-words text-stone-600">{{ e.reason }}<span v-if="e.adjust" class="ml-1 rounded-full bg-amber-50 px-1.5 text-xs text-amber-700">ปรับเอง · {{ e.by === 'admin' ? 'แอดมิน' : e.by }}</span><span class="block text-stone-400">{{ dateTime(e.at) }}</span></span>
              <b class="shrink-0" :class="e.delta > 0 ? 'text-emerald-700' : 'text-rose-700'">{{ e.delta > 0 ? '+' : '' }}{{ e.delta }}</b>
            </li>
          </ul>
        </div>
        <div v-if="form.id">
          <div class="mb-1.5 flex items-center justify-between"><div class="label mb-0">สถานที่จัดส่งที่จำไว้ <span class="font-normal text-stone-400">({{ places.length }}/10)</span></div><button type="button" class="text-sm text-brand-700 underline" @click="editPlace(null)">+ เพิ่ม</button></div>
          <p v-if="!places.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มี · ระบบจำให้อัตโนมัติเมื่อสร้างออร์เดอร์จัดส่ง</p>
          <ul v-else class="divide-y divide-stone-100 rounded-xl border border-stone-200/70">
            <li v-for="(p, i) in places" :key="p.id" class="flex items-start gap-2 px-3 py-2 text-sm">
              <span class="min-w-0 flex-1">
                <span class="block truncate font-medium text-stone-900">{{ p.name || p.address }}<span v-if="i === 0" class="ml-1.5 rounded-full bg-brand-50 px-1.5 text-xs text-brand-700">ล่าสุด</span></span>
                <span v-if="p.name" class="block truncate text-xs text-stone-500">{{ p.address }}</span>
                <span class="block text-xs text-stone-400">ใช้ {{ p.uses }} ครั้ง<template v-if="p.distanceKm != null"> · {{ p.distanceKm }} กม.</template></span>
              </span>
              <button v-if="i > 0" type="button" class="text-xs text-brand-700 underline" :aria-label="`ตั้ง ${p.name || p.address} เป็นแรก`" @click="placeFirst(form.id, p.id)">ขึ้นแรก</button>
              <button type="button" class="text-xs text-brand-700 underline" @click="editPlace(p)">แก้</button>
              <button type="button" class="text-xs text-rose-700 underline lg:py-1.5" @click="delPlace(p)">ลบ</button>
            </li>
          </ul>
        </div>
        <div class="rounded-xl bg-stone-50 p-3">
          <div class="mb-2 text-sm font-medium text-stone-800">ช่องทางแจ้งเตือนลูกค้านี้</div>
          <p class="mb-2 text-xs text-stone-500">ตามเดิม = ใช้ค่าของระบบ · ออร์เดอร์ที่ตั้งเองจะเหนือกว่าค่านี้</p>
          <NotifyChannelPicker :model="form.notifyChannels" :customer="form" @set="(ch, v) => setCustomerNotifyChannel(form, ch, v)" />
        </div>
        <AppSwitch v-model="form.promoOptIn" label="รับข่าวโปร / อวยพรวันเกิด" />
        <AppSwitch v-model="form.active" label="ใช้งาน" />
        <div v-if="history" class="space-y-3 border-t border-stone-100 pt-4">
          <div class="grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-xl bg-stone-50 p-2.5"><div class="text-xs text-stone-500">ยอดซื้อรวม</div><div class="font-semibold text-stone-900">{{ money(history.spent) }}</div></div>
            <div class="rounded-xl bg-stone-50 p-2.5"><div class="text-xs text-stone-500">ออร์เดอร์</div><div class="font-semibold text-stone-900">{{ history.orders.length }}</div></div>
          </div>
          <div v-if="history.birthdays.length">
            <div class="label">วันเกิดที่เคยสั่ง</div>
            <div class="flex flex-wrap gap-2">
              <span v-for="b in history.birthdays" :key="b.name + b.md" class="rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700">{{ b.name || 'ไม่ระบุชื่อ' }} · {{ mdLabel(b.md) }}</span>
            </div>
          </div>
          <div>
            <div class="label">ประวัติออร์เดอร์</div>
            <p v-if="!history.orders.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ยังไม่มีออร์เดอร์</p>
            <div v-else class="divide-y divide-stone-100 rounded-xl border border-stone-200/70">
              <RouterLink v-for="r in history.orders" :key="r.o.id" :to="`/admin/orders/${r.o.id}`" class="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-stone-50">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-stone-900">{{ orderNo(r.o.code) }} · {{ r.o.items[0]?.name }}<template v-if="r.o.items.length > 1"> +{{ r.o.items.length - 1 }}</template></span>
                  <span class="block text-xs text-stone-500">{{ dateTime(r.o.pickupAt) }} · {{ STATUS[r.o.status].label }}</span>
                </span>
                <span class="shrink-0 font-semibold" :class="r.o.status === 'cancelled' ? 'text-stone-400 line-through' : 'text-stone-900'">{{ money(r.total) }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
    <AppModal v-if="adj.open" title="ปรับคะแนนลูกค้า" @close="adj.open = false">
      <div class="space-y-3">
        <div class="grid grid-cols-2 gap-1 seg-grid">
          <button v-for="k in [{ v: 1, t: 'เพิ่มคะแนน' }, { v: -1, t: 'ลดคะแนน' }]" :key="k.v" type="button" class="h-10 rounded-xl text-sm font-semibold transition" :class="adj.sign === k.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="adj.sign = k.v">{{ k.t }}</button>
        </div>
        <p class="text-sm text-stone-500">คงเหลือ {{ balance }} คะแนน</p>
        <div><label class="label">จำนวนคะแนน</label><input v-model="adj.amount" type="text" inputmode="numeric" class="input text-lg font-semibold" aria-label="จำนวนคะแนน" /></div>
        <div><label class="label">เหตุผล <span class="text-rose-600">*</span></label><input v-model="adj.reason" class="input" maxlength="120" aria-label="เหตุผลปรับคะแนน" /></div>
        <p v-if="adj.error" class="text-sm text-rose-700" role="alert">{{ adj.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="adj.open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveAdj">บันทึก</button>
      </template>
    </AppModal>
    <AppModal v-if="pl.open" :title="pl.id ? 'แก้สถานที่' : 'เพิ่มสถานที่'" @close="pl.open = false">
      <div class="space-y-3">
        <div><label class="label">ชื่อสถานที่</label><input v-model="pl.placeName" class="input" maxlength="80" /></div>
        <div><label class="label">ที่อยู่ <span class="text-rose-600">*</span></label><textarea v-model="pl.address" rows="2" class="input" maxlength="300" /></div>
        <div><label class="label">url แผนที่ (https)</label><input v-model="pl.mapUrl" type="url" class="input" /></div>
        <div><label class="label">รายละเอียด</label><textarea v-model="pl.detail" rows="2" class="input" maxlength="300" /></div>
        <div class="max-w-[10rem]"><label class="label">ระยะทาง (กม.)</label><MoneyInput v-model.number="pl.distanceKm" min="0" class="input" /></div>
        <p v-if="pl.error" class="text-sm text-rose-700">{{ pl.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="pl.open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="savePl">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
