<script setup>
// รายการออร์เดอร์สั่งล่วงหน้าสำหรับร้าน: ยืนยันเงินสด · จัดส่ง · รับแล้ว · ตีกลับ · ตัดสินคืนเงินหรือจัดส่งใหม่ · ขยายเวลา
// ทุกการกระทำเรียก preorder-admin และฐานข้อมูลเป็นผู้ตรวจกฎ (ยอด สถานะ) หน้านี้แค่ส่งข้อมูลที่กรอก
import { computed, onMounted, reactive, ref } from 'vue'
import { preorderAdminCall } from '../../lib/preorderAdminRemote'

const orders = ref([])
const loading = ref(true)
const msg = ref('')
const f = reactive({}) // orderId → ค่าที่กรอกของแต่ละออร์เดอร์

const STATUS = { awaiting_payment: 'รอชำระมัดจำ', payment_confirmed: 'ชำระมัดจำแล้ว', shipped: 'ส่งแล้ว', delivered: 'ได้รับแล้ว', returned: 'ตีกลับ/รับคืน', expired: 'หมดเวลา', cancelled: 'ยกเลิก' }
const METHOD = { cash: 'เงินสด', bank: 'โอนบัญชี', points: 'คะแนน' }

async function load() {
  loading.value = true
  const r = await preorderAdminCall('list')
  loading.value = false
  if (r.error) { msg.value = r.error; return }
  orders.value = r.orders || []
}

// สรุปรายการที่โหลดแล้ว: ยอดรับแล้ว/คงค้าง (ไม่นับยกเลิกและหมดเวลา) และจำนวนตามสถานะ
const summary = computed(() => {
  const by = {}
  let paid = 0
  let due = 0
  for (const o of orders.value) {
    by[o.status] = (by[o.status] || 0) + 1
    if (o.status === 'cancelled' || o.status === 'expired') continue
    paid += Number(o.paid) || 0
    due += Math.max(0, (Number(o.total) || 0) - (Number(o.paid) || 0))
  }
  return { count: orders.value.length, by, paid: Math.round(paid * 100) / 100, due: Math.round(due * 100) / 100 }
})

function box(id) {
  if (!f[id]) f[id] = { amount: '', method: 'cash', carrier: '', tracking: '', postage: '', reason: '', fee: '', newDue: '' }
  return f[id]
}

async function act(o, action, payload, okText) {
  msg.value = ''
  const r = await preorderAdminCall(action, { orderId: o.id, ...payload })
  if (r.error) { msg.value = `${o.code}: ${r.error}`; return }
  msg.value = `${o.code}: ${okText}`
  await load()
}

const lastDecidable = (o) => {
  const rs = o.returns || []
  return rs.length && rs[rs.length - 1].decision == null
}

onMounted(load)
</script>

