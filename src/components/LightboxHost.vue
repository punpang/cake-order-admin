<script setup>
import { onBeforeUnmount, onMounted, watch } from 'vue'
import { lightbox, closeLightbox, onImageClick } from '../lib/lightbox'
const onKey = (e) => { if (e.key === 'Escape') closeLightbox() }
onMounted(() => { document.addEventListener('click', onImageClick, true); window.addEventListener('keydown', onKey) })
onBeforeUnmount(() => { document.removeEventListener('click', onImageClick, true); window.removeEventListener('keydown', onKey) })
watch(() => lightbox.url, (u) => { document.body.style.overflow = u ? 'hidden' : '' })
</script>

<template>
  <Teleport to="body">
    <div v-if="lightbox.url" class="fixed inset-0 z-[100] flex cursor-zoom-out items-center justify-center bg-black/85 p-3" role="dialog" aria-modal="true" aria-label="รูปขนาดใหญ่" data-lightbox data-no-zoom @click="closeLightbox">
      <img :src="lightbox.url" :alt="lightbox.alt" data-no-zoom class="max-h-[92vh] max-w-[96vw] rounded-lg object-contain" />
      <button type="button" class="absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-full bg-white text-xl text-stone-900" aria-label="ปิด" @click.stop="closeLightbox">×</button>
    </div>
  </Teleport>
</template>
