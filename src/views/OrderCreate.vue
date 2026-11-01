<script setup>
import { computed, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, can, addCustomer, findCustomer, createOrder, countPickups } from '../data/store'
import { orderTotals } from '../lib/pricing'
import { money, dateTime, toDateStr } from '../lib/format'
import ItemEditor from '../components/ItemEditor.vue'
import ItemCard from '../components/ItemCard.vue'

const router = useRouter()
const steps = ['ลูกค้า', 'นัดรับ', 'สินค้า', 'สรุป']
const step = ref(0)
const error = ref('')

const form = reactive({
  customerId: null,
  date: toDateStr(new Date()),
  time: '14:00',
  fulfillment: 'pickup',
  address: '',
  shippingFee: 0,
  items: [],
})

// ---------- ขั้น 1 ลูกค้า ----------
const q = ref('')
const showNew = ref(false)
const newCus = reactive({ name: '', phone: '', line: '', note: '' })
const customer = computed(() => findCustomer(form.customerId))
const matches = computed(() => {
  const s = q.value.trim().toLowerCase()
  const list = s ? db.customers.filter((c) => [c.name, c.phone, c.line].some((v) => v?.toLowerCase().includes(s))) : db.customers
  return list.slice(0, 8)
})
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

// ---------- ขั้น 3 สินค้า ----------
const editing = ref(null) // null = ปิด, {} = เพิ่มใหม่, {item, index} = แก้ไข
function onSaveItem(item) {
  if (editing.value.index != null) form.items[editing.value.index] = item
  else form.items.push(item)
  editing.value = null
}

// ---------- สรุป ----------
const totals = computed(() => orderTotals({ ...form, payments: [], adjustment: null, cancel: null }))

function validate(i) {
  if (i === 0 && !form.customerId) return 'เลือกลูกค้า'
  if (i === 1) {
    if (!form.date || !form.time) return 'เลือกวันและเวลานัดรับ'
    if (form.fulfillment === 'delivery' && !form.address.trim()) return 'กรอกที่อยู่จัดส่ง'
  }
  if (i === 2 && !form.items.length) return 'เพิ่มสินค้าอย่างน้อย 1 รายการ'
  return ''
}
function next() {
  error.value = validate(step.value)
  if (!error.value) step.value++
}
function goTo(i) {
  for (let k = 0; k < i; k++) {
    const e = validate(k)
    if (e) return (error.value = e)
  }
  error.value = ''
  step.value = i
}
function submit(asDraft) {
  const o = createOrder({ ...form, pickupAt: pickupAt.value }, asDraft)
  router.replace(`/orders/${o.id}`)
}
</script>

