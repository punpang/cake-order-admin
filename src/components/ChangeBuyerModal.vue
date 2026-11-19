<script setup>
import { computed, ref, watch } from 'vue'
import { db, changeBuyerPreview, changeBuyer, remoteCustomerSearch } from '../data/store'
import { money, formatPhone, phoneDigits, phoneValid } from '../lib/format'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'

// เปลี่ยนผู้ซื้อของออร์เดอร์/บิล POS · ดูผลก่อนยืนยัน: ส่วนลดคะแนน/คูปองที่ใช้ในออร์เดอร์จะถูกนำออก (คืนผู้ซื้อเดิม) · ส่งมอบแล้ว = โอนคะแนน/สิทธิ์หมุนที่ได้ไปผู้ซื้อใหม่
const props = defineProps({ order: { type: Object, required: true } })
const emit = defineEmits(['close', 'done'])
const q = ref('')
const picked = ref(null)
const reason = ref('')
const error = ref('')
watch(q, (v) => remoteCustomerSearch(v)) // โหมดโหลดลูกค้าเฉพาะที่ใช้: ค้นที่เซิร์ฟเวอร์ด้วย
const results = computed(() => {
  const s = q.value.trim().toLowerCase()
  if (s.length < 2) return []
  const d = phoneDigits(s)
  return db.customers
    .filter((c) => !c.deleted && c.active !== false && c.id !== props.order.customerId && (c.name.toLowerCase().includes(s) || (d.length >= 3 && (c.phone || '').includes(d))))
    .slice(0, 8)
})
const pv = computed(() => (picked.value ? changeBuyerPreview(props.order, picked.value.id) : null))
const pick = (c) => {
  picked.value = c
  error.value = ''
}
function confirm() {
  const r = changeBuyer(props.order, picked.value.id, reason.value)
  if (r.error) return (error.value = r.error)
  emit('done', r)
  emit('close')
}
</script>

<template>
  <AppModal :title="`เปลี่ยนผู้ซื้อ ${order.code}`" @close="emit('close')">
    <div class="space-y-4">
      <p class="text-sm text-stone-500">ผู้ซื้อปัจจุบัน: <b class="text-stone-800">{{ db.customers.find((c) => c.id === order.customerId)?.name || 'ไม่ระบุ (ลูกค้าทั่วไป)' }}</b></p>
      <div v-if="!picked">
        <label class="label">ค้นหาผู้ซื้อใหม่ (ชื่อ / เบอร์)</label>
        <input v-model="q" type="search" class="input" placeholder="พิมพ์อย่างน้อย 2 ตัวอักษร" />
        <div v-if="results.length" class="mt-2 space-y-1.5">
          <button v-for="c in results" :key="c.id" type="button" class="flex w-full items-center justify-between gap-2 rounded-xl border border-stone-200 px-3 py-2 text-left text-sm hover:border-brand-300 disabled:opacity-50" :disabled="!phoneValid(c.phone)" @click="pick(c)">
            <span class="truncate font-medium text-stone-900">{{ c.name }}</span>
            <span class="shrink-0 text-xs text-stone-500">{{ phoneValid(c.phone) ? formatPhone(c.phone) : 'ไม่มีเบอร์ (เลือกไม่ได้)' }}</span>
          </button>
        </div>
        <p v-else-if="q.trim().length >= 2" class="mt-2 text-sm text-stone-500">ไม่พบลูกค้า · เพิ่มลูกค้าใหม่ได้ที่ <RouterLink to="/admin/settings/customers" class="text-brand-700 underline">จัดการลูกค้า</RouterLink> (ต้องมีเบอร์โทร)</p>
      </div>
      <template v-else>
        <div class="flex items-center justify-between gap-2 rounded-xl bg-brand-50 p-3">
          <span class="min-w-0"><span class="block truncate font-semibold text-brand-900">{{ picked.name }}</span><span class="block text-xs text-brand-800">{{ formatPhone(picked.phone) }}</span></span>
          <button type="button" class="text-xs text-stone-500 underline" @click="picked = null">เปลี่ยนคน</button>
        </div>
        <p v-if="pv?.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ pv.error }}</p>
        <template v-else-if="pv">
          <div v-if="pv.removedAmount" class="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
            <b>ส่วนลดที่ใช้ในออร์เดอร์นี้จะถูกนำออก</b> และคืนให้ผู้ซื้อเดิม:
            <ul class="mt-1 list-disc pl-5">
              <li v-if="pv.removedPoints">คะแนน {{ pv.removedPoints }} คะแนน</li>
              <li v-for="(n, i) in pv.removedCoupons" :key="i">คูปอง {{ n }}</li>
            </ul>
            ยอดรวม {{ money(pv.oldTotal) }} → <b>{{ money(pv.newTotal) }}</b><template v-if="pv.newBalance > 0"> · คงค้าง {{ money(pv.newBalance) }}</template>
          </div>
          <div v-if="pv.transfer" class="rounded-xl bg-stone-50 p-3 text-sm text-stone-700">ส่งมอบแล้ว: โอนคะแนนที่ได้จากออร์เดอร์นี้ <b>{{ pv.transfer.points }}</b> คะแนน<template v-if="pv.transfer.spins"> + สิทธิ์หมุน {{ pv.transfer.spins }} ครั้ง</template> ไปให้ผู้ซื้อใหม่ (ผู้ซื้อเดิมถูกหักเท่าที่เหลืออยู่)</div>
          <div><label class="label">เหตุผล (ไม่บังคับ)</label><input v-model="reason" class="input" maxlength="120" placeholder="เช่น สั่งแทนบริษัท" /></div>
        </template>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </template>
    </div>
    <template #footer>
      <button class="btn-outline flex-1 sm:flex-none" @click="emit('close')">ยกเลิก</button>
      <button v-if="picked && pv?.ok" class="btn-primary flex-1 sm:flex-none" @click="confirm">ยืนยันเปลี่ยนผู้ซื้อ</button>
    </template>
  </AppModal>
</template>
