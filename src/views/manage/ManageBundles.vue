<script setup>
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { db, moveItem } from '../../data/store'
import { bahtText, bundleSummary, findDuplicate } from '../../lib/bundleEditor'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'

// หน้ารายการบันเดิ้ล (ชุดลดราคาตัวเลือก): ดูว่าแต่ละชุดลดเท่าไหร่ในแต่ละขนาด แตะการ์ดเพื่อแก้ไข
const router = useRouter()
const q = ref('')
const inactive = ref(false)

const ctx = computed(() => ({
  groups: db.optionGroups,
  sizes: (db.optionGroups.find((x) => x.key === 'size')?.options || []).filter((x) => x.active !== false),
  types: db.optionGroups.find((x) => x.key === 'type')?.options || [],
  styles: (db.optionGroups.find((x) => x.key === 'style')?.options || []).filter((x) => x.active !== false),
}))
const rows = computed(() => db.bundles.map((b) => ({ b, s: bundleSummary(b, ctx.value), dup: findDuplicate(b.items, db.bundles, b.id) })))
const activeCount = computed(() => db.bundles.filter((b) => b.active !== false).length)
const list = computed(() => {
  const s = q.value.trim().toLowerCase()
  return rows.value
    .filter((r) => inactive.value || r.b.active !== false)
    .filter((r) => !s || `${r.b.name} ${r.s.items.map((i) => `${i.group} ${i.name}`).join(' ')}`.toLowerCase().includes(s))
})
const move = (b, dir) => moveItem(db.bundles, db.bundles.indexOf(b), dir)
const copy = (b) => router.push({ path: '/admin/settings/bundles/new', query: { from: b.id } })
</script>

<template>
  <ManageShell
    v-model:q="q"
    v-model:inactive="inactive"
    title="บันเดิ้ล"
    back="/admin/settings"
    :subtitle="`${activeCount} ชุดที่ใช้งาน · ทั้งหมด ${db.bundles.length} ชุด`"
    add-label="เพิ่มบันเดิ้ล"
    search-placeholder="ค้นหาชื่อชุดหรือตัวเลือก"
    @add="router.push('/admin/settings/bundles/new')"
  >
    <section class="card mb-4 flex items-start gap-3 p-4">
      <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700"><AppIcon name="tag" :size="20" /></span>
      <p class="min-w-0 text-sm text-stone-600">
        <b class="text-stone-900">บันเดิ้ล = ชุดลดราคา</b> · ลูกค้าเลือกตัวเลือกในชุดให้ครบ ก็ได้ส่วนลดตามขนาดเค้ก
        แตะการ์ดเพื่อดูราคาปกติและราคาหลังลดของแต่ละขนาด
      </p>
    </section>

    <div v-if="!db.bundles.length" class="card flex flex-col items-center gap-3 py-10 text-center">
      <span class="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><AppIcon name="tag" :size="26" /></span>
      <h2 class="font-semibold text-stone-900">ยังไม่มีบันเดิ้ล</h2>
      <p class="max-w-sm text-sm text-stone-500">เช่น "ไส้ครีมชีส + ท็อปปิ้งบลูเบอร์รี" ลดให้เมื่อลูกค้าเลือกทั้งสองอย่างพร้อมกัน</p>
      <RouterLink to="/admin/settings/bundles/new" class="btn-primary">สร้างบันเดิ้ลแรก</RouterLink>
    </div>
    <p v-else-if="!list.length" class="card py-10 text-center text-stone-500">ไม่พบบันเดิ้ลที่ตรงกับคำค้น</p>

    <div v-else class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      <article
        v-for="r in list"
        :key="r.b.id"
        class="card flex flex-col p-0 transition hover:border-brand-300"
        :class="r.b.active === false ? 'opacity-70' : ''"
        :data-bundle-card="r.b.id"
      >
        <RouterLink :to="`/admin/settings/bundles/${r.b.id}`" class="block flex-1 rounded-t-2xl p-4 active:scale-[0.995]">
          <div class="flex flex-wrap items-start gap-2">
            <h2 class="min-w-0 flex-1 text-base font-semibold break-words text-stone-900">{{ r.b.name }}</h2>
            <span v-if="r.b.active === false" class="shrink-0 rounded-full bg-stone-100 px-2.5 py-0.5 text-xs font-medium text-stone-600">ปิดอยู่</span>
            <span v-else class="shrink-0 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800">ใช้งาน</span>
          </div>
          <p class="mt-1 text-xs text-stone-500">{{ r.s.scope }}</p>
          <ul class="mt-2.5 flex flex-wrap gap-1.5" aria-label="ตัวเลือกในชุด">
            <li
              v-for="i in r.s.items"
              :key="i.key"
              class="rounded-lg px-2 py-1 text-xs break-words"
              :class="i.off ? 'bg-rose-50 text-rose-700' : 'bg-stone-50 text-stone-700'"
            >
              <span v-if="i.group" class="text-stone-500">{{ i.group }}: </span>{{ i.name }}<span v-if="i.off"> (ปิดอยู่)</span>
            </li>
          </ul>
          <dl class="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
            <div v-for="z in r.s.sizes" :key="z.id" class="rounded-lg bg-stone-50 px-2.5 py-1.5">
              <dt class="text-xs text-stone-500">{{ z.name }}</dt>
              <dd class="text-sm font-semibold" :class="z.amount > 0 ? 'text-emerald-700' : 'text-stone-400'">
                {{ z.amount > 0 ? `ลด ${bahtText(z.amount)}` : 'ยังไม่ตั้ง' }}
              </dd>
              <dd v-if="z.hasOverride" class="text-xs text-amber-800">มีราคาแยกประเภท</dd>
            </div>
          </dl>
          <p v-if="!r.s.hasDiscount" class="mt-2 text-xs font-medium text-amber-800">ยังไม่มีส่วนลด · ชุดนี้จะยังไม่ทำงาน</p>
          <p v-if="r.s.hasOff" class="mt-2 text-xs font-medium text-rose-700">มีตัวเลือกในชุดที่ปิดอยู่ · ลูกค้าเลือกไม่ได้</p>
          <p v-if="r.dup" class="mt-2 text-xs font-medium text-rose-700" data-dup-warning>ตัวเลือกซ้ำกับ "{{ r.dup.name }}"{{ r.dup.active === false ? ' (ปิดอยู่)' : '' }} · ควรแก้หรือลบชุดใดชุดหนึ่ง</p>
        </RouterLink>
        <div class="flex items-center gap-1 border-t border-stone-100 px-2 py-1.5">
          <button type="button" class="btn-soft h-9 px-3 text-sm" :data-copy="r.b.id" @click="copy(r.b)">ทำสำเนา</button>
          <span class="flex-1" />
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            :disabled="db.bundles.indexOf(r.b) === 0"
            aria-label="เลื่อนขึ้น"
            @click="move(r.b, -1)"
          >▲</button>
          <button
            type="button"
            class="flex h-9 w-9 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-800 disabled:opacity-30"
            :disabled="db.bundles.indexOf(r.b) === db.bundles.length - 1"
            aria-label="เลื่อนลง"
            @click="move(r.b, 1)"
          >▼</button>
        </div>
      </article>
    </div>
  </ManageShell>
</template>
