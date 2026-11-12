<script setup>
import { computed, reactive, ref } from 'vue'
import { db, can, addWorkPhotos, removeWorkPhoto, publishWorkPhoto, unpublishWorkPhoto, autoTagsOf, photoStatusOf, allowPhotosAgain } from '../data/store'
import { askConfirm, askConfirmEx } from '../lib/confirm'
import ImageUploader from './ImageUploader.vue'
import AppModal from './AppModal.vue'
import AppIcon from './AppIcon.vue'
import SecureImg from './SecureImg.vue'
import { toPublicImage } from '../lib/publishImage'
import { smsChoice } from '../lib/smsChoice'
import { formatPhone } from '../lib/format'

// รูปงานเสร็จของรายการสินค้า (เค้กสั่งทำ/สินค้าสำเร็จ): อัปโหลด → ลูกค้าเห็นในหน้าออร์เดอร์ (+แจ้งข้อความพร้อมลิงก์) → ติ๊กเผยแพร่บนเว็บเมนูได้ (ค่าเริ่มต้นไม่ติ๊ก)
// ลูกค้าขอไม่ให้ใช้รูป = ล็อกการอัปโหลด/เผยแพร่ (ร้านตรวจสอบที่หน้า "คำขอไม่เผยแพร่รูป")
const props = defineProps({ order: { type: Object, required: true }, item: { type: Object, required: true } })
const status = computed(() => photoStatusOf(props.order))
const photos = computed(() => props.item.workPhotos || [])
const phase = computed(() => ['preparing', 'prepared', 'ready_to_ship', 'shipping', 'delivered'].includes(props.order.status))
const show = computed(() => props.order.channel !== 'pos' && (photos.value.length > 0 || (phase.value && can('workPhoto'))))
const canEdit = computed(() => can('workPhoto') && status.value === 'ok' && phase.value)
const staged = ref([])
const err = ref('')
async function save() {
  err.value = ''
  if (!staged.value.length) return (err.value = 'เลือกรูปก่อน')
  const tells = !!db.customers.find((c) => c.id === props.order.customerId)
  const r = await askConfirmEx({ title: 'บันทึกรูปงานเสร็จ', message: `${staged.value.length} รูป · ${props.item.name}`, okText: 'บันทึก', ...(tells ? { checkbox: { label: 'แจ้งลูกค้าว่ามีรูปงานแล้ว', hint: 'ข้อความพร้อมลิงก์ไปดูรูปในหน้าออร์เดอร์ ไม่ติ๊ก = ไม่ส่ง (ลูกค้ายังเห็นรูปเมื่อเปิดหน้าออร์เดอร์)', value: true } } : {}), ...(tells && smsChoice(db.customers.find((c) => c.id === props.order.customerId)) ? { checkbox2: { label: 'ส่ง SMS ด้วย', hint: formatPhone(db.customers.find((c) => c.id === props.order.customerId).phone), value: true } } : {}) })
  if (!r.ok) return
  const res = addWorkPhotos(props.order, props.item.id, staged.value, { notify: tells ? r.checked : true, sms: r.checked2 !== false })
  if (res.error) return (err.value = res.error)
  staged.value = []
}
async function del(p) {
  if (await askConfirm({ title: 'ลบรูปงาน', message: p.publish ? 'รูปนี้เผยแพร่บนเว็บอยู่ จะถูกถอนออกด้วย' : 'ลบรูปนี้ออกจากออร์เดอร์', okText: 'ลบ', danger: true })) removeWorkPhoto(props.order, props.item.id, p.id)
}
const pub = reactive({ busy: false, open: false, photo: null, tags: [], caption: '', error: '' })
const groups = computed(() => db.optionGroups.filter((g) => g.active !== false && g.appliesTo?.includes('custom') && g.type !== 'text' && (g.options || []).some((o) => o.active !== false)))
const isRetail = computed(() => props.item.kind === 'retail' && !!props.item.retailId)
function togglePublish(p) {
  err.value = ''
  if (p.publish) {
    const r = unpublishWorkPhoto(props.order, props.item.id, p.id)
    if (r.error) err.value = r.error
    return
  }
  Object.assign(pub, { open: true, photo: p, tags: isRetail.value ? [] : autoTagsOf(props.item), caption: '', error: '' })
}
const toggleTag = (id) => (pub.tags.includes(id) ? pub.tags.splice(pub.tags.indexOf(id), 1) : pub.tags.push(id))
async function doPublish() {
  if (pub.busy) return
  pub.busy = true
  pub.error = ''
  let image = null
  try { image = await toPublicImage(pub.photo.image) } catch (e) { pub.busy = false; return (pub.error = 'คัดลอกรูปไปที่สาธารณะไม่สำเร็จ: ' + e.message) }
  pub.busy = false
  const r = publishWorkPhoto(props.order, props.item.id, pub.photo.id, { tags: pub.tags, caption: pub.caption, image })
  if (r.error) return (pub.error = r.error)
  pub.open = false
}
const prodName = computed(() => db.retailItems.find((r) => r.id === props.item.retailId)?.name || '')
</script>

