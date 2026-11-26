<script setup>
import { computed, onMounted, ref } from 'vue'
import { db, upcomingBirthdays, pendingDeletions, pendingPhotoRequests, can } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import { customerScale } from '../../lib/customersSync'
import AppIcon from '../../components/AppIcon.vue'
import { SETTINGS_PAGES, groupSettings } from '../../lib/settingsPages'
import { retentionSummary } from '../../lib/retention'
import { countOpenReview } from '../../lib/syncReview'
import { getSupabase, supabaseEnabled } from '../../lib/supabase.js'

const activeCount = (list) => list.filter((x) => x.active !== false).length
const syncOpen = ref(0) // รายการรอตรวจในคิวออร์เดอร์ (ไม่มีสิทธิ์ผู้จัดการ/ไม่ต่อฐานข้อมูล = 0)
onMounted(async () => { if (supabaseEnabled && can('manage')) syncOpen.value = await countOpenReview(await getSupabase()) })

const DESC = computed(() => ({
  '/admin/dashboard': 'ออร์เดอร์ค้าง · แชท Facebook · การเข้าชมหน้าเว็บ · งานค้าง',
  '/admin/settings/customers': customerScale.lazy && customerScale.count != null ? `${customerScale.count.toLocaleString()} รายการทั้งหมด` : `${activeCount(db.customers)} รายการที่ใช้งาน`,
  '/admin/settings/options': `${activeCount(db.optionGroups)} กลุ่มที่ใช้งาน`,
  '/admin/settings/bundles': `${activeCount(db.bundles)} ชุดที่ใช้งาน`,
  '/admin/settings/pricing': `${activeCount(db.priceLists)} แบบราคาพิเศษที่ใช้งาน`,
  '/admin/settings/shop': `นัดรับ ${db.shop.open}–${db.shop.close} ทุก ${db.shop.slotMinutes} นาที`,
  '/admin/settings/profit': 'กราฟ ขายดี รับเงิน ลูกค้า ตามช่วงวัน',
  '/admin/settings/birthdays': `${upcomingBirthdays().filter((b) => !b.greeted).length} คน ภายใน ${db.shop.birthdayDays} วัน`,
  '/admin/settings/retail': `${activeCount(db.retailItems)} รายการ · แสดงหน้าร้านเว็บ ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} · สต็อกหมด ${db.retailItems.filter((x) => x.active !== false && x.stock === 0).length}`,
  '/admin/settings/promos': `ส่วนลด ${db.posDiscounts.filter((x) => x.active !== false).length} · บันเดิ้ล ${db.posBundles.filter((x) => x.active !== false).length} · คะแนนพิเศษ ${db.pointPromos.filter((x) => x.active !== false).length} (ที่เปิดใช้)`,
  '/admin/settings/integrations': `Facebook · SMS · Telegram · คิว ${db.outbox.length} ข้อความ`,
  '/admin/settings/sms': `เกตเวย์บนโทรศัพท์ · ส่งทดสอบ · ตรวจสถานะงาน`,
  '/admin/settings/loyalty': `${activeCount(db.rewards)} ของแลก · ${activeCount(db.gachaPrizes)} รางวัลกาชา`,
  '/admin/settings/storefront': `เมนู ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} สินค้า · รีวิวรออนุมัติ ${db.reviews.filter((r) => r.status === 'pending').length}`,
  '/admin/settings/photo-requests': `${pendingPhotoRequests()} รอตรวจสอบ · ลูกค้าแจ้งไม่ให้ใช้รูปงาน`,
  '/admin/settings/gallery': `${db.cakeGallery.length} รูป · ติดแท็กตัวเลือก หน้าเว็บเปลี่ยนรูปตามที่ลูกค้าเลือก`,
  '/admin/settings/legal': `เวอร์ชัน ${db.legal.docs.privacy.version}/${db.legal.docs.terms.version}/${db.legal.docs.cookie.version} · ร่าง แก้ได้`,
  '/admin/settings/bot': `${db.bot.enabled ? (db.bot.mode === 'auto' ? 'เปิด · ตอบเอง' : 'เปิด · แนะนำให้กดส่ง') : 'ปิดอยู่'} · ที่เรียนรู้ ${db.bot.learned.length}`,
  '/admin/settings/links': `ลิงก์ย่อ ${db.shortLinks.length} · ลิงก์ออร์เดอร์ที่ใช้อยู่ ${db.orderLinks.length}`,
  '/admin/settings/retention': retentionSummary(db.retention),
  '/admin/settings/errors': 'แอปพนักงานส่งข้อผิดพลาดมาเก็บอัตโนมัติ · เก็บ 30 วัน',
  '/admin/settings/sync-review': syncOpen.value ? `${syncOpen.value} รายการรอตรวจ · ส่งซ้ำ หรือปิดพร้อมเหตุผล` : 'ออร์เดอร์ที่ระบบไม่รับ · ตรวจ ส่งซ้ำ หรือปิดพร้อมเหตุผล',
  '/admin/settings/deletion-requests': `${pendingDeletions()} รอตรวจสอบ`,
  '/admin/settings/ingredients': `${activeCount(db.ingredients)} รายการที่ใช้งาน`,
  '/admin/settings/users': `${activeCount(db.users)} คนที่ใช้งาน · ติ๊กสิทธิ์รายคน`,
}))
// ป้ายตัวเลข = งานที่รอให้ร้านตรวจ (ไม่ใช่จำนวนรายการทั้งหมด)
const BADGE = computed(() => ({
  '/admin/settings/photo-requests': pendingPhotoRequests(),
  '/admin/settings/deletion-requests': pendingDeletions(),
  '/admin/settings/storefront': db.reviews.filter((r) => r.status === 'pending').length,
  '/admin/settings/sync-review': syncOpen.value,
}))
const q = ref('')
const items = computed(() => SETTINGS_PAGES.filter((x) => can(x.perm || 'manage')).map((x) => ({ ...x, desc: DESC.value[x.to], badge: BADGE.value[x.to] || 0 })))
const groups = computed(() => groupSettings(items.value, q.value))
const todo = computed(() => items.value.filter((x) => x.badge))
</script>

