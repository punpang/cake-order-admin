<script setup>
// รายงานสั่งล่วงหน้า: เลือกรายงาน กรองแคมเปญ/วัน แล้วดูผลจากเซิร์ฟเวอร์ (preorder-admin · action reports) · พิมพ์ได้
// หน้านี้ไม่คำนวณยอดเอง แสดงค่าที่เซิร์ฟเวอร์ส่งมาเท่านั้น
import { computed, reactive, ref, watch } from 'vue'
import { preorderCampaigns } from '../../data/preorder'
import { preorderAdminCall } from '../../lib/preorderAdminRemote'

const REPORTS = [
  { key: 'prep', label: 'ใบจัดเตรียม', needsCampaign: false },
  { key: 'pickup', label: 'รับของประจำวัน', needsCampaign: false },
  { key: 'ship', label: 'จัดส่งพัสดุ', needsCampaign: false },
  { key: 'due', label: 'ยอดค้างชำระ', needsCampaign: false },
  { key: 'campaign', label: 'สรุปแคมเปญ', needsCampaign: true },
  { key: 'exceptions', label: 'ยกเลิก/หมดเวลา/คืน', needsCampaign: false },
]

const campaigns = computed(() => preorderCampaigns())
const report = ref('prep')
const f = reactive({ campaignId: '', from: '', to: '', date: '' })
const loading = ref(false)
const error = ref('')
const data = ref(null)

const current = computed(() => REPORTS.find((r) => r.key === report.value))
const day = (s) => (s ? new Date(`${s}T00:00:00+07:00`).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Bangkok' }) : 'ไม่มีวันรับ')
const dt = (s) => (s ? new Date(s).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '-')
const baht = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 })

async function load() {
  error.value = ''
  if (current.value.needsCampaign && !f.campaignId) { data.value = null; return }
  loading.value = true
  const payload = { report: report.value }
  if (f.campaignId) payload.campaignId = f.campaignId
  if (report.value === 'prep') { if (f.from) payload.from = f.from; if (f.to) payload.to = f.to }
  if (report.value === 'pickup') payload.date = f.date
  const r = await preorderAdminCall('reports', payload)
  loading.value = false
  if (r.error) { data.value = null; error.value = r.error; return }
  data.value = r.data ?? null
}

const printReport = () => window.print()

watch([report, () => f.campaignId, () => f.from, () => f.to, () => f.date], load, { immediate: true })
</script>