<template>
  <section v-if="show" class="mt-2 rounded-2xl border border-stone-200 bg-white p-3 text-sm" :aria-label="`รูปงานเสร็จ ${item.name}`">
    <div class="mb-1.5 flex items-center gap-1.5 font-semibold text-stone-800"><AppIcon name="image" :size="15" class="text-brand-600" /> รูปงานเสร็จ <span class="text-xs font-normal text-stone-400">· {{ item.name }}</span></div>
    <p v-if="status === 'requested'" class="mb-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">ลูกค้าขอไม่ให้ใช้รูปเผยแพร่ (รอตรวจสอบที่หน้า "คำขอไม่เผยแพร่รูป") · รูปถูกซ่อนจากเว็บชั่วคราว อัปโหลด/เผยแพร่เพิ่มไม่ได้</p>
    <p v-else-if="status === 'revoked'" class="mb-2 rounded-xl bg-rose-50 p-2.5 text-xs text-rose-700">ลูกค้าไม่อนุญาตให้ใช้รูปในออร์เดอร์นี้ (ลบรูปแล้ว) อัปโหลดรูปใหม่ไม่ได้ <button v-if="can('manage')" class="ml-1 underline" @click="allowPhotosAgain(order.id)">อนุญาตให้ใช้รูปได้อีก (ลูกค้าแจ้งเปลี่ยนใจ)</button></p>
    <div v-if="photos.length" class="grid grid-cols-2 gap-2 sm:grid-cols-3">
      <div v-for="p in photos" :key="p.id" class="overflow-hidden rounded-xl border border-stone-200">
        <SecureImg :src="p.image" alt="รูปงานเสร็จ" link class="aspect-square w-full object-cover" img-class="aspect-square w-full object-cover" />
        <div class="space-y-1 p-2">
          <label v-if="can('manage') && status === 'ok'" class="flex items-center gap-1.5 text-xs text-stone-700"><input type="checkbox" class="h-4 w-4" :checked="p.publish" :aria-label="`ใช้เป็นรูปตัวอย่างบนเว็บ`" @change="togglePublish(p)" /> ใช้เป็นรูปตัวอย่างบนเว็บ</label>
          <p v-else-if="p.publish" class="text-xs text-emerald-700">เผยแพร่บนเว็บ{{ status === 'requested' ? ' (ซ่อนชั่วคราว)' : '' }}</p>
          <button v-if="can('workPhoto')" type="button" class="text-xs text-rose-700 underline lg:py-1.5" @click="del(p)">ลบรูป</button>
        </div>
      </div>
    </div>
    <div v-if="canEdit" class="mt-2 space-y-2">
      <ImageUploader v-model="staged" :max="10" label="เลือกรูปงานเสร็จ" />
      <p v-if="err" class="text-xs text-rose-700" role="alert">{{ err }}</p>
      <button v-if="staged.length" type="button" class="btn-primary w-full" @click="save">บันทึก {{ staged.length }} รูป · ส่งให้ลูกค้าดู</button>
    </div>
    <p v-else-if="err" class="mt-1 text-xs text-rose-700" role="alert">{{ err }}</p>

    <AppModal v-if="pub.open" :title="isRetail ? 'ใช้เป็นรูปสินค้าบนเว็บ' : 'ใช้เป็นรูปตัวอย่างบนเว็บ (ติดแท็ก)'" @close="pub.open = false">
      <div class="space-y-3">
        <SecureImg :src="pub.photo.image" alt="รูปที่จะเผยแพร่" class="mx-auto max-h-48 rounded-2xl object-cover" />
        <p v-if="isRetail" class="text-sm text-stone-600">รูปนี้จะแสดงเป็นรูปของสินค้า <b>{{ prodName }}</b> บนเว็บเมนู (ถอนได้ทุกเมื่อ · ลูกค้าขอไม่เผยแพร่ได้ ระบบจะซ่อน/ลบ)</p>
        <template v-else>
          <p class="text-sm text-stone-600">ติ๊กตัวเลือกที่รูปนี้เป็นตัวแทน (เติมจากรายการสินค้าให้แล้ว แก้ได้) หน้าเว็บจะเลือกรูปนี้เมื่อลูกค้าเลือกตัวเลือกตรงกัน</p>
          <div v-for="g in groups" :key="g.id"><div class="mb-1 text-xs font-semibold text-stone-600">{{ g.name }}</div><div class="flex flex-wrap gap-1.5"><button v-for="o in g.options.filter((x) => x.active !== false)" :key="o.id" type="button" class="chip" :class="pub.tags.includes(o.id) ? 'chip-on' : 'chip-off'" :aria-pressed="pub.tags.includes(o.id)" @click="toggleTag(o.id)">{{ o.name }}</button></div></div>
          <div><label class="label">คำอธิบายรูป (ไม่บังคับ)</label><input v-model="pub.caption" class="input" maxlength="120" aria-label="คำอธิบายรูปเผยแพร่" /></div>
        </template>
        <p v-if="pub.error" class="text-sm text-rose-700" role="alert">{{ pub.error }}</p>
      </div>
      <template #footer><button class="btn-outline flex-1 sm:flex-none" @click="pub.open = false">ยกเลิก</button><button class="btn-primary flex-1 sm:flex-none" @click="doPublish">เผยแพร่บนเว็บ</button></template>
    </AppModal>
  </section>
</template>
