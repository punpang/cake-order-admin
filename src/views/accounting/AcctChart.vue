<script setup>
import { computed, reactive, ref } from 'vue'
import { db, can } from '../../data/store'
import { saveAccount, removeAccount, allEntries } from '../../data/acct'
import { KIND_LABEL } from '../../lib/acct/chart'
import { askConfirm } from '../../lib/confirm'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// ผังบัญชี: ดู/เพิ่ม/แก้ (บัญชีที่ระบบใช้ดึงอัตโนมัติ ปิด/ลบไม่ได้)
const groups = computed(() => Object.keys(KIND_LABEL).map((k) => ({ kind: k, title: KIND_LABEL[k], list: db.acct.accounts.filter((a) => a.kind === k) })))
const used = computed(() => new Set(allEntries().flatMap((e) => e.lines.map((l) => l.account))))
const open = ref(false)
const f = reactive({ id: '', name: '', kind: 'expense', active: true, quick: true, taxDeductible: true, isNew: true, system: false })
const error = ref('')
function edit(a) {
  Object.assign(f, a ? { ...a, isNew: false } : { id: '', name: '', kind: 'expense', active: true, quick: true, taxDeductible: true, isNew: true, system: false })
  error.value = ''
  open.value = true
}
function save() {
  const r = saveAccount({ ...f })
  if (r.error) return (error.value = r.error)
  open.value = false
}
async function del() {
  if (!(await askConfirm({ title: 'ลบบัญชี', message: `${f.id} ${f.name}`, okText: 'ลบ', danger: true }))) return
  const r = removeAccount(f.id)
  if (r.error) return (error.value = r.error)
  open.value = false
}
</script>

<template>
  <div class="space-y-3">
    <button v-if="can('acctSettings')" class="btn-primary w-full" @click="edit(null)">+ เพิ่มบัญชี</button>
    <section v-for="g in groups" :key="g.kind" class="card">
      <div class="card-title">{{ g.title }} <span class="text-xs font-normal text-stone-400">{{ g.list.length }}</span></div>
      <ul class="divide-y divide-stone-100 text-sm">
        <li v-for="a in g.list" :key="a.id" class="flex items-center gap-2 py-2" :class="a.active === false ? 'opacity-50' : ''">
          <span class="w-12 shrink-0 tabular-nums text-stone-500">{{ a.id }}</span>
          <span class="min-w-0 flex-1 break-words">{{ a.name }}<span v-if="a.system" class="ml-1 rounded-full bg-stone-100 px-1.5 text-xs text-stone-500">ระบบใช้</span><span v-if="a.active === false" class="ml-1 text-xs text-stone-400">ปิดใช้งาน</span></span>
          <button v-if="can('acctSettings')" class="text-xs text-brand-700 underline" :aria-label="`แก้ ${a.id}`" @click="edit(a)">แก้</button>
        </li>
      </ul>
    </section>
    <AppModal v-if="open" :title="f.isNew ? 'เพิ่มบัญชี' : 'แก้บัญชี'" @close="open = false">
      <div class="space-y-3">
        <div class="grid grid-cols-3 gap-3"><div><label class="label">รหัส</label><input v-model="f.id" inputmode="numeric" maxlength="4" class="input" :disabled="!f.isNew" aria-label="รหัสบัญชี" /></div><div class="col-span-2"><label class="label">ชื่อบัญชี</label><input v-model="f.name" class="input" maxlength="80" aria-label="ชื่อบัญชี" /></div></div>
        <div><div class="label">หมวด</div><div class="flex flex-wrap gap-2"><button v-for="(l, k) in KIND_LABEL" :key="k" type="button" class="chip" :class="f.kind === k ? 'chip-on' : 'chip-off'" :disabled="f.system" @click="f.kind = k">{{ l }}</button></div></div>
        <AppSwitch v-model="f.quick" label="ให้เลือกในฟอร์มบันทึกรายได้/ค่าใช้จ่าย" />
        <AppSwitch v-if="f.kind === 'expense'" v-model="f.taxDeductible" label="หักเป็นรายจ่ายทางภาษีได้ตามปกติ" />
        <AppSwitch v-model="f.active" label="ใช้งาน" :disabled="f.system" />
        <p v-if="error" class="text-sm text-danger-700" role="alert">{{ error }}</p>
      </div>
      <template #footer><button v-if="!f.isNew && !f.system && !used.has(f.id)" class="btn-danger sm:mr-auto" @click="del">ลบ</button><button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button></template>
    </AppModal>
  </div>
</template>
