<script setup>
import { askConfirm } from '../lib/confirm'
import { computed, reactive, ref, toRef } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { db, can, vatNow, addCustomer, saveCustomer, findCustomer, createOrder, countPickups, pickupSlots, pickupSlotsInfo, pickupClosure, nearbyOrders, sendQuote, findChat, linkChat, createCustomerFromChat, chatOrderBlock } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, timeOnly, toDateStr, formatPhone, phoneDigits, phoneValid } from '../lib/format'
import PhoneInput from '../components/PhoneInput.vue'
import ItemEditor from '../components/ItemEditor.vue'
import DiscountDetail from '../components/DiscountDetail.vue'
import ItemCard from '../components/ItemCard.vue'
import AppIcon from '../components/AppIcon.vue'
import BirthdayFields from '../components/BirthdayFields.vue'
import DeliveryFields from '../components/DeliveryFields.vue'
import { cleanDelivery } from '../lib/delivery'
import { dayClosed } from '../lib/shopHours'
import { parseBirthday, mdLabel } from '../lib/birthday'

// ใช้ได้ 2 แบบ: หน้าเต็ม (/orders/new) หรือแผงในแชท (embedded + draft ของแชทจาก store → สลับไปมาข้อมูลไม่หาย)
const props = defineProps({
  draft: { type: Object, default: null },
  embedded: { type: Boolean, default: false },
  chatId: { type: String, default: null },
})
const emit = defineEmits(['created', 'quoted'])
const router = useRouter()
const route = useRoute()
const steps = ['ลูกค้า', 'นัดรับ', 'สินค้า', 'สรุป']
// สร้างจากแชท: /orders/new?customer=<id>&chat=<chatId> → เติมลูกค้าและข้ามขั้นเลือกลูกค้า
const fromChat = props.chatId || (typeof route.query.chat === 'string' ? route.query.chat : null)
const error = ref('')
const notifyCustomer = ref(true) // แจ้งลูกค้าตอนบันทึก·รอชำระ (ค่าเริ่มต้นส่ง)

const form = props.draft || reactive({
  customerId: null,
  date: toDateStr(new Date()),
  time: '',
  fulfillment: 'pickup',
  address: '',
  shippingFee: 0,
  placeName: '',
  mapUrl: '',
  detail: '',
  distanceKm: '',
  feeManual: false,
  items: [],
  birthday: { name: '', day: '', month: '' }, // วันเกิด (ไม่บังคับ)
  step: 0,
})
const step = toRef(form, 'step')
if (!props.draft && typeof route.query.customer === 'string' && findCustomer(route.query.customer)) {
  form.customerId = route.query.customer
  step.value = 1
}
const birthday = computed(() => parseBirthday(form.birthday).value)

// ---------- ขั้น 1 ลูกค้า ----------
const q = ref('')
const showNew = ref(false)
const newCus = reactive({ name: '', phone: '', line: '', note: '' })
const customer = computed(() => findCustomer(form.customerId))
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  const active = db.customers.filter((c) => c.active !== false)
  const list = s ? active.filter((c) => [c.name, c.phone, c.line].some((v) => v?.toLowerCase().includes(s)) || (phoneDigits(s) && c.phone?.includes(phoneDigits(s)))) : active
  return list.slice(0, 8)
})
const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

