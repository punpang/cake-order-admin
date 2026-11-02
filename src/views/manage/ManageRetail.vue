<script setup>
import { confirmDeactivate } from '../../lib/confirm'
import { computed, reactive, ref } from 'vue'
import { db, saveRetailItem, addStock } from '../../data/store'
import { money } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

// สินค้าหน้าร้าน (POS): ชื่อ หมวด ราคา สต็อก (เว้นว่าง = ไม่นับสต็อก)
const q = ref('')
const inactive = ref(false)
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return db.retailItems.filter((x) => (inactive.value || x.active !== false) && (!s || x.name.toLowerCase().includes(s) || (x.category || '').toLowerCase().includes(s)))
})
const categories = computed(() => [...new Set(db.retailItems.map((x) => x.category).filter(Boolean))])

const open = ref(false)
const blank = () => ({ id: null, name: '', category: '', price: '', stock: '', active: true })
const form = reactive(blank())
const error = ref('')
function edit(x) {
  Object.assign(form, x ? { ...x, price: String(x.price ?? ''), stock: x.stock == null ? '' : String(x.stock) } : blank())
  error.value = ''
  open.value = true
}
async function save() {
  if (!form.name.trim()) return (error.value = 'กรอกชื่อสินค้า')
  if (!(Number(form.price) >= 0) || form.price === '') return (error.value = 'กรอกราคา')
  if (!(await confirmDeactivate(db.retailItems, form, form.name))) return
  saveRetailItem({ ...form })
  open.value = false
}

// เติมสต็อก
const stockOpen = ref(null)
const stockAdd = ref('')
function doAdd() {
  addStock(stockOpen.value, Number(stockAdd.value) || 0)
  stockOpen.value = null
  stockAdd.value = ''
}
</script>

<template>
  <ManageShell v-model:q="q" v-model:inactive="inactive" title="สินค้าหน้าร้าน (POS)" :subtitle="`${list.length} รายการ`" add-label="เพิ่มสินค้า" search-placeholder="ค้นหาชื่อ / หมวด" @add="edit(null)">
    <p v-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบสินค้า</p>
    <div class="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      <div v-for="x in list" :key="x.id" class="card flex items-center gap-2 p-2" :class="x.active === false ? 'opacity-60' : ''">
        <button type="button" class="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1.5 text-left" @click="edit(x)">
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-stone-900">{{ x.name }}</span>
            <span class="block text-xs text-stone-500">{{ x.category || '-' }} · {{ x.stock == null ? 'ไม่นับสต็อก' : `คงเหลือ ${x.stock}` }}</span>
          </span>
          <span class="shrink-0 font-semibold text-stone-900">{{ money(x.price) }}</span>
        </button>
        <button v-if="x.stock != null" type="button" class="btn-soft h-9 shrink-0 px-3 text-sm" @click="stockOpen = x; stockAdd = ''"><AppIcon name="plus" :size="14" /> สต็อก</button>
      </div>
    </div>

    <AppModal v-if="open" :title="form.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'" @close="open = false">
      <div class="space-y-4">
        <div><label class="label">ชื่อ <span class="text-rose-500">*</span></label><input v-model="form.name" class="input" /></div>
        <div>
          <label class="label">หมวด</label>
          <input v-model="form.category" class="input" list="retail-cats" placeholder="เช่น เค้กชิ้น, เครื่องดื่ม" />
          <datalist id="retail-cats"><option v-for="c in categories" :key="c" :value="c" /></datalist>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div><label class="label">ราคา (บาท) <span class="text-rose-500">*</span></label><input v-model="form.price" type="text" v-num.dec class="input" /></div>
          <div><label class="label">สต็อก</label><input v-model="form.stock" type="text" v-num class="input" placeholder="ไม่นับ" /></div>
        </div>
        <p class="text-xs text-stone-400">สต็อกเว้นว่าง = ไม่นับสต็อก (เช่น เครื่องดื่มชงสด) · ขายใน POS แล้วตัดสต็อกอัตโนมัติ</p>
        <AppSwitch v-model="form.active" label="ใช้งาน (แสดงใน POS)" />
        <p v-if="error" class="flex items-center gap-2 text-sm text-rose-600"><AppIcon name="alert" :size="16" /> {{ error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="open = false">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
      </template>
    </AppModal>

    <AppModal v-if="stockOpen" :title="`เติมสต็อก: ${stockOpen.name}`" @close="stockOpen = null">
      <p class="mb-2 text-sm text-stone-600">คงเหลือ {{ stockOpen.stock }}</p>
      <label class="label">เพิ่ม (ชิ้น)</label>
      <input v-model="stockAdd" type="text" v-num class="input text-lg font-semibold" />
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="stockOpen = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="!Number(stockAdd)" @click="doAdd">เติม</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
