<script setup>
import { askConfirm } from '../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, can, addCustomer, findCustomer, createOrder, countPickups, pickupSlots, nearbyOrders } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, timeOnly, toDateStr } from '../lib/format'
import ItemEditor from '../components/ItemEditor.vue'
import ItemCard from '../components/ItemCard.vue'
import AppIcon from '../components/AppIcon.vue'
import BirthdayFields from '../components/BirthdayFields.vue'
import { parseBirthday, mdLabel } from '../lib/birthday'

const router = useRouter()
const steps = ['ลูกค้า', 'นัดรับ', 'สินค้า', 'สรุป']
const step = ref(0)
const error = ref('')

const form = reactive({
  customerId: null,
  date: toDateStr(new Date()),
  time: '',
  fulfillment: 'pickup',
  address: '',
  shippingFee: 0,
  items: [],
  birthday: { name: '', day: '', month: '' }, // วันเกิด (ไม่บังคับ)
})
const birthday = computed(() => parseBirthday(form.birthday).value)

// ---------- ขั้น 1 ลูกค้า ----------
const q = ref('')
const showNew = ref(false)
const newCus = reactive({ name: '', phone: '', line: '', note: '' })
const customer = computed(() => findCustomer(form.customerId))
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  const active = db.customers.filter((c) => c.active !== false)
  const list = s ? active.filter((c) => [c.name, c.phone, c.line].some((v) => v?.toLowerCase().includes(s))) : active
  return list.slice(0, 8)
})
const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

function openNew() {
  newCus.name = q.value
  showNew.value = true
  error.value = ''
}
function saveNewCustomer() {
  if (!newCus.name.trim()) return (error.value = 'กรอกชื่อลูกค้า')
  const c = addCustomer(newCus)
  form.customerId = c.id
  Object.assign(newCus, { name: '', phone: '', line: '', note: '' })
  showNew.value = false
  error.value = ''
}

// ---------- ขั้น 2 นัดรับ ----------
const pickupAt = computed(() => (form.date && form.time ? `${form.date}T${form.time}` : ''))
const load = computed(() => countPickups(pickupAt.value))
// เวลานัดเป็นปุ่มตามช่วงเวลาที่ตั้งไว้
const slots = computed(() => pickupSlots(form.date))
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
const totals = computed(() => orderTotals({ ...form, payments: [], adjustment: null, cancel: null }))

