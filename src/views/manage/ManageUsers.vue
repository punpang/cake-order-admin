<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveUser } from '../../data/store'
import { ROLES } from '../../lib/constants'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const q = ref('')
const inactive = ref(false)

const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.users
    .filter((u) => inactive.value || u.active !== false)
    .filter((u) => !s || [u.name, u.email].some((v) => v?.toLowerCase().includes(s)))
})

const ROLE_CLS = {
  admin: 'bg-brand-50 text-brand-700',
  sales: 'bg-sky-50 text-sky-700',
  baker: 'bg-orange-50 text-orange-700',
  driver: 'bg-emerald-50 text-emerald-700',
}

const open = ref(false)
const blank = () => ({ id: null, name: '', email: '', role: 'sales', active: true })
const form = reactive(blank())
const error = ref('')
function edit(u) {
  Object.assign(form, u ? { ...u } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อ')
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return (error.value = 'อีเมลไม่ถูกต้อง')
  const dup = db.users.find((u) => u.id !== form.id && u.email.toLowerCase() === form.email.trim().toLowerCase())
  if (dup) return (error.value = 'อีเมลนี้มีผู้ใช้อยู่แล้ว')
  if (!(await confirmDeactivate(db.users, form, form.name))) return
  saveUser({ ...form })
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="ผู้ใช้"
    :subtitle="`${list.length} คน`"
    add-label="เพิ่มผู้ใช้"
    search-placeholder="ค้นหา ชื่อ / อีเมล"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบผู้ใช้</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <button
        v-for="u in list"
        :key="u.id"
        class="card flex items-center gap-3 text-left transition hover:border-brand-300 active:scale-[0.99]"
        :class="u.active === false ? 'opacity-60' : ''"
        @click="edit(u)"
      >
        <span class="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-500"><AppIcon name="user" :size="22" /></span>
        <span class="min-w-0 flex-1">
          <span class="flex items-center gap-2">
            <span class="truncate font-semibold text-stone-900">{{ u.name }}</span>
            <span v-if="u.active === false" class="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs text-stone-500">ปิดใช้งาน</span>
          </span>
          <span class="block truncate text-sm text-stone-500">{{ u.email }}</span>
        </span>
        <span class="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" :class="ROLE_CLS[u.role]">{{ ROLES[u.role] }}</span>
      </button>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" /></div>
        <div><label class="label">อีเมล <span class="text-rose-500">*</span></label><input v-model="form.email" type="email" inputmode="email" autocomplete="off" class="input" /></div>
        <div>
          <div class="label">บทบาท</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="(label, key) in ROLES"
              :key="key"
              type="button"
              class="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition"
              :class="form.role === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600 hover:border-brand-300'"
              @click="form.role = key"
            >
              <AppIcon v-if="form.role === key" name="check" :size="14" /> {{ label }}
            </button>
          </div>
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน" />
        <p class="rounded-xl bg-stone-50 p-3 text-xs text-stone-500">ยังไม่ได้ต่อ Supabase: ข้อมูลผู้ใช้เก็บไว้ชั่วคราว และยังไม่มีการล็อกอินจริง</p>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
