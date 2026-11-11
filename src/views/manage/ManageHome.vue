<script setup>
import { computed } from 'vue'
import { db, upcomingBirthdays, pendingDeletions, pendingPhotoRequests, can } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import { SETTINGS_PAGES } from '../../lib/settingsPages'

const TONES = ['bg-brand-100 text-brand-700', 'bg-orange-100 text-orange-800', 'bg-amber-100 text-amber-800', 'bg-matcha-soft text-stone-800']
const activeCount = (list) => list.filter((x) => x.active !== false).length

const DESC = computed(() => ({
  '/admin/dashboard': 'ออร์เดอร์ค้าง · แชท Facebook · การเข้าชมหน้าเว็บ · งานค้าง',
  '/admin/settings/customers': `${activeCount(db.customers)} รายการที่ใช้งาน`,
  '/admin/settings/options': `${activeCount(db.optionGroups)} กลุ่มที่ใช้งาน`,
  '/admin/settings/pricing': `${activeCount(db.priceLists)} แบบราคาพิเศษที่ใช้งาน`,
  '/admin/settings/shop': `นัดรับ ${db.shop.open}–${db.shop.close} ทุก ${db.shop.slotMinutes} นาที`,
  '/admin/settings/profit': 'กราฟ ขายดี รับเงิน ลูกค้า ตามช่วงวัน',
  '/admin/settings/birthdays': `${upcomingBirthdays().filter((b) => !b.greeted).length} คน ภายใน ${db.shop.birthdayDays} วัน`,
  '/admin/settings/retail': `${activeCount(db.retailItems)} รายการ · แสดงหน้าร้านเว็บ ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} · สต็อกหมด ${db.retailItems.filter((x) => x.active !== false && x.stock === 0).length}`,
  '/admin/settings/promos': `ส่วนลด ${db.posDiscounts.filter((x) => x.active !== false).length} · บันเดิ้ล ${db.posBundles.filter((x) => x.active !== false).length} · คะแนนพิเศษ ${db.pointPromos.filter((x) => x.active !== false).length} (ที่เปิดใช้)`,
  '/admin/settings/integrations': `LINE OA · Facebook · SMS · Telegram · คิว ${db.outbox.length} ข้อความ`,
  '/admin/settings/sms': `เกตเวย์บนโทรศัพท์ · ส่งทดสอบ · ตรวจสถานะงาน`,
  '/admin/settings/loyalty': `${activeCount(db.rewards)} ของแลก · ${activeCount(db.gachaPrizes)} รางวัลกาชา`,
  '/admin/settings/storefront': `เมนู ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} สินค้า · รีวิวรออนุมัติ ${db.reviews.filter((r) => r.status === 'pending').length}`,
  '/admin/settings/photo-requests': `${pendingPhotoRequests()} รอตรวจสอบ · ลูกค้าแจ้งไม่ให้ใช้รูปงาน`,
  '/admin/settings/gallery': `${db.cakeGallery.length} รูป · ติดแท็กตัวเลือก หน้าเว็บเปลี่ยนรูปตามที่ลูกค้าเลือก`,
  '/admin/settings/legal': `เวอร์ชัน ${db.legal.docs.privacy.version}/${db.legal.docs.terms.version}/${db.legal.docs.cookie.version} · ร่าง แก้ได้`,
  '/admin/settings/bot': `${db.bot.enabled ? (db.bot.mode === 'auto' ? 'เปิด · ตอบเอง' : 'เปิด · แนะนำให้กดส่ง') : 'ปิดอยู่'} · ที่เรียนรู้ ${db.bot.learned.length}`,
  '/admin/settings/links': `ลิงก์ย่อ ${db.shortLinks.length} · ลิงก์ออร์เดอร์ที่ใช้อยู่ ${db.orderLinks.length}`,
  '/admin/settings/deletion-requests': `${pendingDeletions()} รอตรวจสอบ`,
  '/admin/settings/ingredients': `${activeCount(db.ingredients)} รายการที่ใช้งาน`,
  '/admin/settings/users': `${activeCount(db.users)} คนที่ใช้งาน · ติ๊กสิทธิ์รายคน`,
}))
const items = computed(() => SETTINGS_PAGES.filter((x) => can(x.perm || 'manage')).map((x) => ({ ...x, desc: DESC.value[x.to] })))
</script>

<template>
  <ManageShell title="ตั้งค่า" back="/admin/orders" :toolbar="false">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
      <RouterLink
        v-for="(it, n) in items"
        :key="it.to"
        :to="it.to"
        class="card flex items-center gap-4 rounded-3xl border-transparent shadow-md transition hover:shadow-lg focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.99]"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full" :class="TONES[n % TONES.length]"><AppIcon :name="it.icon" :size="24" /></span>
        <span class="min-w-0 flex-1">
          <span class="block font-display text-stone-900">{{ it.title }}</span>
          <span class="block text-sm text-stone-600">{{ it.desc }}</span>
        </span>
        <AppIcon name="next" class="text-stone-300" />
      </RouterLink>
    </div>
  </ManageShell>
</template>