<template>
  <section class="space-y-4">
    <div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
      <div role="group" aria-label="เลือกรายงาน" class="flex flex-wrap gap-2">
        <button v-for="r in REPORTS" :key="r.key" type="button" class="chip h-11 px-3 text-sm" :class="report === r.key ? 'chip-on' : 'chip-off'" :aria-pressed="report === r.key" @click="report = r.key">{{ r.label }}</button>
      </div>
      <button type="button" class="btn-outline h-11 px-3 text-sm" @click="printReport">พิมพ์</button>
    </div>

    <div class="grid gap-3 sm:grid-cols-3 print:hidden">
      <label class="block">
        <span class="label">แคมเปญ{{ current.needsCampaign ? ' (จำเป็น)' : '' }}</span>
        <select v-model="f.campaignId" class="input h-11 w-full" aria-label="กรองตามแคมเปญ">
          <option value="">ทุกแคมเปญ</option>
          <option v-for="c in campaigns" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
      <template v-if="report === 'prep'">
        <label class="block"><span class="label">รับตั้งแต่</span><input v-model="f.from" type="date" class="input h-11 w-full" aria-label="รับตั้งแต่วันที่" /></label>
        <label class="block"><span class="label">ถึงวันที่</span><input v-model="f.to" type="date" class="input h-11 w-full" aria-label="ถึงวันที่" /></label>
      </template>
      <label v-if="report === 'pickup'" class="block sm:col-span-2"><span class="label">วันรับ</span><input v-model="f.date" type="date" class="input h-11 w-full" aria-label="วันรับสินค้า" /></label>
    </div>

    <p v-if="loading" class="text-sm text-stone-500">กำลังโหลด…</p>
    <p v-else-if="error" role="alert" class="rounded-xl bg-danger-50 p-3 text-sm text-danger-800">{{ error }}</p>
    <p v-else-if="current.needsCampaign && !f.campaignId" class="rounded-xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">เลือกแคมเปญก่อนดูสรุป</p>

    <!-- ใบจัดเตรียม: สินค้า × จำนวน ต่อวันรับ -->
    <template v-else-if="report === 'prep' && data">
      <p v-if="!data.length" class="text-sm text-stone-500">ไม่มีออร์เดอร์ในช่วงนี้</p>
      <article v-for="d in data" :key="d.pickupDate || 'none'" class="rounded-2xl border border-stone-200 bg-white p-4" data-prep-day>
        <h3 class="text-base font-semibold text-stone-900">{{ day(d.pickupDate) }}</h3>
        <p class="mt-1 text-sm text-stone-600">ออร์เดอร์ {{ d.orderCount }} · ชำระครบ {{ d.paidCount }} · ค้างชำระ {{ d.unpaidCount }}</p>
        <ul class="mt-3 divide-y divide-stone-100">
          <li v-for="it in d.items" :key="it.retailId" class="flex items-center justify-between py-2 text-sm">
            <span>{{ it.name }}</span><span class="font-semibold">{{ it.qty }}</span>
          </li>
        </ul>
        <div v-if="d.exceptions.length" class="mt-3 rounded-xl bg-warning-50 p-3 text-sm text-amber-900">
          <p class="font-medium">ต้องตรวจสอบ</p>
          <p v-for="x in d.exceptions" :key="x.code">{{ x.code }}: {{ x.reason }}</p>
        </div>
      </article>
    </template>

    <!-- รับของประจำวัน -->
    <ul v-else-if="report === 'pickup' && data" class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
      <li v-if="!data.length" class="p-4 text-sm text-stone-500">ไม่มีออร์เดอร์ในวันนี้</li>
      <li v-for="o in data" :key="o.code" class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><strong>{{ o.code }}</strong> · {{ o.customerName || 'ไม่ระบุชื่อ' }}</span>
        <span class="text-stone-600">ชำระ {{ baht(o.paid) }} · ค้าง {{ baht(o.due) }}</span>
      </li>
    </ul>

    <!-- จัดส่งพัสดุที่ยังไม่ส่ง -->
    <ul v-else-if="report === 'ship' && data" class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
      <li v-if="!data.length" class="p-4 text-sm text-stone-500">ไม่มีออร์เดอร์ที่รอส่ง</li>
      <li v-for="o in data" :key="o.code" class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><strong>{{ o.code }}</strong> · {{ o.customerName || 'ไม่ระบุชื่อ' }}</span>
        <span :class="o.paidFull ? 'text-success-700' : 'text-danger-700'">{{ o.paidFull ? 'ชำระครบแล้ว' : 'ยังไม่ครบ ค้าง ' + baht(o.due) }}</span>
      </li>
    </ul>

    <!-- ยอดค้างชำระ -->
    <ul v-else-if="report === 'due' && data" class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
      <li v-if="!data.length" class="p-4 text-sm text-stone-500">ไม่มียอดค้าง</li>
      <li v-for="o in data" :key="o.code" class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <span><strong>{{ o.code }}</strong> · {{ o.customerName || 'ไม่ระบุชื่อ' }}</span>
        <span>
          <span v-if="o.overdue" class="mr-2 rounded-full bg-danger-100 px-2 py-0.5 text-xs text-danger-800">เกินเวลา</span>
          ค้าง {{ baht(o.due) }} · กำหนด {{ dt(o.payDueAt) }}
        </span>
      </li>
    </ul>

    <!-- สรุปแคมเปญ -->
    <dl v-else-if="report === 'campaign' && data" class="grid grid-cols-2 gap-3 rounded-2xl border border-stone-200 bg-white p-4 text-sm sm:grid-cols-4">
      <div><dt class="text-stone-500">ออร์เดอร์</dt><dd class="text-lg font-semibold">{{ data.orderCount }}</dd></div>
      <div><dt class="text-stone-500">ยอดขาย</dt><dd class="text-lg font-semibold">{{ baht(data.sales) }}</dd></div>
      <div><dt class="text-stone-500">รับแล้ว</dt><dd class="text-lg font-semibold">{{ baht(data.paid) }}</dd></div>
      <div><dt class="text-stone-500">ค้าง</dt><dd class="text-lg font-semibold">{{ baht(data.due) }}</dd></div>
    </dl>

    <!-- ยกเลิก หมดเวลา คืน -->
    <ul v-else-if="report === 'exceptions' && data" class="divide-y divide-stone-100 rounded-2xl border border-stone-200 bg-white">
      <li v-if="!data.length" class="p-4 text-sm text-stone-500">ไม่มีรายการ</li>
      <li v-for="o in data" :key="o.code" class="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
        <strong>{{ o.code }}</strong><span class="text-stone-600">{{ o.reason }}</span>
      </li>
    </ul>
  </section>
</template>
