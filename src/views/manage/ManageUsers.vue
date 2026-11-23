<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveUser, session, can } from '../../data/store'
import { ROLES, PERM_GROUPS, rolePreset, ALL_PERMS } from '../../lib/constants'
import { askConfirm } from '../../lib/confirm'
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
const blank = () => ({ id: null, name: '', email: '', role: 'sales', active: true, perms: rolePreset('sales') })
const form = reactive(blank())
const error = ref('')
// ---- ช่องติ๊กสิทธิ์ ----
const permQ = ref('')
const openGroups = ref({})
const has = (k) => form.perms.includes(k)
const flip = (k) => (has(k) ? form.perms.splice(form.perms.indexOf(k), 1) : form.perms.push(k))
const shownGroups = computed(() => {
  const s = permQ.value.trim().toLowerCase()
  return PERM_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => !s || i.label.toLowerCase().includes(s) || (i.hint || '').toLowerCase().includes(s)) })).filter((g) => g.items.length)
})
const groupOn = (g) => g.items.filter((i) => has(i.key)).length
const isOpen = (g) => (permQ.value.trim() ? true : !!openGroups.value[g.title])
function toggleGroup(g) {
  const all = groupOn(g) === g.items.length
  for (const i of g.items) {
    if (all && has(i.key)) flip(i.key)
    else if (!all && !has(i.key)) flip(i.key)
  }
}
const usePreset = () => { form.perms = rolePreset(form.role) }
const isPreset = computed(() => { const p = rolePreset(form.role); return p.length === form.perms.length && p.every((k) => form.perms.includes(k)) })
const log = computed(() => db.permLog.slice(0, 8))
const userName = (id) => db.users.find((u) => u.id === id)?.name || '-'
const labelOf = Object.fromEntries(PERM_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label])))
function edit(u) {
  Object.assign(form, u ? { ...u, perms: [...(u.perms || rolePreset(u.role))] } : blank())
  error.value = ''
  permQ.value = ''
  openGroups.value = {}
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อ')
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) return (error.value = 'อีเมลไม่ถูกต้อง')
  const dup = db.users.find((u) => u.id !== form.id && u.email.toLowerCase() === form.email.trim().toLowerCase())
  if (dup) return (error.value = 'อีเมลนี้มีผู้ใช้อยู่แล้ว')
  if (!(await confirmDeactivate(db.users, form, form.name))) return
  if (form.id === session.userId && !form.perms.includes('manageUsers') && (db.users.find((x) => x.id === form.id)?.perms || []).includes('manageUsers')) {
    if (!(await askConfirm({ title: 'ถอดสิทธิ์จัดการผู้ใช้ของตัวเอง', message: 'หลังบันทึก คุณจะแก้สิทธิ์ผู้ใช้ไม่ได้อีก (ต้องให้คนอื่นที่มีสิทธิ์แก้ให้)', okText: 'ถอดสิทธิ์', danger: true }))) return
  }
  const r = saveUser({ ...form, perms: [...form.perms] })
  if (r.error) return (error.value = r.error)
  open.value = false
}
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    perm="manageUsers"
    title="ผู้ใช้"
    :subtitle="`${list.length} คน`"
    add-label="เพิ่มผู้ใช้"
    search-placeholder="ค้นหา ชื่อ / อีเมล"
    @add="edit(null)"
  >
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบผู้ใช้</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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

    <section v-if="log.length" class="card mt-4">
      <div class="card-title">ประวัติแก้สิทธิ์ล่าสุด</div>
      <ul class="divide-y divide-stone-100 text-xs">
        <li v-for="l in log" :key="l.id" class="py-2">
          <b class="text-stone-800">{{ userName(l.userId) }}</b> · {{ l.isNew ? 'เพิ่มผู้ใช้' : 'แก้สิทธิ์' }} โดย {{ userName(l.by) }}
          <span v-if="l.added.length" class="block text-emerald-700">+ {{ l.added.map((k) => labelOf[k] || k).join(', ') }}</span>
          <span v-if="l.removed.length" class="block text-rose-700">− {{ l.removed.map((k) => labelOf[k] || k).join(', ') }}</span>
        </li>
      </ul>
    </section>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'" wider @close="open = false">
      <div class="space-y-4 dlg-cols">
        <div><label class="label">ชื่อ <span class="text-rose-600">*</span></label><input v-model="form.name" class="input" /></div>
        <div><label class="label">อีเมล <span class="text-rose-600">*</span></label><input v-model="form.email" type="email" inputmode="email" autocomplete="off" class="input" /></div>
        <div>
          <div class="label">บทบาท</div>
          <div class="grid grid-cols-2 gap-2">
            <button
              v-for="(label, key) in ROLES"
              :key="key"
              type="button"
              class="flex h-11 items-center justify-center gap-1.5 rounded-xl border text-sm font-medium transition"
              :class="form.role === key ? 'border-brand-500 bg-brand-50 text-brand-800 ring-1 ring-brand-500' : 'border-stone-200 text-stone-600 hover:border-brand-300'"
              @click="form.role = key; usePreset()"
            >
              <AppIcon v-if="form.role === key" name="check" :size="14" /> {{ label }}
            </button>
          </div>
        </div>
        <div>
          <div class="mb-1.5 flex items-center justify-between gap-2">
            <div class="label mb-0">สิทธิ์การใช้งาน <span class="font-normal text-stone-400">({{ form.perms.length }}/{{ ALL_PERMS.length }})</span></div>
            <button type="button" class="text-sm text-brand-700 underline disabled:text-stone-400 disabled:no-underline" :disabled="isPreset" @click="usePreset">ใช้ค่าตั้งต้นของ{{ ROLES[form.role] }}</button>
          </div>
          <input v-model="permQ" type="search" class="input mb-2" placeholder="ค้นหาสิทธิ์" aria-label="ค้นหาสิทธิ์" />
          <div class="space-y-2">
            <div v-for="g in shownGroups" :key="g.title" class="rounded-xl border border-stone-200/70">
              <button type="button" class="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left" :aria-expanded="isOpen(g)" @click="openGroups[g.title] = !isOpen(g)">
                <span class="font-medium text-stone-800">{{ g.title }} <span class="text-xs font-normal text-stone-400">{{ groupOn(g) }}/{{ g.items.length }}</span></span>
                <span class="text-stone-400" aria-hidden="true">{{ isOpen(g) ? '▴' : '▾' }}</span>
              </button>
              <div v-if="isOpen(g)" class="space-y-0.5 border-t border-stone-100 px-3 py-2">
                <label class="flex items-center gap-2 py-1 text-sm font-medium text-brand-700"><input type="checkbox" class="h-5 w-5 accent-brand-600" :checked="groupOn(g) === g.items.length" @change="toggleGroup(g)" /> ติ๊กทั้งกลุ่ม</label>
                <label v-for="i in g.items" :key="i.key" class="flex items-start gap-2 py-1.5 text-sm text-stone-700">
                  <input type="checkbox" class="mt-0.5 h-5 w-5 shrink-0 accent-brand-600" :checked="has(i.key)" :aria-label="i.label" @change="flip(i.key)" />
                  <span class="min-w-0">{{ i.label }}<span v-if="i.hint" class="block text-xs text-stone-400">{{ i.hint }}</span></span>
                </label>
              </div>
            </div>
          </div>
        </div>
        <AppSwitch v-model="form.active" label="ใช้งาน" />
        <p class="rounded-xl bg-stone-50 p-3 text-xs text-stone-500">ยังไม่ได้ต่อ Supabase: ข้อมูลผู้ใช้เก็บไว้ชั่วคราว และยังไม่มีการล็อกอินจริง</p>
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