// ในแชท: เลือก/สร้างลูกค้า = ผูกแชทกับลูกค้าด้วย (ลูกค้าทุกคนต้องมีเบอร์โทร)
const chat = computed(() => (props.chatId ? findChat(props.chatId) : null))
function pickCustomer(c) {
  if (props.embedded && chat.value) linkChat(chat.value.id, c.id)
  form.customerId = c.id
  error.value = ''
}
// ข้อมูลที่ได้จากแชท (ปุ่มถาม/ชิป): ชื่อ เบอร์ ข้อความบนเค้ก
const contactMatch = computed(() => (form.contactPhone && !customer.value ? db.customers.find((c) => c.phone === form.contactPhone) : null))
const itemDefaults = computed(() => {
  const g = db.optionGroups.find((x) => x.type === 'text' && x.name.includes('ข้อความ'))
  return g && form.cakeMessage ? { [g.id]: form.cakeMessage } : null
})
function openNew() {
  if (props.embedded && form.contactPhone) newCus.phone = form.contactPhone
  newCus.name = q.value || (props.embedded ? form.contactName || chat.value?.profileName || '' : '')
  showNew.value = true
  error.value = ''
}
function saveNewCustomer() {
  if (!newCus.name.trim()) return (error.value = 'กรอกชื่อลูกค้า')
  if (!phoneValid(newCus.phone)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง (บังคับ)')
  const c = props.embedded && chat.value ? createCustomerFromChat(chat.value.id, newCus.phone, newCus.name) : addCustomer(newCus)
  if (newCus.line || newCus.note) saveCustomer({ ...c, line: newCus.line || c.line, note: newCus.note || c.note })
  form.customerId = c.id
  Object.assign(newCus, { name: '', phone: '', line: '', note: '' })
  showNew.value = false
  error.value = ''
}
// ลูกค้าที่ยังไม่มีเบอร์: ใส่เบอร์ในขั้นนี้ได้
const addPhone = ref('')
function savePhone() {
  if (!phoneValid(addPhone.value)) return (error.value = 'กรอกเบอร์โทรให้ถูกต้อง')
  saveCustomer({ ...customer.value, phone: addPhone.value })
  addPhone.value = ''
  error.value = ''
}
// ในแชท: บันทึกได้เมื่อผูกบัญชีแล้วและลูกค้ามีเบอร์ (ร่าง/ใบเสนอทำได้ก่อน)
const saveBlock = computed(() => (props.embedded && props.chatId ? chatOrderBlock(props.chatId) : ''))

// ---------- ขั้น 2 นัดรับ ----------
const pickupAt = computed(() => (form.date && form.time ? `${form.date}T${form.time}` : ''))
const load = computed(() => countPickups(pickupAt.value))
// เวลานัดเป็นปุ่มตามช่วงเวลาที่ตั้งไว้
const slots = computed(() => pickupSlots(form.date))
const slotInfo = computed(() => pickupSlotsInfo(form.date))
const dayClosure = computed(() => (form.date ? dayClosed(db.shop, form.date) : null))
// ออร์เดอร์ก่อน/หลังเวลาที่เลือก
const nearHours = ref(db.shop.nearbyHours)
const NEAR_OPTIONS = [1, 2, 3, 6, 0]
const near = computed(() => nearbyOrders(pickupAt.value, nearHours.value))
const itemsText = (o) => o.items.map((i) => `${i.name} × ${i.qty}`).join(', ')

// ---------- ขั้น 3 สินค้า ----------
async function removeItem(i) {
  const it = form.items[i]
  if (await askConfirm({ title: 'ลบสินค้า', message: `${it.name} × ${it.qty}`, okText: 'ลบ', danger: true })) form.items.splice(i, 1)
}
const editing = ref(null) // null = ปิด, {} = เพิ่มใหม่, {item, index} = แก้ไข
function onSaveItem(item) {
  if (editing.value.index != null) form.items[editing.value.index] = item
  else form.items.push(item)
  editing.value = null
  error.value = ''
}

// ---------- สรุป ----------
const totals = computed(() => orderTotals({ ...form, payments: [], adjustment: null, cancel: null, vat: vatNow() }))

function validate(i) {
  // ในแชทข้ามขั้นลูกค้าได้ (ได้เบอร์ทีหลัง) แต่บันทึกต้องผูก + มีเบอร์
  if (i === 0 && !props.embedded && !form.customerId) return 'เลือกลูกค้า'
  if (i === 0 && !props.embedded && !phoneValid(customer.value?.phone)) return 'ลูกค้ายังไม่มีเบอร์โทร ใส่เบอร์ก่อน'
  if (i === 1) {
    if (!form.date || !form.time) return 'เลือกวันและเวลานัดรับ'
    { const cl = pickupClosure(pickupAt.value); if (cl) return `ร้านปิด (${cl.reason}) เลือกวัน-เวลานัดอื่น` }
    if (new Date(pickupAt.value) <= new Date()) return 'เวลานัดต้องมากกว่าเวลาปัจจุบัน'
    if (form.fulfillment === 'delivery') {
      if (!form.address.trim()) return 'กรอกที่อยู่จัดส่ง'
      const dv = cleanDelivery(form)
      if (dv.error) return dv.error
    }
    const bd = parseBirthday(form.birthday)
    if (bd.error) return bd.error
  }
  if (i === 2 && !form.items.length) return 'เพิ่มสินค้าอย่างน้อย 1 รายการ'
  return ''
}
function next() {
  error.value = validate(step.value)
  if (!error.value) step.value++
}
function back() {
  error.value = ''
  step.value--
}
function goTo(i) {
  for (let k = 0; k < i; k++) {
    const e = validate(k)
    if (e) {
      step.value = k
      error.value = e
      return
    }
  }
  error.value = ''
  step.value = i
}
function submit(asDraft) {
  if (saveBlock.value) return (error.value = `${saveBlock.value} · ไปขั้นลูกค้าเพื่อค้นหา/สร้างลูกค้า`)
  // เวลาอาจผ่านไประหว่างกรอก ตรวจซ้ำก่อนบันทึก
  const e = validate(1) || validate(0)
  if (e) {
    step.value = 1
    error.value = e
    return
  }
  const o = createOrder({ ...form, pickupAt: pickupAt.value, birthday: birthday.value, chatId: fromChat, notify: notifyCustomer.value }, asDraft)
  if (o.error) {
    step.value = 1
    error.value = o.error
    return
  }
  if (props.embedded) emit('created', o)
  else router.replace(`/admin/orders/${o.id}`)
}
// ส่งใบเสนอเข้าแชท (ลูกค้ากดยืนยัน = เป็นออร์เดอร์)
function quote() {
  for (let k = 0; k < 3; k++) {
    const e = validate(k)
    if (e) {
      step.value = k
      error.value = e
      return
    }
  }
  const q = sendQuote(fromChat, { ...form, pickupAt: pickupAt.value, birthday: birthday.value })
  if (q) emit('quoted', q)
}
</script>

<template>
  <div v-if="!can('createOrder')" class="card py-10 text-center text-stone-500">บทบาทนี้สร้างออร์เดอร์ไม่ได้</div>

  <div v-else :class="embedded ? 'pb-2' : 'mx-auto max-w-2xl pb-[calc(env(safe-area-inset-bottom)+6rem)]'">
    <!-- หัว -->
    <div v-if="!embedded" class="mb-4 flex items-center gap-2">
      <RouterLink to="/admin/orders" class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm ring-1 ring-stone-200/70" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <h1 class="text-xl font-semibold tracking-tight text-stone-900">สร้างออร์เดอร์</h1>
    </div>

    <!-- ขั้นตอน -->
    <ol class="card mb-4 flex items-center gap-1 p-2.5">
      <li v-for="(s, i) in steps" :key="s" class="flex min-w-0 flex-1 items-center">
        <button class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-1.5 sm:flex-row sm:justify-center sm:gap-2" @click="goTo(i)">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition"
            :class="i < step ? 'bg-brand-600 text-white' : i === step ? 'bg-brand-600 text-white ring-4 ring-brand-100' : 'bg-stone-100 text-stone-400'"
          >
            <AppIcon v-if="i < step" name="check" :size="14" />
            <template v-else>{{ i + 1 }}</template>
          </span>
          <span class="truncate text-xs font-medium sm:text-sm" :class="i === step ? 'text-brand-700' : 'text-stone-500'">{{ s }}</span>
        </button>
        <span v-if="i < steps.length - 1" class="hidden h-px w-4 shrink-0 bg-stone-200 sm:block" />
      </li>
    </ol>

    <!-- 1 ลูกค้า -->
    <section v-if="step === 0" class="card">
      <div class="card-title"><AppIcon name="user" class="text-brand-600" /> ลูกค้า</div>

      <div v-if="customer" class="flex items-center gap-3 rounded-2xl bg-brand-50 p-3.5">
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-semibold text-white">{{ initial(customer.name) }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-stone-900">{{ customer.name }}</div>
          <div class="truncate text-sm text-stone-600">{{ customer.phone ? formatPhone(customer.phone) : '-' }}<span v-if="customer.line"> · LINE {{ customer.line }}</span></div>
          <div v-if="customer.note" class="truncate text-sm text-stone-500">{{ customer.note }}</div>
        </div>
        <button class="btn-outline h-9 px-3" @click="form.customerId = null">เปลี่ยน</button>
      </div>
      <div v-if="customer && !phoneValid(customer.phone)" class="mt-3 rounded-xl bg-amber-50 p-3">
        <div class="mb-2 text-sm font-medium text-amber-800">ลูกค้ายังไม่มีเบอร์โทร (บังคับก่อนบันทึกออร์เดอร์)</div>
        <div class="flex gap-2">
          <PhoneInput v-model="addPhone" class="min-w-0 flex-1 bg-white" />
          <button type="button" class="btn-primary shrink-0" @click="savePhone">บันทึกเบอร์</button>
        </div>
      </div>
      <p v-if="embedded && !customer" class="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">แชทนี้ยังไม่ได้ผูกบัญชีลูกค้า ค้นหาลูกค้าเดิมหรือสร้างใหม่ (ข้ามไปก่อนได้ แต่ต้องผูกและมีเบอร์ก่อนบันทึก)</p>
      <div v-if="embedded && !customer && (form.contactPhone || form.contactName)" class="mb-3 rounded-xl border border-brand-200 bg-brand-50 p-3 text-sm">
        <div class="text-brand-900">ได้จากแชท: <b>{{ form.contactName || '-' }}</b> · {{ form.contactPhone ? formatPhone(form.contactPhone) : 'ยังไม่มีเบอร์' }}</div>
        <div class="mt-2 flex flex-wrap gap-2">
          <button v-if="contactMatch" type="button" class="btn-primary h-9 px-3 text-sm" @click="pickCustomer(contactMatch)">ผูกกับ {{ contactMatch.name }} (เบอร์ตรง)</button>
          <button v-else type="button" class="btn-soft h-9 px-3 text-sm" @click="openNew">สร้างลูกค้าจากข้อมูลนี้</button>
        </div>
      </div>

      <template v-else-if="!showNew">
        <label class="relative mb-3 block">
          <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
          <input v-model="q" class="input pl-10" placeholder="ค้นหา ชื่อ / เบอร์ / LINE" />
        </label>
        <div class="space-y-2">
          <button
            v-for="c in matches"
            :key="c.id"
            class="flex w-full items-center gap-3 rounded-xl border border-stone-200/70 p-3 text-left transition hover:border-brand-300 hover:bg-brand-50/40 active:scale-[0.99]"
            @click="pickCustomer(c)"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 font-semibold text-stone-600">{{ initial(c.name) }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-stone-900">{{ c.name }}</span>
              <span class="block truncate text-sm text-stone-500">{{ c.phone ? formatPhone(c.phone) : '-' }}</span>
            </span>
            <AppIcon name="next" class="text-stone-300" />
          </button>
          <p v-if="!matches.length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-500">ไม่พบลูกค้า</p>
        </div>
        <button class="btn-soft mt-3 w-full" @click="openNew"><AppIcon name="plus" /> ลูกค้าใหม่</button>
      </template>

      <div v-else class="space-y-3">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="newCus.name" class="input" /></div>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label class="label">เบอร์โทร <span class="text-rose-500">*</span></label><PhoneInput v-model="newCus.phone" /></div>
          <div><label class="label">LINE</label><input v-model="newCus.line" class="input" /></div>
        </div>
        <div><label class="label">หมายเหตุ</label><input v-model="newCus.note" class="input" /></div>
        <div class="flex justify-end gap-2 pt-1">
          <button class="btn-outline" @click="showNew = false; error = ''">ยกเลิก</button>
          <button class="btn-primary" @click="saveNewCustomer">บันทึกลูกค้า</button>
        </div>
      </div>
    </section>

    <!-- 2 นัดรับ -->
    <section v-if="step === 1" class="space-y-3">
      <div class="card">
        <div class="card-title"><AppIcon name="calendar" class="text-brand-600" /> วันเวลานัดรับ</div>
        <div class="grid grid-cols-2 gap-3">
          <div class="col-span-2 min-w-0"><label class="label">วันที่</label><input v-model="form.date" type="date" :min="toDateStr(new Date())" class="input" @change="form.time = slots.includes(form.time) ? form.time : ''" /></div>
        </div>
        <div class="mt-3">
          <div class="label">เวลา <span class="font-normal text-stone-400">(ทุก {{ db.shop.slotMinutes }} นาที)</span></div>
          <p v-if="dayClosure" class="flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm font-medium text-rose-700" role="alert"><AppIcon name="alert" :size="16" /> ร้านปิด: {{ dayClosure.reason }} · เลือกวันอื่น (แชท/สั่งวัน-เวลาอื่นได้ปกติ)</p>
          <p v-else-if="!slotInfo.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ไม่มีเวลาว่างในวันนี้ เลือกวันอื่น</p>
          <div v-else class="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            <button
              v-for="s in slotInfo"
              :key="s.t"
              type="button"
              class="h-10 rounded-xl border text-sm font-medium transition disabled:cursor-not-allowed disabled:border-stone-100 disabled:bg-stone-50 disabled:text-stone-300 disabled:line-through"
              :class="form.time === s.t ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700 hover:border-brand-300'"
              :disabled="s.closed"
              :title="s.closed ? `ร้านปิด: ${s.reason}` : ''"
              :aria-label="s.closed ? `${s.t} ร้านปิด ${s.reason}` : s.t"
              @click="form.time = s.t"
            >{{ s.t }}</button>
          </div>
          <p v-if="!dayClosure && slotInfo.some((s) => s.closed)" class="mt-1.5 text-xs text-rose-600">ช่องที่ขีดฆ่าร้านปิด: {{ [...new Set(slotInfo.filter((s) => s.closed).map((s) => s.reason))].join(', ') }}</p>
        </div>
        <div
          v-if="pickupAt"
          class="mt-3 flex items-start gap-2.5 rounded-xl p-3 text-sm"
          :class="load.day ? 'bg-amber-50 text-amber-800' : 'bg-emerald-50 text-emerald-800'"
        >
          <AppIcon :name="load.day ? 'alert' : 'check'" :size="18" class="mt-0.5" />
          <span>วันนั้นมีแล้ว <b>{{ load.day }}</b> ออร์เดอร์ · ช่วง {{ form.time.slice(0, 2) }}:00 น. มี <b>{{ load.hour }}</b> ออร์เดอร์</span>
        </div>
      </div>

      <!-- ออร์เดอร์ก่อน/หลังเวลาที่เลือก -->
      <div v-if="pickupAt" class="card">
        <div class="card-title"><AppIcon name="clock" class="text-brand-600" /> ออร์เดอร์ใกล้เวลานี้</div>
        <div class="mb-3 flex flex-wrap gap-2">
          <button v-for="h in NEAR_OPTIONS" :key="h" type="button" class="chip" :class="nearHours === h ? 'chip-on' : 'chip-off'" @click="nearHours = h">{{ h ? `±${h} ชม.` : 'ทั้งวัน' }}</button>
        </div>
        <div class="grid gap-3 sm:grid-cols-2">
          <div v-for="side in [{ k: 'before', t: 'ก่อนหน้า' }, { k: 'after', t: 'ถัดไป' }]" :key="side.k">
            <div class="mb-1.5 text-sm font-semibold text-stone-700">{{ side.t }} <span class="font-normal text-stone-500">{{ near[side.k].length }} ออร์เดอร์</span></div>
            <p v-if="!near[side.k].length" class="rounded-xl bg-stone-50 p-3 text-center text-sm text-stone-400">ไม่มี</p>
            <ul v-else class="space-y-1.5">
              <li v-for="o in near[side.k]" :key="o.id" class="rounded-xl border border-stone-200/70 p-2.5 text-sm">
                <div class="flex items-center justify-between gap-2">
                  <span class="font-semibold text-stone-900">{{ timeOnly(o.pickupAt) }}<span v-if="o.pickupAt.slice(0, 10) !== form.date" class="font-normal text-stone-400"> ({{ o.pickupAt.slice(5, 10) }})</span></span>
                  <span class="truncate text-xs text-stone-500">{{ findCustomer(o.customerId)?.name }}</span>
                </div>
                <div class="mt-0.5 text-xs break-words text-stone-600">{{ itemsText(o) }}</div>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title"><AppIcon name="truck" class="text-brand-600" /> การส่งมอบ</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="f in [{ v: 'pickup', t: 'รับที่ร้าน', i: 'store' }, { v: 'delivery', t: 'จัดส่ง', i: 'truck' }]"
            :key="f.v"
            class="flex flex-col items-center gap-1.5 rounded-2xl border p-4 text-sm font-semibold transition active:scale-[0.98]"
            :class="form.fulfillment === f.v ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600 hover:border-brand-300'"
            @click="form.fulfillment = f.v"
          >
            <AppIcon :name="f.i" :size="24" />
            {{ f.t }}
          </button>
        </div>
        <div v-if="form.fulfillment === 'delivery'" class="mt-4">
          <DeliveryFields :form="form" :customer-id="form.customerId" />
        </div>
      </div>

      <div class="card">
        <div class="card-title"><AppIcon name="cake" class="text-brand-600" /> วันเกิด <span class="font-normal text-stone-400">(ไม่บังคับ ใช้เตือนปีถัดไป)</span></div>
        <BirthdayFields v-model="form.birthday" />
      </div>
    </section>

    <!-- 3 สินค้า -->
    <section v-if="step === 2" class="space-y-3">
      <ItemCard v-for="(it, i) in form.items" :key="it.id" :item="it">
        <button class="btn-outline h-9 px-3" @click="editing = { item: it, index: i }"><AppIcon name="edit" :size="16" /> แก้ไข</button>
        <button class="btn-danger h-9 px-3" @click="removeItem(i)"><AppIcon name="trash" :size="16" /> ลบ</button>
      </ItemCard>

      <button
        class="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-brand-200 bg-white/60 p-6 text-brand-700 transition hover:border-brand-400 hover:bg-white active:scale-[0.99]"
        @click="editing = {}"
      >
        <span class="flex h-11 w-11 items-center justify-center rounded-full bg-brand-50"><AppIcon name="plus" :size="22" /></span>
        <span class="font-semibold">เพิ่มสินค้า</span>
      </button>

      <div v-if="form.items.length" class="card flex items-center justify-between">
        <span class="text-stone-500">ค่าสินค้า</span>
        <b class="text-lg text-stone-900">{{ money(totals.subtotal) }}</b>
      </div>
    </section>

    <!-- 4 สรุป -->
    <section v-if="step === 3" class="space-y-3">
      <div class="card grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="flex min-w-0 gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><AppIcon name="user" /></span>
          <div class="min-w-0">
            <div class="text-xs text-stone-500">ลูกค้า</div>
            <div class="truncate font-semibold text-stone-900">{{ customer?.name }}</div>
            <div class="truncate text-sm text-stone-500">{{ formatPhone(customer?.phone) }}</div>
          </div>
        </div>
        <div class="flex min-w-0 gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><AppIcon :name="form.fulfillment === 'delivery' ? 'truck' : 'store'" /></span>
          <div class="min-w-0">
            <div class="text-xs text-stone-500">นัดรับ · {{ form.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
            <div class="font-semibold text-stone-900">{{ dateTime(pickupAt) }}</div>
            <div v-if="form.fulfillment === 'delivery'" class="text-sm break-words text-stone-500"><b v-if="form.placeName" class="font-semibold text-stone-700">{{ form.placeName }} · </b>{{ form.address }}<span v-if="form.distanceKm !== '' && form.distanceKm != null"> · {{ form.distanceKm }} กม.</span></div>
          </div>
        </div>
        <div v-if="birthday" class="text-sm text-stone-600 sm:col-span-2">วันเกิด {{ birthday.name }} · {{ mdLabel(birthday.md) }}</div>
      </div>

      <ItemCard v-for="it in form.items" :key="it.id" :item="it" />

      <div class="card space-y-2 text-sm">
        <div v-if="totals.discountTotal" class="flex items-start justify-between gap-2 rounded-xl bg-emerald-50/60 p-2.5">
          <span class="text-stone-600">ราคาเต็ม → ยอดสุทธิ</span>
          <span><DiscountDetail :full="totals.fullAll" :final="totals.total" :lines="totals.discountLines" /></span>
        </div>
        <div class="flex justify-between"><span class="text-stone-500">ค่าสินค้า</span><span>{{ money(totals.subtotal) }}</span></div>
        <div v-if="form.fulfillment === 'delivery'" class="flex justify-between"><span class="text-stone-500">ค่าส่ง</span><span>{{ money(totals.shipping) }}</span></div>
        <div v-if="totals.vatMode === 'exclusive'" class="flex justify-between"><span class="text-stone-500">VAT {{ totals.vatRate }}% (บวกเพิ่ม)</span><span>+{{ money(totals.vat) }}</span></div>
        <div v-else-if="totals.vatMode === 'inclusive'" class="flex justify-between text-xs text-stone-400"><span>รวม VAT {{ totals.vatRate }}% แล้ว</span><span>{{ money(totals.vat) }}</span></div>
        <div class="flex items-center justify-between border-t border-stone-100 pt-2">
          <span class="font-semibold">ยอดรวม</span>
          <span class="text-xl font-semibold text-stone-900">{{ money(totals.total) }}</span>
        </div>
      </div>
    </section>

    <!-- error -->
    <div v-if="error" class="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
      <AppIcon name="alert" :size="18" /> {{ error }}
    </div>

    <!-- ปุ่มล่าง -->
    <div :class="embedded ? 'sticky bottom-0 z-10 -mx-3 mt-3 border-t border-stone-200 bg-white/95 p-3 backdrop-blur' : 'action-bar md:static md:mt-4 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none'">
      <div class="mx-auto flex max-w-2xl flex-wrap gap-2">
        <button v-if="step > 0" class="btn-outline px-3 sm:px-4" @click="back"><AppIcon name="back" /> <span class="hidden sm:inline">ย้อนกลับ</span></button>
        <template v-if="step < 3">
          <button class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8" @click="next">ถัดไป <AppIcon name="next" /></button>
        </template>
        <template v-else>
          <template v-if="embedded && fromChat">
            <p v-if="saveBlock" class="w-full text-xs text-amber-700">
              บันทึกไม่ได้: {{ saveBlock }} · <button type="button" class="font-medium underline" @click="step = 0; error = ''">ไปขั้นลูกค้า</button> (ส่งใบเสนอได้ก่อน)
            </p>
            <label class="flex w-full items-center gap-2 text-sm text-stone-700"><input v-model="notifyCustomer" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> แจ้งลูกค้าเมื่อบันทึก·รอชำระ</label>
            <button class="btn-soft flex-1" @click="quote">ส่งใบเสนอ</button>
            <button class="btn-primary flex-1" :disabled="!!saveBlock" @click="submit(false)">บันทึก · รอชำระ</button>
          </template>
          <template v-else>
            <label class="flex w-full items-center gap-2 text-sm text-stone-700 sm:w-auto"><input v-model="notifyCustomer" type="checkbox" class="h-4 w-4" aria-label="แจ้งลูกค้า" /> แจ้งลูกค้าเมื่อบันทึก·รอชำระ</label>
            <button class="btn-outline flex-1 sm:ml-auto sm:flex-none" @click="submit(true)">บันทึกร่าง</button>
            <button class="btn-primary flex-[1.4] sm:flex-none" @click="submit(false)">บันทึก · รอชำระ</button>
          </template>
        </template>
      </div>
    </div>

    <ItemEditor v-if="editing" :item="editing.item || null" :defaults="itemDefaults" @save="onSaveItem" @close="editing = null" />
  </div>
</template>
