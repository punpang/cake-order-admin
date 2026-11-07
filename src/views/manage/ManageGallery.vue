<script setup>
import { computed, reactive, ref } from 'vue'
import { db, saveGalleryImage, removeGalleryImage } from '../../data/store'
import { galleryCoverage, galleryOf } from '../../lib/cakeImage'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import ImageUploader from '../../components/ImageUploader.vue'
import AppModal from '../../components/AppModal.vue'
import AppSwitch from '../../components/AppSwitch.vue'
import AppIcon from '../../components/AppIcon.vue'

// คลังรูปเค้กสั่งทำ: อัปโหลดหลายรูปทีเดียว ติ๊กแท็กตัวเลือกที่รูปเป็นตัวแทน (ประเภท/เนื้อ/ขนาด/ตกแต่ง …) · หน้าเว็บเลือกรูปให้ตรงกับที่ลูกค้าเลือก
// ถ้าไม่มีรูปตรงเป๊ะ จะใช้รูปใกล้เคียงที่สุดพร้อมข้อความกำกับ
const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo?.includes('custom') && g.type !== 'text' && (g.options || []).some((o) => o.active !== false)))
const nameOf = (id) => db.optionGroups.flatMap((g) => g.options || []).find((o) => o.id === id)?.name || id
const queue = ref([])
const tags = ref([])
const caption = ref('')
const msg = ref('')
const err = ref('')
const toggle = (list, id) => (list.includes(id) ? list.splice(list.indexOf(id), 1) : list.push(id))
function saveQueue() {
  err.value = msg.value = ''
  if (!queue.value.length) return (err.value = 'เลือกรูปก่อน')
  if (!tags.value.length) return (err.value = 'ติ๊กแท็กตัวเลือกที่รูปเหล่านี้เป็นตัวแทนอย่างน้อย 1 อย่าง')
  let n = 0
  for (const image of queue.value) {
    const r = saveGalleryImage({ image, tags: [...tags.value], caption: caption.value })
    if (r.error) return (err.value = r.error)
    n++
  }
  msg.value = `เพิ่ม ${n} รูปเข้าคลังแล้ว`
  queue.value = []
}
const codeOf = (id) => db.orders.find((o) => o.id === id)?.code || id
const items = computed(() => db.cakeGallery.slice().reverse())
const typeImgs = computed(() => galleryOf(db).filter((e) => e.id.startsWith('type:')))
const cov = computed(() => galleryCoverage(db))
const ed = reactive({ open: false, id: null, image: '', tags: [], caption: '', active: true, error: '' })
function edit(it) { Object.assign(ed, { open: true, id: it.id, image: it.image, tags: [...it.tags], caption: it.caption, active: it.active !== false, error: '' }) }
function saveEdit() {
  const r = saveGalleryImage({ id: ed.id, image: ed.image, tags: ed.tags, caption: ed.caption, active: ed.active })
  if (r.error) return (ed.error = r.error)
  ed.open = false
}
async function del() {
  if (!(await askConfirm({ title: 'ลบรูปออกจากคลัง', message: 'รูปนี้จะไม่แสดงที่หน้าเว็บอีก', okText: 'ลบ', danger: true }))) return
  removeGalleryImage(ed.id)
  ed.open = false
}
</script>