function validate(i) {
  if (i === 0 && !form.customerId) return 'เลือกลูกค้า'
  if (i === 1) {
    if (!form.date || !form.time) return 'เลือกวันและเวลานัดรับ'
    if (new Date(pickupAt.value) <= new Date()) return 'เวลานัดต้องมากกว่าเวลาปัจจุบัน'
    if (form.fulfillment === 'delivery' && !form.address.trim()) return 'กรอกที่อยู่จัดส่ง'
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
  // เวลาอาจผ่านไประหว่างกรอก ตรวจซ้ำก่อนบันทึก
  const e = validate(1)
  if (e) {
    step.value = 1
    error.value = e
    return
  }
  const o = createOrder({ ...form, pickupAt: pickupAt.value, birthday: birthday.value }, asDraft)
  router.replace(`/orders/${o.id}`)
}
</script>

<template>
  <div v-if="!can('createOrder')" class="card py-10 text-center text-stone-500">บทบาทนี้สร้างออร์เดอร์ไม่ได้</div>

  <div v-else class="mx-auto max-w-2xl pb-[calc(env(safe-area-inset-bottom)+6rem)]">
    <!-- หัว -->
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/orders" class="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-stone-700 shadow-sm ring-1 ring-stone-200/70" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <h1 class="text-xl font-bold tracking-tight text-stone-900">สร้างออร์เดอร์</h1>
    </div>

    <!-- ขั้นตอน -->
    <ol class="card mb-4 flex items-center gap-1 p-2.5">
      <li v-for="(s, i) in steps" :key="s" class="flex min-w-0 flex-1 items-center">
        <button class="flex min-w-0 flex-1 flex-col items-center gap-1 rounded-xl py-1.5 sm:flex-row sm:justify-center sm:gap-2" @click="goTo(i)">
          <span
            class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition"
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
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{{ initial(customer.name) }}</span>
        <div class="min-w-0 flex-1">
          <div class="truncate font-semibold text-stone-900">{{ customer.name }}</div>
          <div class="truncate text-sm text-stone-600">{{ customer.phone || '-' }}<span v-if="customer.line"> · LINE {{ customer.line }}</span></div>
          <div v-if="customer.note" class="truncate text-sm text-stone-500">{{ customer.note }}</div>
        </div>
        <button class="btn-outline h-9 px-3" @click="form.customerId = null">เปลี่ยน</button>
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
            @click="form.customerId = c.id; error = ''"
          >
            <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-stone-100 font-semibold text-stone-600">{{ initial(c.name) }}</span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-stone-900">{{ c.name }}</span>
              <span class="block truncate text-sm text-stone-500">{{ c.phone || '-' }}</span>
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
          <div><label class="label">เบอร์โทร</label><input v-model="newCus.phone" type="tel" inputmode="tel" class="input" /></div>
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
          <p v-if="!slots.length" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-500">ไม่มีเวลาว่างในวันนี้ เลือกวันอื่น</p>
          <div v-else class="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            <button
              v-for="t in slots"
              :key="t"
              type="button"
              class="h-10 rounded-xl border text-sm font-medium transition"
              :class="form.time === t ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-700 hover:border-brand-300'"
              @click="form.time = t"
            >{{ t }}</button>
          </div>
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
        <div v-if="form.fulfillment === 'delivery'" class="mt-4 space-y-3">
          <div><label class="label">ที่อยู่จัดส่ง <span class="text-rose-500">*</span></label><textarea v-model="form.address" rows="2" class="input" /></div>
          <div class="max-w-[12rem]"><label class="label">ค่าส่ง (บาท)</label><input v-model.number="form.shippingFee" type="number" inputmode="numeric" min="0" class="input" /></div>
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
            <div class="truncate text-sm text-stone-500">{{ customer?.phone }}</div>
          </div>
        </div>
        <div class="flex min-w-0 gap-3">
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><AppIcon :name="form.fulfillment === 'delivery' ? 'truck' : 'store'" /></span>
          <div class="min-w-0">
            <div class="text-xs text-stone-500">นัดรับ · {{ form.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
            <div class="font-semibold text-stone-900">{{ dateTime(pickupAt) }}</div>
            <div v-if="form.fulfillment === 'delivery'" class="text-sm break-words text-stone-500">{{ form.address }}</div>
          </div>
        </div>
        <div v-if="birthday" class="text-sm text-stone-600 sm:col-span-2">วันเกิด {{ birthday.name }} · {{ mdLabel(birthday.md) }}</div>
      </div>

      <ItemCard v-for="it in form.items" :key="it.id" :item="it" />

      <div class="card space-y-2 text-sm">
        <div class="flex justify-between"><span class="text-stone-500">ค่าสินค้า</span><span>{{ money(totals.subtotal) }}</span></div>
        <div v-if="form.fulfillment === 'delivery'" class="flex justify-between"><span class="text-stone-500">ค่าส่ง</span><span>{{ money(totals.shipping) }}</span></div>
        <div class="flex items-center justify-between border-t border-stone-100 pt-2">
          <span class="font-semibold">ยอดรวม</span>
          <span class="text-xl font-bold text-stone-900">{{ money(totals.total) }}</span>
        </div>
      </div>
    </section>

    <!-- error -->
    <div v-if="error" class="mt-3 flex items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-700">
      <AppIcon name="alert" :size="18" /> {{ error }}
    </div>

    <!-- ปุ่มล่าง -->
    <div class="action-bar">
      <div class="mx-auto flex max-w-2xl gap-2">
        <button v-if="step > 0" class="btn-outline px-3 sm:px-4" @click="back"><AppIcon name="back" /> <span class="hidden sm:inline">ย้อนกลับ</span></button>
        <template v-if="step < 3">
          <button class="btn-primary flex-1 sm:ml-auto sm:flex-none sm:px-8" @click="next">ถัดไป <AppIcon name="next" /></button>
        </template>
        <template v-else>
          <button class="btn-outline flex-1 sm:ml-auto sm:flex-none" @click="submit(true)">บันทึกร่าง</button>
          <button class="btn-primary flex-[1.4] sm:flex-none" @click="submit(false)">บันทึก · รอชำระ</button>
        </template>
      </div>
    </div>

    <ItemEditor v-if="editing" :item="editing.item || null" @save="onSaveItem" @close="editing = null" />
  </div>
</template>
