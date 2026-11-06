<script setup>
import { ref } from 'vue'
import { db } from '../data/store'
import AppIcon from './AppIcon.vue'

// สั่งทางแชท: เปิด LINE OA / Facebook ของร้าน (หน้าเว็บไม่มีตะกร้า) + คัดลอกข้อความสั่งไปวางในแชท
const props = defineProps({ text: { type: String, default: '' } })
const copied = ref(false)
async function copy() {
  try {
    await navigator.clipboard.writeText(props.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 2000)
  } catch {
    copied.value = false
  }
}
</script>

<template>
  <div>
    <div class="flex flex-wrap gap-2">
      <a v-if="db.storefront.lineUrl" :href="db.storefront.lineUrl" target="_blank" rel="noopener" class="btn-primary"><AppIcon name="chat" :size="16" /> สั่งทาง LINE</a>
      <a v-if="db.storefront.facebookUrl" :href="db.storefront.facebookUrl" target="_blank" rel="noopener" class="btn-primary"><AppIcon name="chat" :size="16" /> สั่งทาง Facebook</a>
      <a v-if="db.storefront.phone" :href="`tel:${db.storefront.phone}`" class="btn-outline"><AppIcon name="phone" :size="16" /> โทร</a>
      <button v-if="text" type="button" class="btn-soft" @click="copy"><AppIcon :name="copied ? 'check' : 'send'" :size="16" /> {{ copied ? 'คัดลอกแล้ว' : 'คัดลอกข้อความสั่ง' }}</button>
    </div>
    <p v-if="!db.storefront.lineUrl && !db.storefront.facebookUrl && !db.storefront.phone" class="text-sm text-stone-500">ร้านยังไม่ได้ตั้งช่องทางสั่ง กรุณาติดต่อที่ร้านโดยตรง</p>
  </div>
</template>