<template>
  <ManageShell title="ตั้งค่า" back="/admin/orders" :toolbar="false">
    <label class="relative mb-4 block">
      <span class="sr-only">ค้นหาหน้าตั้งค่า</span>
      <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
      <input v-model="q" type="search" class="input bg-white pl-10" placeholder="ค้นหาการตั้งค่า เช่น พร้อมเพย์ บอท สิทธิ์" />
    </label>

    <section v-if="todo.length && !q.trim()" class="mb-5 rounded-2xl border border-warning-200 bg-warning-50 p-3" aria-label="งานที่รอตรวจ">
      <h2 class="mb-2 flex items-center gap-1.5 text-sm font-semibold text-amber-900"><AppIcon name="alert" :size="16" /> รอให้ตรวจ</h2>
      <div class="flex flex-wrap gap-2">
        <RouterLink v-for="it in todo" :key="it.to" :to="it.to" class="inline-flex min-h-9 items-center gap-2 rounded-full bg-white px-3 text-sm font-medium text-stone-800 shadow-sm ring-1 ring-amber-200 hover:bg-warning-100">
          {{ it.title }} <span class="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{{ it.badge }}</span>
        </RouterLink>
      </div>
    </section>

    <p v-if="!groups.length" class="card py-10 text-center text-sm text-stone-500">ไม่พบการตั้งค่าที่ตรงกับ "{{ q }}"</p>

    <section v-for="g in groups" :key="g.key" class="mb-6" :aria-labelledby="`sg-${g.key}`">
      <h2 :id="`sg-${g.key}`" class="mb-2 px-1 text-sm font-semibold text-stone-500">{{ g.title }}</h2>
      <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        <RouterLink
          v-for="it in g.items"
          :key="it.to"
          :to="it.to"
          class="card flex items-center gap-3 py-3 transition hover:border-brand-200 hover:shadow-md active:scale-[0.99]"
        >
          <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl" :class="g.tone"><AppIcon :name="it.icon" :size="22" /></span>
          <span class="min-w-0 flex-1">
            <span class="flex items-center gap-2">
              <span class="font-display text-stone-900">{{ it.title }}</span>
              <span v-if="it.badge" class="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white" :aria-label="`รอตรวจ ${it.badge} รายการ`">{{ it.badge }}</span>
            </span>
            <span class="line-clamp-2 block text-sm text-stone-600">{{ it.desc }}</span>
          </span>
          <AppIcon name="next" class="shrink-0 text-stone-500" />
        </RouterLink>
      </div>
    </section>
  </ManageShell>
</template>
