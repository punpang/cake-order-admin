<script setup>
import { computed, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { myOrder, submitReview } from '../../data/store'
import CustomerOrderView from '../../components/CustomerOrderView.vue'
import AppModal from '../../components/AppModal.vue'
import AppIcon from '../../components/AppIcon.vue'

// หน้าออร์เดอร์ของฉัน (ล็อกอิน) · หน้าเดียวกับลิงก์ออร์เดอร์ แต่เห็นข้อมูลเต็มของตัวเอง + เขียนรีวิวได้
const route = useRoute()
const id = computed(() => String(route.params.id || ''))
const tick = ref(0)
const order = computed(() => (tick.value, myOrder(id.value)))
const ctx = computed(() => ({ orderId: id.value }))
const refresh = () => tick.value++

const rv = reactive({ order: null, rating: 5, text: '', error: '', busy: false })
const openReview = (o) => Object.assign(rv, { order: o, rating: 5, text: '', error: '' })
async function sendReview() {
  if (rv.busy) return
  rv.busy = true
  const r = await submitReview({ orderId: rv.order.id, rating: rv.rating, text: rv.text })
  rv.busy = false
  if (r.ok) { rv.order = null; refresh() } else rv.error = r.error
}
</script>

<template>
  <div class="mx-auto max-w-xl px-4 py-6">
    <RouterLink to="/account" class="tap mb-3 inline-flex items-center gap-1 text-sm text-stone-600 hover:text-brand-700"><AppIcon name="back" :size="16" /> กลับบัญชีของฉัน</RouterLink>
    <div v-if="!order" class="card py-12 text-center text-stone-500">ไม่พบออร์เดอร์นี้ <RouterLink to="/account" class="text-brand-700 underline">กลับ</RouterLink></div>
    <CustomerOrderView v-else :order="order" :ctx="ctx" :can-review="order.status === 'delivered'" @refresh="refresh" @review="openReview" />

    <AppModal v-if="rv.order" :title="`รีวิว ${rv.order.code}`" @close="rv.order = null">
      <div class="space-y-3">
        <div class="flex gap-1" role="radiogroup" aria-label="คะแนน">
          <button v-for="n in 5" :key="n" type="button" role="radio" :aria-checked="rv.rating === n" class="text-3xl leading-none" :class="n <= rv.rating ? 'text-amber-500' : 'text-stone-300'" :aria-label="`${n} ดาว`" @click="rv.rating = n">★</button>
        </div>
        <textarea v-model="rv.text" rows="4" maxlength="500" class="input" placeholder="เล่าให้ฟังหน่อยว่าเป็นอย่างไรบ้าง"></textarea>
        <p class="text-xs text-stone-400">จะแสดงบนหน้าร้านหลังร้านตรวจสอบ โดยใช้ชื่อต้นของคุณเท่านั้น</p>
        <p v-if="rv.error" class="flex items-center gap-2 text-sm text-rose-700"><AppIcon name="alert" :size="16" /> {{ rv.error }}</p>
      </div>
      <template #footer>
        <button class="btn-outline flex-1 sm:flex-none" @click="rv.order = null">ยกเลิก</button>
        <button class="btn-primary flex-1 sm:flex-none" :disabled="rv.busy" @click="sendReview">{{ rv.busy ? 'กำลังส่ง…' : 'ส่งรีวิว' }}</button>
      </template>
    </AppModal>
  </div>
</template>
