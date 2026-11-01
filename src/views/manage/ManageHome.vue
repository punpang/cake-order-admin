<script setup>
import { computed } from 'vue'
import { db, upcomingBirthdays } from '../../data/store'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

const activeCount = (list) => list.filter((x) => x.active !== false).length

const items = computed(() => [
  { to: '/manage/customers', icon: 'users', title: 'ลูกค้า', desc: `${activeCount(db.customers)} รายการที่ใช้งาน` },
  { to: '/manage/products', icon: 'cake', title: 'สินค้า (เค้กสำเร็จ)', desc: `${activeCount(db.products)} รายการที่ใช้งาน` },
  { to: '/manage/options', icon: 'tag', title: 'ตัวเลือก + ราคา', desc: `${activeCount(db.optionGroups)} กลุ่มที่ใช้งาน` },
  { to: '/manage/pricing', icon: 'wallet', title: 'การกำหนดราคา', desc: `${activeCount(db.priceLists)} แบบราคาพิเศษที่ใช้งาน` },
  { to: '/manage/shop', icon: 'clock', title: 'ตั้งค่าร้าน', desc: `นัดรับ ${db.shop.open}–${db.shop.close} ทุก ${db.shop.slotMinutes} นาที` },
  { to: '/manage/profit', icon: 'wallet', title: 'ยอดขาย & กำไร', desc: 'กราฟ ขายดี รับเงิน ลูกค้า ตามช่วงวัน' },
  { to: '/manage/birthdays', icon: 'cake', title: 'เตือนวันเกิด', desc: `${upcomingBirthdays().filter((b) => !b.greeted).length} คน ภายใน ${db.shop.birthdayDays} วัน` },
  { to: '/manage/loyalty', icon: 'tag', title: 'คะแนน & รางวัล', desc: `${activeCount(db.rewards)} ของแลก · ${activeCount(db.gachaPrizes)} รางวัลกาชา` },
  { to: '/member', icon: 'user', title: 'หน้าลูกค้า (จำลอง)', desc: 'คะแนน แลกของ หมุนกาชา' },
  { to: '/manage/ingredients', icon: 'basket', title: 'วัตถุดิบ', desc: `${activeCount(db.ingredients)} รายการที่ใช้งาน` },
  { to: '/manage/users', icon: 'shield', title: 'ผู้ใช้', desc: `${activeCount(db.users)} คนที่ใช้งาน` },
])
</script>

<template>
  <ManageShell title="จัดการ" back="/orders" :toolbar="false">
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