<template>
  <section class="card mb-4" data-preorder-orders>
    <h2 class="text-base font-semibold text-stone-800">ออร์เดอร์สั่งล่วงหน้า</h2>
    <p v-if="loading" class="mt-2 text-sm text-stone-500">กำลังโหลด…</p>
    <p v-if="!loading && orders.length" class="mt-2 text-sm text-stone-600" data-preorder-summary>
      ทั้งหมด {{ summary.count }} ออร์เดอร์ · รับแล้ว {{ summary.paid }} บาท · คงค้าง {{ summary.due }} บาท ·
      รอชำระ {{ summary.by.awaiting_payment || 0 }} · ส่งแล้ว {{ summary.by.shipped || 0 }} · ได้รับแล้ว {{ summary.by.delivered || 0 }} ·
      ยกเลิก/หมดเวลา {{ (summary.by.cancelled || 0) + (summary.by.expired || 0) }}
    </p>
    <p v-if="msg" class="mt-2 text-sm text-stone-700" role="status">{{ msg }}</p>
    <p v-if="!loading && !orders.length" class="mt-2 text-sm text-stone-500">ยังไม่มีออร์เดอร์</p>
    <ul class="mt-3 space-y-3">
      <li v-for="o in orders" :key="o.id" class="rounded-xl border border-stone-200 p-3 text-sm" :data-order-code="o.code">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium">{{ o.code }} · {{ o.customerName }}</span>
          <span class="rounded-full bg-stone-100 px-2 py-0.5 text-xs">{{ STATUS[o.status] || o.status }}</span>
        </div>
        <div class="mt-1 text-stone-600">ยอดรวม {{ o.total }} · ชำระแล้ว {{ o.paid }} · ค่าส่ง {{ o.shippingFee }} · รับ {{ o.pickupDate }}</div>
        <div v-if="o.shipping" class="text-stone-600">เลขพัสดุ {{ o.shipping.trackingNo }} ({{ o.shipping.carrier }})</div>

        <!-- ยืนยันเงินสด -->
        <div v-if="['awaiting_payment', 'payment_confirmed', 'expired'].includes(o.status)" class="mt-2 flex flex-wrap items-center gap-2">
          <input v-model="box(o.id).amount" type="number" min="0" step="0.01" class="input h-9 w-28" aria-label="ยอดเงินสด" />
          <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'record_payment', { amount: Number(box(o.id).amount), method: 'cash' }, 'บันทึกเงินสดแล้ว')">รับเงินสด</button>
        </div>

        <!-- เลขพัสดุ -->
        <div v-if="o.status === 'payment_confirmed' && o.fulfillment === 'delivery' && !o.shipping" class="mt-2 flex flex-wrap items-center gap-2">
          <input v-model="box(o.id).carrier" class="input h-9 w-28" placeholder="ขนส่ง" aria-label="ชื่อขนส่ง" />
          <input v-model="box(o.id).tracking" class="input h-9 w-36" placeholder="เลขพัสดุ" aria-label="เลขพัสดุ" />
          <input v-model="box(o.id).postage" type="number" min="0" step="0.01" class="input h-9 w-28" placeholder="ค่าไปรษณีย์ (บาท)" aria-label="ค่าไปรษณีย์จริง (บาท)" />
          <button type="button" class="btn-primary h-9 px-3" @click="act(o, 'set_shipping', { carrier: box(o.id).carrier, trackingNo: box(o.id).tracking, postage: box(o.id).postage === '' ? 0 : Number(box(o.id).postage) }, 'บันทึกเลขพัสดุแล้ว')">บันทึกการส่ง</button>
        </div>

        <!-- ได้รับแล้ว / ตีกลับ -->
        <div v-if="o.status === 'shipped'" class="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'mark_delivered', {}, 'ยืนยันรับแล้ว')">ยืนยันรับแล้ว</button>
          <input v-model="box(o.id).reason" class="input h-9 w-44" placeholder="เหตุผลตีกลับ" aria-label="เหตุผลตีกลับ" />
          <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'record_return', { reason: box(o.id).reason }, 'บันทึกการตีกลับแล้ว')">บันทึกตีกลับ</button>
        </div>
        <div v-if="o.status === 'delivered'" class="mt-2 flex flex-wrap items-center gap-2">
          <input v-model="box(o.id).reason" class="input h-9 w-44" placeholder="เหตุผลรับคืน" aria-label="เหตุผลรับคืน" />
          <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'record_return', { reason: box(o.id).reason }, 'บันทึกการรับคืนแล้ว')">บันทึกรับคืน</button>
        </div>

        <!-- ตัดสิน: คืนเงิน (ริบค่าส่ง) หรือจัดส่งใหม่ (ริบค่าส่งเดิม) -->
        <div v-if="o.status === 'returned' && lastDecidable(o)" class="mt-2 space-y-2">
          <div class="flex flex-wrap items-center gap-2">
            <input v-model="box(o.id).amount" type="number" min="0" step="0.01" class="input h-9 w-28" aria-label="ยอดคืนเงิน" />
            <select v-model="box(o.id).method" class="input h-9 w-28" aria-label="วิธีคืนเงิน">
              <option value="cash">เงินสด</option>
              <option value="bank">โอนบัญชี</option>
              <option value="points">คะแนน</option>
            </select>
            <button type="button" class="btn-primary h-9 px-3" @click="act(o, 'refund_return', { refunds: [{ amount: Number(box(o.id).amount), method: box(o.id).method }] }, 'คืนเงินแล้ว (ค่าส่งเดิมถูกริบ)')">คืนเงิน</button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <input v-model="box(o.id).fee" type="number" min="0" step="0.01" class="input h-9 w-28" aria-label="ค่าส่งใหม่" />
            <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'reship', { newFee: Number(box(o.id).fee) }, 'ตั้งจัดส่งใหม่แล้ว ลูกค้าต้องชำระค่าส่งใหม่')">จัดส่งใหม่</button>
          </div>
        </div>

        <!-- ขยายเวลา -->
        <div v-if="o.status === 'expired'" class="mt-2 flex flex-wrap items-center gap-2">
          <input v-model="box(o.id).newDue" type="datetime-local" class="input h-9 w-48" aria-label="เวลากำหนดชำระใหม่" />
          <button type="button" class="btn-outline h-9 px-3" @click="act(o, 'extend', { newDue: new Date(box(o.id).newDue).toISOString() }, 'อนุมัติขยายเวลาแล้ว')">อนุมัติขยายเวลา</button>
        </div>
      </li>
    </ul>
  </section>
</template>
