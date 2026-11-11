<script setup>
import { computed, ref } from 'vue'
import { useRoute } from 'vue-router'
import { can } from '../data/store'
import { SETTINGS_PAGES } from '../lib/settingsPages'
import { useLeaveGuard } from '../lib/leaveGuard'
import AppIcon from './AppIcon.vue'
import AppSwitch from './AppSwitch.vue'
import BuildInfo from './BuildInfo.vue'

defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: '' },
  back: { type: String, default: '/admin/settings' },
  addLabel: { type: String, default: '' },
  searchPlaceholder: { type: String, default: 'ค้นหา' },
  toolbar: { type: Boolean, default: true },
  narrow: { type: Boolean, default: false }, // หน้าฟอร์ม/ตั้งค่า: จำกัดความกว้างให้อ่านง่าย (หน้ารายการใช้เต็มพื้นที่)
  perm: { type: String, default: 'manage' }, // สิทธิ์ที่ต้องมีจึงเห็นหน้านี้
  guard: { type: Boolean, default: false }, // หน้าฟอร์ม: เตือนก่อนออกถ้าแก้ไขแล้วยังไม่กด "บันทึก..."
})
const emit = defineEmits(['add'])
// ตรวจการแก้ไขจากเหตุการณ์ของช่องกรอกในหน้า (ช่องค้นหาไม่นับ) · กดปุ่มที่ขึ้นต้นว่า "บันทึก" = ล้างสถานะ (ฟอร์มใน modal มีตัวป้องกันของตัวเอง)
const edited = ref(false)
const onEdit = (e) => { if (e.target?.type !== 'search') edited.value = true }
const onClickCap = (e) => { if (e.target.closest?.('button')?.textContent.trim().startsWith('บันทึก')) edited.value = false }
useLeaveGuard(() => edited.value)
// PC: เมนูข้างรายการหน้าตั้งค่า (เฉพาะหน้าย่อย /admin/settings/*) สลับหน้าได้โดยไม่ต้องกลับหน้าการ์ด
const route = useRoute()
const side = computed(() => route.path.startsWith('/admin/settings/') ? SETTINGS_PAGES.filter((x) => can(x.perm || 'manage')) : [])
const q = defineModel('q', { type: String, default: '' })
const showInactive = defineModel('inactive', { type: Boolean, default: false })
</script>

<template>
  <div v-if="!can(perm)" class="card flex flex-col items-center gap-3 py-12 text-center">
    <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-500"><AppIcon name="user" :size="28" /></span>
    <h1 class="text-base font-semibold text-stone-800">ไม่มีสิทธิ์เข้าหน้านี้</h1>
    <p class="text-sm text-stone-600">ผู้ใช้นี้ยังไม่ได้รับสิทธิ์ ขอให้ผู้ดูแลติ๊กสิทธิ์ให้ที่ ตั้งค่า → ผู้ใช้ & สิทธิ์</p>
    <RouterLink to="/admin/orders" class="btn-soft">กลับไปหน้าออร์เดอร์</RouterLink>
  </div>

  <div v-else :class="side.length ? 'lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start lg:gap-6' : ''" @input.capture="guard && onEdit($event)" @change.capture="guard && onEdit($event)" @click.capture="guard && onClickCap($event)">
    <nav v-if="side.length" aria-label="เมนูตั้งค่า" class="sticky top-20 hidden max-h-[calc(100vh-6rem)] overflow-y-auto rounded-2xl bg-white p-1.5 shadow-sm ring-1 ring-stone-200 lg:block">
      <RouterLink
        v-for="p in side"
        :key="p.to"
        :to="p.to"
        class="flex min-h-9 items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-stone-700 hover:bg-stone-50"
        active-class="bg-brand-50 font-semibold text-brand-700"
      ><AppIcon :name="p.icon" :size="16" class="shrink-0" /><span class="min-w-0">{{ p.title }}</span></RouterLink>
    </nav>
    <div :class="narrow ? 'mx-auto w-full max-w-4xl xl:max-w-5xl' : 'min-w-0'">
    <div class="mb-4 flex items-center gap-2">
      <RouterLink :to="back" class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm hover:bg-brand-50" aria-label="กลับ">
        <AppIcon name="back" :size="20" />
      </RouterLink>
      <div class="min-w-0 flex-1">
        <h1 class="page-title truncate">{{ title }}</h1>
        <p v-if="subtitle" class="truncate text-sm text-stone-500">{{ subtitle }}</p>
      </div>
      <button v-if="addLabel" class="btn-primary px-3 sm:px-4" :aria-label="addLabel" @click="emit('add')">
        <AppIcon name="plus" /> <span class="hidden sm:inline">{{ addLabel }}</span>
      </button>
    </div>

    <div v-if="toolbar" class="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <label class="relative block min-w-0 flex-1">
        <span class="sr-only">{{ searchPlaceholder }}</span>
        <AppIcon name="search" class="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-stone-400" />
        <input v-model="q" type="search" class="input bg-white pl-10" :placeholder="searchPlaceholder" />
      </label>
      <AppSwitch v-model="showInactive" label="แสดงที่ปิดใช้งาน" class="shrink-0 px-1 lg:min-h-8" />
    </div>

    <slot />
    <BuildInfo />
    </div>
  </div>
</template>
