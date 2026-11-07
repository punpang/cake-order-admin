<script setup>
import { computed } from 'vue'
import { db, upcomingBirthdays, pendingDeletions, pendingPhotoRequests, can } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

const activeCount = (list) => list.filter((x) => x.active !== false).length

const items = computed(() => [
  { to: '/admin/manage/customers', icon: 'users', title: 'ลูกค้า', desc: `${activeCount(db.customers)} รายการที่ใช้งาน` },
  { to: '/admin/manage/options', icon: 'tag', title: 'ตัวเลือก + ราคา', desc: `${activeCount(db.optionGroups)} กลุ่มที่ใช้งาน` },
  { to: '/admin/manage/pricing', icon: 'wallet', title: 'การกำหนดราคา', desc: `${activeCount(db.priceLists)} แบบราคาพิเศษที่ใช้งาน` },
  { to: '/admin/manage/shop', icon: 'clock', title: 'ตั้งค่าร้าน', desc: `นัดรับ ${db.shop.open}–${db.shop.close} ทุก ${db.shop.slotMinutes} นาที` },
  { to: '/admin/manage/profit', icon: 'wallet', title: 'ยอดขาย & กำไร', desc: 'กราฟ ขายดี รับเงิน ลูกค้า ตามช่วงวัน' },
  { to: '/admin/manage/birthdays', icon: 'cake', title: 'เตือนวันเกิด', desc: `${upcomingBirthdays().filter((b) => !b.greeted).length} คน ภายใน ${db.shop.birthdayDays} วัน` },
  { to: '/admin/manage/retail', icon: 'pos', title: 'สินค้า (POS / สินค้าสำเร็จ)', desc: `${activeCount(db.retailItems)} รายการ · แสดงหน้าร้านเว็บ ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} · สต็อกหมด ${db.retailItems.filter((x) => x.active !== false && x.stock === 0).length}` },
  { to: '/admin/manage/promos', icon: 'tag', title: 'โปรโมชัน POS / คะแนนพิเศษ', desc: `ส่วนลด ${db.posDiscounts.filter((x) => x.active !== false).length} · บันเดิ้ล ${db.posBundles.filter((x) => x.active !== false).length} · คะแนนพิเศษ ${db.pointPromos.filter((x) => x.active !== false).length} (ที่เปิดใช้)` },
  { to: '/admin/manage/integrations', icon: 'phone', title: 'การเชื่อมต่อ & แจ้งเตือน', desc: `LINE OA · Facebook · SMS · Telegram (จำลอง) · คิว ${db.outbox.length} ข้อความ` },
  { to: '/admin/manage/loyalty', icon: 'tag', title: 'คะแนน & รางวัล', desc: `${activeCount(db.rewards)} ของแลก · ${activeCount(db.gachaPrizes)} รางวัลกาชา` },
  { to: '/admin/manage/storefront', icon: 'store', title: 'หน้าร้าน (เว็บลูกค้า)', desc: `เมนู ${db.retailItems.filter((x) => x.active !== false && x.showOnStore).length} สินค้า · รีวิวรออนุมัติ ${db.reviews.filter((r) => r.status === 'pending').length}` },
  { to: '/admin/manage/photo-requests', icon: 'shield', title: 'คำขอไม่เผยแพร่รูป', desc: `${pendingPhotoRequests()} รอตรวจสอบ · ลูกค้าแจ้งไม่ให้ใช้รูปงาน` },
  { to: '/admin/manage/gallery', icon: 'image', title: 'คลังรูปเค้กสั่งทำ', desc: `${db.cakeGallery.length} รูป · ติดแท็กตัวเลือก หน้าเว็บเปลี่ยนรูปตามที่ลูกค้าเลือก` },
  { to: '/admin/manage/legal', icon: 'shield', title: 'PDPA / คุกกี้ / เงื่อนไข', desc: `เวอร์ชัน ${db.legal.docs.privacy.version}/${db.legal.docs.terms.version}/${db.legal.docs.cookie.version} · ร่าง แก้ได้` },
  { to: '/admin/manage/bot', icon: 'chat', title: 'บอทตอบแชท', desc: `${db.bot.enabled ? (db.bot.mode === 'auto' ? 'เปิด · ตอบเอง' : 'เปิด · แนะนำให้กดส่ง') : 'ปิดอยู่'} · ที่เรียนรู้ ${db.bot.learned.length}` },
  { to: '/admin/manage/links', icon: 'link', title: 'ลิงก์ย่อ & ลิงก์ออร์เดอร์', desc: `ลิงก์ย่อ ${db.shortLinks.length} · ลิงก์ออร์เดอร์ที่ใช้อยู่ ${db.orderLinks.length}` },
  { to: '/admin/manage/deletion-requests', icon: 'shield', title: 'คำขอลบข้อมูลลูกค้า', desc: `${pendingDeletions()} รอตรวจสอบ` },
  { to: '/admin/manage/ingredients', icon: 'basket', title: 'วัตถุดิบ', desc: `${activeCount(db.ingredients)} รายการที่ใช้งาน` },
  { to: '/admin/accounting', icon: 'wallet', title: 'บัญชี', desc: `สมุดรายวัน · บันทึกรายได้/ค่าใช้จ่าย · รายงาน · ปิดงวด`, perm: 'acctView' },
  { to: '/admin/manage/users', icon: 'shield', title: 'ผู้ใช้ & สิทธิ์', desc: `${activeCount(db.users)} คนที่ใช้งาน · ติ๊กสิทธิ์รายคน`, perm: 'manageUsers' },
].filter((x) => can(x.perm || 'manage')))
</script>

<template>
  <ManageShell title="จัดการ" back="/admin/orders" :toolbar="false">
    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <RouterLink
        v-for="it in items"
        :key="it.to"
        :to="it.to"
        class="card flex items-center gap-4 transition hover:border-brand-300 focus-visible:ring-4 focus-visible:ring-brand-200 focus-visible:outline-none active:scale-[0.99]"
      >
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><AppIcon :name="it.icon" :size="24" /></span>
        <span class="min-w-0 flex-1">
          <span class="block font-semibold text-stone-900">{{ it.title }}</span>
          <span class="block text-sm text-stone-500">{{ it.desc }}</span>
        </span>
        <AppIcon name="next" class="text-stone-300" />
      </RouterLink>
    </div>
  </ManageShell>
</template>
