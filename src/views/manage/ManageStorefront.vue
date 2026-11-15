<script setup>
import { computed, reactive, ref } from 'vue'
import { db, saveStorefront, saveReview, setReviewStatus, removeReview } from '../../data/store'
import { dateTime } from '../../lib/format'
import { askConfirm } from '../../lib/confirm'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import ImageUploader from '../../components/ImageUploader.vue'
import PhoneInput from '../../components/PhoneInput.vue'

// เนื้อหาหน้าร้านสาธารณะ (หน้า "/" และ "/menu") · เมนูเค้กดึงจากสินค้า/ตัวเลือกที่เปิดใช้งานอยู่แล้ว ไม่ต้องกรอกที่นี่
const st = reactive(JSON.parse(JSON.stringify(db.storefront)))
const tab = ref('info')
const saved = ref(false)
const pending = computed(() => db.reviews.filter((r) => r.status === 'pending').length)
const tabs = computed(() => [
  { v: 'info', l: 'ข้อมูลร้าน' },
  { v: 'guide', l: 'วิธีสั่ง/FAQ' },
  { v: 'gallery', l: 'แกลเลอรี' },
  { v: 'reviews', l: pending.value ? `รีวิว (${pending.value})` : 'รีวิว' },
])

function save() {
  saveStorefront(st)
  Object.assign(st, JSON.parse(JSON.stringify(db.storefront)))
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
const hero = computed({ get: () => (st.heroImage ? [st.heroImage] : []), set: (a) => (st.heroImage = a[0] || '') })
const addRow = (list, row) => list.push(row)
const delRow = (list, i) => list.splice(i, 1)
const MAX_GALLERY = 24
function addGallery(images) {
  for (const image of images) if (st.gallery.length < MAX_GALLERY) st.gallery.push({ image, caption: '' })
}

// ---------- รีวิว ----------
const rv = reactive({ name: '', rating: 5, text: '', error: '' })
function addReview() {
  const r = saveReview({ ...rv })
  if (!r) return (rv.error = 'กรอกชื่อและข้อความรีวิว')
  Object.assign(rv, { name: '', rating: 5, text: '', error: '' })
}
const STATUS = { pending: ['รออนุมัติ', 'bg-amber-50 text-amber-700'], approved: ['แสดงอยู่', 'bg-emerald-50 text-emerald-700'], rejected: ['ไม่แสดง', 'bg-stone-100 text-stone-500'] }
const reviews = computed(() => [...db.reviews].sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
async function del(r) {
  if (await askConfirm({ title: 'ลบรีวิว', message: `ลบรีวิวของ ${r.name}`, okText: 'ลบ', danger: true })) removeReview(r.id)
}
</script>

<template>
  <ManageShell narrow guard title="หน้าร้าน (เว็บลูกค้า)" subtitle="ข้อมูลร้าน วิธีสั่ง แกลเลอรี รีวิว" :toolbar="false">
    <div class="mb-4 grid grid-cols-4 gap-1 seg-grid">
      <button v-for="t in tabs" :key="t.v" type="button" class="h-10 rounded-xl text-xs font-semibold transition sm:text-sm" :class="tab === t.v ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-500'" @click="tab = t.v">{{ t.l }}</button>
    </div>

    <template v-if="tab !== 'reviews'">
      <!-- ข้อมูลร้าน -->
      <div v-if="tab === 'info'" class="space-y-4">
        <section class="card space-y-3">
          <div class="card-title">ส่วนหัวหน้าแรก</div>
          <div><label class="label">หัวข้อ</label><input v-model="st.heroTitle" class="input" maxlength="80" /></div>
          <div><label class="label">ข้อความใต้หัวข้อ</label><textarea v-model="st.heroText" rows="2" class="input" maxlength="200"></textarea></div>
          <div><div class="label">รูปพื้นหลัง</div><ImageUploader v-model="hero" :max="1" label="เพิ่มรูป" /></div>
        </section>
        <section class="card space-y-3">
          <div class="card-title">เกี่ยวกับร้าน / ติดต่อ</div>
          <div><label class="label">เกี่ยวกับร้าน</label><textarea v-model="st.about" rows="3" class="input" maxlength="300"></textarea></div>
          <div><label class="label">ที่อยู่</label><textarea v-model="st.address" rows="2" class="input" maxlength="200"></textarea></div>
          <div><label class="label">ลิงก์แผนที่ (Google Maps)</label><input v-model="st.mapUrl" class="input" inputmode="url" placeholder="https://maps.google.com/..." /></div>
          <div><label class="label">เบอร์โทรร้าน</label><PhoneInput v-model="st.phone" /></div>
          <div><label class="label">ลิงก์ Facebook Page (ปุ่มสั่งทาง Facebook)</label><input v-model="st.facebookUrl" class="input" inputmode="url" placeholder="https://m.me/..." /></div>
        </section>
        <section class="card space-y-2">
          <div class="card-title">เวลาเปิด</div>
          <div v-for="(h, i) in st.hours" :key="i" class="flex gap-2">
            <input v-model="h.days" class="input min-w-0 flex-1" placeholder="วัน เช่น จันทร์–ศุกร์" />
            <input v-model="h.time" class="input min-w-0 flex-1" placeholder="เวลา เช่น 09:00–20:00" />
            <button type="button" class="btn-danger h-11 px-3" aria-label="ลบแถว" @click="delRow(st.hours, i)"><AppIcon name="trash" :size="16" /></button>
          </div>
          <button type="button" class="btn-soft w-full" @click="addRow(st.hours, { days: '', time: '' })"><AppIcon name="plus" :size="16" /> เพิ่มแถว</button>
        </section>
      </div>

      <!-- วิธีสั่ง / FAQ / นโยบาย -->
      <div v-else-if="tab === 'guide'" class="space-y-4">
        <section class="card space-y-3">
          <div class="card-title">วิธีสั่งซื้อ (เรียงตามขั้น)</div>
          <div v-for="(h, i) in st.howToOrder" :key="i" class="space-y-2 rounded-xl bg-stone-50 p-3">
            <div class="flex gap-2"><input v-model="h.title" class="input min-w-0 flex-1" :placeholder="`ขั้นที่ ${i + 1}`" /><button type="button" class="btn-danger h-11 px-3" aria-label="ลบ" @click="delRow(st.howToOrder, i)"><AppIcon name="trash" :size="16" /></button></div>
            <textarea v-model="h.text" rows="2" class="input" placeholder="รายละเอียด"></textarea>
          </div>
          <button type="button" class="btn-soft w-full" @click="addRow(st.howToOrder, { title: '', text: '' })"><AppIcon name="plus" :size="16" /> เพิ่มขั้นตอน</button>
        </section>
        <section class="card space-y-3">
          <div class="card-title">คำถามที่พบบ่อย</div>
          <div v-for="(f, i) in st.faq" :key="i" class="space-y-2 rounded-xl bg-stone-50 p-3">
            <div class="flex gap-2"><input v-model="f.q" class="input min-w-0 flex-1" placeholder="คำถาม" /><button type="button" class="btn-danger h-11 px-3" aria-label="ลบ" @click="delRow(st.faq, i)"><AppIcon name="trash" :size="16" /></button></div>
            <textarea v-model="f.a" rows="2" class="input" placeholder="คำตอบ"></textarea>
          </div>
          <button type="button" class="btn-soft w-full" @click="addRow(st.faq, { q: '', a: '' })"><AppIcon name="plus" :size="16" /> เพิ่มคำถาม</button>
        </section>
        <section class="card space-y-3">
          <div class="card-title">นโยบายร้าน</div>
          <div v-for="(p, i) in st.policies" :key="i" class="space-y-2 rounded-xl bg-stone-50 p-3">
            <div class="flex gap-2"><input v-model="p.title" class="input min-w-0 flex-1" placeholder="หัวข้อ เช่น การยกเลิก" /><button type="button" class="btn-danger h-11 px-3" aria-label="ลบ" @click="delRow(st.policies, i)"><AppIcon name="trash" :size="16" /></button></div>
            <textarea v-model="p.text" rows="3" class="input" placeholder="รายละเอียด"></textarea>
          </div>
          <button type="button" class="btn-soft w-full" @click="addRow(st.policies, { title: '', text: '' })"><AppIcon name="plus" :size="16" /> เพิ่มนโยบาย</button>
        </section>
      </div>

      <!-- แกลเลอรี -->
      <section v-else class="card space-y-3">
        <div class="card-title">แกลเลอรีผลงาน ({{ st.gallery.length }}/{{ MAX_GALLERY }})</div>
        <div v-for="(g, i) in st.gallery" :key="i" class="flex items-center gap-2">
          <img :src="g.image" alt="" loading="lazy" decoding="async" class="h-16 w-16 shrink-0 rounded-xl border border-stone-200 object-cover" />
          <input v-model="g.caption" class="input min-w-0 flex-1" placeholder="คำบรรยาย (ไม่บังคับ)" maxlength="80" />
          <button type="button" class="btn-danger h-11 px-3" aria-label="ลบรูป" @click="delRow(st.gallery, i)"><AppIcon name="trash" :size="16" /></button>
        </div>
        <ImageUploader v-if="st.gallery.length < MAX_GALLERY" :model-value="[]" :max="MAX_GALLERY - st.gallery.length" label="เพิ่มรูป" @update:model-value="addGallery" />
        <p class="text-xs text-stone-400">รูปเก็บในหน่วยความจำชั่วคราวจนกว่าจะต่อ Supabase Storage</p>
      </section>

      <div class="mt-4 flex items-center gap-3">
        <button class="btn-primary flex-1 sm:flex-none" @click="save">บันทึก</button>
        <span v-if="saved" class="flex items-center gap-1 text-sm text-emerald-700"><AppIcon name="check" :size="16" /> บันทึกแล้ว</span>
        <RouterLink to="/" class="ml-auto text-sm text-brand-700 underline" target="_blank">ดูหน้าร้าน</RouterLink>
      </div>
    </template>

    <!-- รีวิว -->
    <div v-else class="space-y-4">
      <section class="card space-y-3">
        <div class="card-title">เพิ่มรีวิว (แอดมินกรอก)</div>
        <p class="text-xs text-stone-500">ใส่เฉพาะรีวิวจริงที่ลูกค้าให้ไว้ (เช่น จาก Facebook) และควรได้รับอนุญาตจากลูกค้า</p>
        <input v-model="rv.name" class="input" maxlength="60" placeholder="ชื่อที่แสดง เช่น คุณมะลิ" />
        <div class="flex gap-1" role="radiogroup" aria-label="คะแนน"><button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rv.rating === n" class="text-3xl leading-none" :class="n <= rv.rating ? 'text-amber-500' : 'text-stone-300'" :aria-label="`${n} ดาว`" @click="rv.rating = n">★</button></div>
        <textarea v-model="rv.text" rows="3" maxlength="500" class="input" placeholder="ข้อความรีวิว"></textarea>
        <p v-if="rv.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ rv.error }}</p>
        <button class="btn-primary w-full" @click="addReview">เพิ่มรีวิว</button>
      </section>

      <p v-if="!reviews.length" class="card py-8 text-center text-stone-500">ยังไม่มีรีวิว</p>
      <div v-for="r in reviews" :key="r.id" class="card space-y-2">
        <div class="flex items-center gap-2">
          <b class="min-w-0 flex-1 truncate text-stone-900">{{ r.name }}</b>
          <span class="text-amber-500">{{ '★'.repeat(r.rating) }}</span>
          <span class="shrink-0 rounded-full px-2 py-0.5 text-xs font-medium" :class="STATUS[r.status][1]">{{ STATUS[r.status][0] }}</span>
        </div>
        <p class="text-sm break-words text-stone-700">{{ r.text }}</p>
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-xs text-stone-400">{{ r.source === 'customer' ? 'ลูกค้าเขียนเอง' : 'แอดมินกรอก' }} · {{ dateTime(r.createdAt) }}</span>
          <span class="ml-auto flex gap-2">
            <button v-if="r.status !== 'approved'" class="btn-soft h-9 px-3" @click="setReviewStatus(r.id, 'approved')">อนุมัติ</button>
            <button v-if="r.status !== 'rejected'" class="btn-outline h-9 px-3" @click="setReviewStatus(r.id, 'rejected')">ไม่แสดง</button>
            <button class="btn-danger h-9 px-3" aria-label="ลบรีวิว" @click="del(r)"><AppIcon name="trash" :size="16" /></button>
          </span>
        </div>
      </div>
    </div>
  </ManageShell>
</template>