<template>
  <div v-if="!can('createOrder')" class="card text-center text-stone-500">บทบาทนี้สร้างออร์เดอร์ไม่ได้</div>

  <div v-else class="mx-auto max-w-2xl pb-24">
    <div class="mb-4 flex items-center gap-2">
      <RouterLink to="/orders" class="rounded-lg px-2 py-1 text-xl hover:bg-stone-200">‹</RouterLink>
      <h1 class="text-xl font-semibold">สร้างออร์เดอร์</h1>
    </div>

    <!-- ขั้นตอน -->
    <ol class="mb-5 grid grid-cols-4 gap-1">
      <li v-for="(s, i) in steps" :key="s">
        <button class="w-full text-left" @click="goTo(i)">
          <div class="h-1.5 rounded-full" :class="i <= step ? 'bg-rose-500' : 'bg-stone-200'" />
          <div class="mt-1 text-xs sm:text-sm" :class="i === step ? 'font-semibold text-rose-600' : 'text-stone-500'">
            {{ i + 1 }}. {{ s }}
          </div>
        </button>
      </li>
    </ol>

    <!-- 1 ลูกค้า -->
    <section v-if="step === 0" class="card space-y-3">
      <div v-if="customer" class="flex items-center justify-between rounded-lg bg-rose-50 p-3">
        <div>
          <div class="font-semibold">{{ customer.name }}</div>
          <div class="text-sm text-stone-600">{{ customer.phone }} <span v-if="customer.line">· LINE {{ customer.line }}</span></div>
          <div v-if="customer.note" class="text-sm text-stone-500">{{ customer.note }}</div>
        </div>
        <button class="btn-outline" @click="form.customerId = null">เปลี่ยน</button>
      </div>

      <template v-else>
        <template v-if="!showNew">
          <input v-model="q" class="input" placeholder="ค้นหา ชื่อ / เบอร์ / LINE" />
          <div class="divide-y divide-stone-100 rounded-lg border border-stone-200">
            <button
              v-for="c in matches"
              :key="c.id"
              class="block w-full px-3 py-2 text-left hover:bg-stone-50"
              @click="form.customerId = c.id"
            >
              <div class="font-medium">{{ c.name }}</div>
              <div class="text-sm text-stone-500">{{ c.phone }}</div>
            </button>
            <p v-if="!matches.length" class="px-3 py-2 text-sm text-stone-500">ไม่พบลูกค้า</p>
          </div>
          <button class="btn-outline w-full" @click="showNew = true; newCus.name = q">+ ลูกค้าใหม่</button>
        </template>

        <div v-else class="space-y-3">
          <h2 class="font-semibold">ลูกค้าใหม่</h2>
          <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="newCus.name" class="input" /></div>
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div><label class="label">เบอร์โทร</label><input v-model="newCus.phone" type="tel" class="input" /></div>
            <div><label class="label">LINE</label><input v-model="newCus.line" class="input" /></div>
          </div>
          <div><label class="label">หมายเหตุ</label><input v-model="newCus.note" class="input" /></div>
          <div class="flex justify-end gap-2">
            <button class="btn-outline" @click="showNew = false">ยกเลิก</button>
            <button class="btn-primary" @click="saveNewCustomer">บันทึกลูกค้า</button>
          </div>
        </div>
      </template>
    </section>

    <!-- 2 นัดรับ -->
    <section v-if="step === 1" class="card space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">วันนัดรับ</label><input v-model="form.date" type="date" class="input" /></div>
        <div><label class="label">เวลา</label><input v-model="form.time" type="time" step="900" class="input" /></div>
      </div>

      <div v-if="pickupAt" class="rounded-lg p-3 text-sm" :class="load.day ? 'bg-amber-50 text-amber-800' : 'bg-stone-50 text-stone-600'">
        วันนั้นมีแล้ว <b>{{ load.day }}</b> ออร์เดอร์ · ช่วง {{ form.time.slice(0, 2) }}:00 น. มี <b>{{ load.hour }}</b> ออร์เดอร์
      </div>

      <div>
        <div class="label">การส่งมอบ</div>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="f in [{ v: 'pickup', t: '🏪 รับที่ร้าน' }, { v: 'delivery', t: '🚚 จัดส่ง' }]"
            :key="f.v"
            class="rounded-lg border py-2.5 text-sm"
            :class="form.fulfillment === f.v ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-stone-300'"
            @click="form.fulfillment = f.v"
          >
            {{ f.t }}
          </button>
        </div>
      </div>

      <template v-if="form.fulfillment === 'delivery'">
        <div><label class="label">ที่อยู่จัดส่ง <span class="text-rose-500">*</span></label><textarea v-model="form.address" rows="2" class="input" /></div>
        <div class="w-40"><label class="label">ค่าส่ง (บาท)</label><input v-model.number="form.shippingFee" type="number" min="0" class="input" /></div>
      </template>
    </section>

    <!-- 3 สินค้า -->
    <section v-if="step === 2" class="space-y-3">
      <ItemCard v-for="(it, i) in form.items" :key="it.id" :item="it" class="bg-white">
        <button class="btn-outline" @click="editing = { item: it, index: i }">แก้ไข</button>
        <button class="btn-danger" @click="form.items.splice(i, 1)">ลบ</button>
      </ItemCard>
      <button class="btn-outline w-full border-dashed py-3" @click="editing = {}">+ เพิ่มสินค้า</button>
      <div v-if="form.items.length" class="text-right">ค่าสินค้า <b>{{ money(totals.subtotal) }}</b></div>
    </section>

    <!-- 4 สรุป -->
    <section v-if="step === 3" class="card space-y-4">
      <div>
        <div class="text-sm text-stone-500">ลูกค้า</div>
        <div class="font-semibold">{{ customer?.name }} <span class="font-normal text-stone-500">{{ customer?.phone }}</span></div>
      </div>
      <div>
        <div class="text-sm text-stone-500">นัดรับ</div>
        <div>{{ dateTime(pickupAt) }} · {{ form.fulfillment === 'delivery' ? 'จัดส่ง' : 'รับที่ร้าน' }}</div>
        <div v-if="form.fulfillment === 'delivery'" class="text-sm text-stone-600">{{ form.address }}</div>
      </div>
      <div class="space-y-2">
        <div class="text-sm text-stone-500">สินค้า</div>
        <ItemCard v-for="it in form.items" :key="it.id" :item="it" />
      </div>
      <div class="space-y-1 border-t border-stone-200 pt-3 text-sm">
        <div class="flex justify-between"><span>ค่าสินค้า</span><span>{{ money(totals.subtotal) }}</span></div>
        <div v-if="form.fulfillment === 'delivery'" class="flex justify-between"><span>ค่าส่ง</span><span>{{ money(totals.shipping) }}</span></div>
        <div class="flex justify-between text-base font-semibold"><span>รวม</span><span>{{ money(totals.total) }}</span></div>
      </div>
    </section>

    <p v-if="error" class="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-700">{{ error }}</p>

    <!-- ปุ่มล่าง -->
    <div class="fixed inset-x-0 bottom-0 z-10 border-t border-stone-200 bg-white/95 p-3 backdrop-blur">
      <div class="mx-auto flex max-w-2xl gap-2">
        <button v-if="step > 0" class="btn-outline" @click="step--; error = ''">ย้อนกลับ</button>
        <div class="flex-1" />
        <template v-if="step < 3">
          <button class="btn-primary min-w-28" @click="next">ถัดไป</button>
        </template>
        <template v-else>
          <button class="btn-outline" @click="submit(true)">บันทึกร่าง</button>
          <button class="btn-primary" @click="submit(false)">บันทึก → รอชำระ</button>
        </template>
      </div>
    </div>

    <ItemEditor v-if="editing" :item="editing.item || null" @save="onSaveItem" @close="editing = null" />
  </div>
</template>