<template>
  <ManageShell title="คลังรูปเค้กสั่งทำ" subtitle="ติดแท็กตัวเลือก · หน้าเว็บเปลี่ยนรูปตามที่ลูกค้าเลือก" :toolbar="false">
    <div class="space-y-4">
      <section class="card space-y-3 lg:max-w-3xl" aria-label="อัปโหลดรูป">
        <div class="card-title">เพิ่มรูป (อัปโหลดทีละหลายรูปได้)</div>
        <p class="text-sm text-stone-500">ติ๊กตัวเลือกที่รูปเหล่านี้เป็นตัวแทนก่อน แล้วเลือกรูปทีเดียวหลายรูป ระบบใช้แท็กเดียวกันกับทุกรูปในครั้งนั้น (ติ๊กน้อย = ใช้ได้กว้าง, ติ๊กหลายอย่าง = เจาะจง เช่น ช็อกโกแลต + 2 ปอนด์)</p>
        <div v-for="g in groups" :key="g.id">
          <div class="mb-1 text-xs font-semibold text-stone-600">{{ g.name }}</div>
          <div class="flex flex-wrap gap-1.5"><button v-for="o in g.options.filter((x) => x.active !== false)" :key="o.id" type="button" class="chip" :class="tags.includes(o.id) ? 'chip-on' : 'chip-off'" :aria-pressed="tags.includes(o.id)" @click="toggle(tags, o.id)">{{ o.name }}</button></div>
        </div>
        <div><label class="label">คำอธิบายรูป (ไม่บังคับ)</label><input v-model="caption" class="input" maxlength="120" aria-label="คำอธิบายรูป" /></div>
        <ImageUploader v-model="queue" :max="20" label="เลือกรูป (หลายรูปได้)" />
        <p v-if="err" class="text-sm text-rose-600" role="alert">{{ err }}</p>
        <p v-if="msg" class="text-sm text-emerald-700" role="status">{{ msg }}</p>
        <button type="button" class="btn-primary w-full" @click="saveQueue">บันทึก {{ queue.length || '' }} รูปเข้าคลัง</button>
        <p class="text-xs text-stone-400">จำลองในหน่วยความจำ (รีเฟรชแล้วหาย) · ของจริงเก็บใน Supabase Storage</p>
      </section>

      <section class="card" aria-label="รูปในคลัง">
        <div class="card-title">รูปในคลัง ({{ items.length }})<span v-if="typeImgs.length" class="text-xs font-normal text-stone-400"> + รูปหน้าปกประเภท {{ typeImgs.length }} รูป</span></div>
        <p v-if="!items.length" class="py-6 text-center text-sm text-stone-400">ยังไม่มีรูปในคลัง</p>
        <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 2xl:grid-cols-6">
          <div v-for="it in items" :key="it.id" class="overflow-hidden rounded-2xl border border-stone-200 bg-white text-left" :class="it.active === false ? 'opacity-50' : ''">
            <button type="button" class="block w-full text-left" @click="edit(it)">
              <img :src="it.image" :alt="it.caption || 'รูปเค้ก'" class="aspect-square w-full object-cover" />
              <span class="block space-y-1 px-2 pt-2"><span class="flex flex-wrap gap-1"><span v-for="t in it.tags" :key="t" class="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] text-brand-800">{{ nameOf(t) }}</span></span><span v-if="it.caption" class="block truncate text-xs text-stone-500">{{ it.caption }}</span></span>
            </button>
            <div class="p-2 pt-1"><RouterLink v-if="it.source" :to="`/admin/orders/${it.source.orderId}`" class="block text-[11px] text-brand-700 underline">จากออร์เดอร์ {{ codeOf(it.source.orderId) }}</RouterLink></div>
          </div>
        </div>
      </section>

      <section class="card text-sm" aria-label="ความครอบคลุมของรูป">
        <div class="card-title">ความครอบคลุมของรูป</div>
        <div v-if="cov.popular.length" class="mb-3"><div class="mb-1 font-semibold text-stone-800">แบบที่ลูกค้าสั่งจริงแต่ยังไม่มีรูปตรง</div><ul class="space-y-0.5"><li v-for="p in cov.popular" :key="p.label" class="flex justify-between"><span>{{ p.label }}</span><span class="text-stone-500">สั่งแล้ว {{ p.count }}</span></li></ul></div>
        <div v-for="r in cov.groups" :key="r.group.id" class="mb-2"><div class="font-semibold text-stone-800">{{ r.group.name }} <span class="text-xs font-normal" :class="r.missing.length ? 'text-amber-700' : 'text-emerald-700'">{{ r.missing.length ? `ยังไม่มีรูป ${r.missing.length}` : 'มีรูปครบ' }}</span></div><div v-if="r.missing.length" class="mt-0.5 flex flex-wrap gap-1"><span v-for="o in r.missing" :key="o.id" class="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{{ o.name }}</span></div></div>
        <p class="text-xs text-stone-400">ตัวเลือกที่ไม่มีรูป ลูกค้าจะเห็นรูปใกล้เคียงพร้อมข้อความกำกับ</p>
      </section>
    </div>

    <AppModal v-if="ed.open" title="แก้ไขรูปในคลัง" @close="ed.open = false">
      <div class="space-y-3">
        <img :src="ed.image" alt="รูปที่แก้ไข" class="mx-auto max-h-56 rounded-2xl object-cover" />
        <div v-for="g in groups" :key="g.id"><div class="mb-1 text-xs font-semibold text-stone-600">{{ g.name }}</div><div class="flex flex-wrap gap-1.5"><button v-for="o in g.options.filter((x) => x.active !== false)" :key="o.id" type="button" class="chip" :class="ed.tags.includes(o.id) ? 'chip-on' : 'chip-off'" @click="toggle(ed.tags, o.id)">{{ o.name }}</button></div></div>
        <div><label class="label">คำอธิบาย</label><input v-model="ed.caption" class="input" maxlength="120" aria-label="คำอธิบายรูปที่แก้ไข" /></div>
        <AppSwitch v-model="ed.active" label="แสดงที่หน้าเว็บ" />
        <p v-if="ed.error" class="text-sm text-rose-600" role="alert">{{ ed.error }}</p>
      </div>
      <template #footer>
        <button class="btn-danger flex-1 sm:flex-none" @click="del"><AppIcon name="trash" :size="16" /> ลบ</button>
        <button class="btn-primary flex-1 sm:flex-none" @click="saveEdit">บันทึก</button>
      </template>
    </AppModal>
  </ManageShell>
</template>
