<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveCustomer, customerOrderCount, birthdayList } from '../../data/store'
import { orderTotals } from '../../lib/pricing'
import { STATUS } from '../../lib/constants'
import { money, dateTime } from '../../lib/format'
import { mdLabel } from '../../lib/birthday'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.customers
    .filter((c) => inactive.value || c.active !== false)
    .filter((c) => !s || [c.name, c.phone, c.line].some((v) => v?.toLowerCase().includes(s)))
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name, 'th'))
})

const initial = (n) => (n || '').replace(/^คุณ/, '').trim().charAt(0)

const open = ref(false)
const form = reactive({ id: null, name: '', phone: '', line: '', note: '', active: true })
const error = ref('')
function edit(c) {
  Object.assign(form, c ? { ...c } : { id: null, name: '', phone: '', line: '', note: '', active: true })
  error.value = ''
  open.value = true
}
// ประวัติลูกค้า: ออร์เดอร์ทั้งหมด (ใหม่สุดก่อน), ยอดซื้อรวม (ไม่นับยกเลิก), วันเกิดที่เคยสั่ง
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

async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อลูกค้า')
  if (!(await confirmDeactivate(db.customers, form, form.name))) return
  saveCustomer({ ...form })
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
    search-placeholder="ค้นหา ชื่อ / เบอร์ / LINE"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบลูกค้า</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
          <span class="block truncate text-sm text-stone-500">{{ c.phone || '-' }}<template v-if="c.line"> · LINE {{ c.line }}</template></span>
          <span v-if="c.note" class="block truncate text-sm text-stone-400">{{ c.note }}</span>
        </span>
        <span class="shrink-0 rounded-lg bg-stone-50 px-2 py-1 text-xs text-stone-500">{{ customerOrderCount(c.id) }} ออร์เดอร์</span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" /></div>
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div><label class="label">เบอร์โทร</label><input v-model="form.phone" type="tel" inputmode="tel" class="input" /></div>
          <div><label class="label">LINE</label><input v-model="form.line" class="input" /></div>
        </div>
        <div><label class="label">หมายเหตุ</label><textarea v-model="form.note" rows="2" class="input" /></div>
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
              <RouterLink v-for="r in history.orders" :key="r.o.id" :to="`/orders/${r.o.id}`" class="flex items-center gap-3 px-3 py-2.5 text-sm hover:bg-stone-50">
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-medium text-stone-900">{{ r.o.code }} · {{ r.o.items[0]?.name }}<template v-if="r.o.items.length > 1"> +{{ r.o.items.length - 1 }}</template></span>
                  <span class="block text-xs text-stone-500">{{ dateTime(r.o.pickupAt) }} · {{ STATUS[r.o.status].label }}</span>
                </span>
                <span class="shrink-0 font-semibold" :class="r.o.status === 'cancelled' ? 'text-stone-400 line-through' : 'text-stone-900'">{{ money(r.total) }}</span>
              </RouterLink>
            </div>
          </div>
        </div>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
