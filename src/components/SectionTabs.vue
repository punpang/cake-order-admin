<script setup>
import { computed, nextTick, ref } from 'vue'
import { useRoute } from 'vue-router'

// แท็บแบ่งหน้ายาวเป็นส่วน: ติดใต้แถบบนขณะเลื่อน · จำแท็บไว้ใน URL (?tab=) รีเฟรชหรือส่งลิงก์แล้วอยู่แท็บเดิม
// tabs: [{ key, label, badge? }] · v-model = key ของแท็บที่เปิด · เนื้อหาแต่ละแท็บให้หน้าใช้ v-show (ค่าที่กรอกค้างไว้ไม่หาย)
const props = defineProps({ tabs: { type: Array, required: true }, label: { type: String, default: 'ส่วนของหน้า' } })
const tab = defineModel({ type: String, required: true })
const route = useRoute()
const keys = computed(() => props.tabs.map((t) => t.key))
const fromUrl = () => (keys.value.includes(route.query.tab) ? route.query.tab : null)
if (fromUrl()) tab.value = fromUrl()

// หน้าในแอปถูกสร้างใหม่เมื่อ URL เปลี่ยน (RouterView ผูกกับ fullPath) จึงแก้ URL ตรง ๆ โดยไม่ผ่าน router
// เพื่อไม่ให้หน้าถูกสร้างใหม่ ค่าที่กรอกค้างไว้ไม่หาย และรีเฟรชแล้วยังอยู่แท็บเดิม
function rememberInUrl(k) {
  const [path, qs = ''] = location.hash.split('?')
  const q = new URLSearchParams(qs)
  if (k === keys.value[0]) q.delete('tab')
  else q.set('tab', k)
  const str = q.toString()
  history.replaceState(history.state, '', `${location.pathname}${location.search}${path}${str ? `?${str}` : ''}`)
}
const bar = ref(null)
function pick(k, focus = false) {
  if (k === tab.value) return
  tab.value = k
  rememberInUrl(k)
  nextTick(() => {
    const el = bar.value?.querySelector(`[data-tab="${k}"]`)
    el?.scrollIntoView({ block: 'nearest', inline: 'center' })
    if (focus) el?.focus()
    // เปลี่ยนแท็บขณะเลื่อนลงมาแล้ว → กลับขึ้นไปต้นเนื้อหาของแท็บใหม่
    const top = bar.value?.getBoundingClientRect().top ?? 0
    if (top < 60) window.scrollBy({ top: top - 60 })
  })
}
function onKey(e) {
  const i = keys.value.indexOf(tab.value)
  const n = keys.value.length
  const to = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1
  if (to < 0) return
  e.preventDefault()
  pick(keys.value[to], true)
}
</script>

<template>
  <div ref="bar" class="sticky top-14 z-10 -mx-4 mb-4 bg-cream/95 px-4 py-2 backdrop-blur md:mx-0 md:rounded-2xl md:px-0">
    <div role="tablist" :aria-label="label" class="flex gap-1 overflow-x-auto rounded-2xl bg-stone-200/60 p-1 [scrollbar-width:none]" @keydown="onKey">
      <button
        v-for="t in tabs"
        :key="t.key"
        type="button"
        role="tab"
        :data-tab="t.key"
        :aria-selected="tab === t.key"
        :tabindex="tab === t.key ? 0 : -1"
        class="inline-flex h-10 min-w-fit flex-1 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold whitespace-nowrap transition"
        :class="tab === t.key ? 'bg-white text-brand-700 shadow-sm' : 'text-stone-600 hover:text-stone-900'"
        @click="pick(t.key)"
      >
        {{ t.label }}
        <span v-if="t.badge || t.badge === 0" class="rounded-full px-1.5 text-xs" :class="tab === t.key ? 'bg-brand-50 text-brand-700' : 'bg-white/70 text-stone-500'">{{ t.badge }}</span>
      </button>
    </div>
  </div>
</template>
