<script setup>
// การ์ดสมาชิกแบบบัตรเครดิต: ด้านหน้าแสดงเบอร์ คะแนน ชื่อระดับ และหลอดวันหมดสิทธิ · แตะเพื่อพลิกไปด้านบาร์โค้ดให้พนักงานสแกน
import { computed, ref } from 'vue'
import CouponBarcode from './CouponBarcode.vue'
import { memberCardView } from '../lib/memberCard'
import { num, money } from '../lib/format'

const props = defineProps({
  me: { type: Object, required: true },
  tier: { type: Object, default: null },
  scanCode: { type: String, default: '' },
  scanErr: { type: String, default: '' },
  shopName: { type: String, default: '' },
})
const emit = defineEmits(['show-back'])

const flipped = ref(false)
const view = computed(() => memberCardView(props.me, props.tier))

function flip() {
  flipped.value = !flipped.value
  if (flipped.value) emit('show-back')
}
</script>

<template>
  <div class="member-card-wrap">
    <button type="button" class="member-card" :aria-pressed="flipped" aria-label="การ์ดสมาชิก แตะเพื่อพลิก" @click="flip">
      <div class="member-card-inner" :class="{ 'is-flipped': flipped }">
        <!-- ด้านหน้า -->
        <div class="member-face member-front">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="text-xs opacity-80">{{ shopName || 'สมาชิก' }}</div>
              <div v-if="view.levelName" class="mt-1 inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-xs font-semibold">{{ view.levelName }}</div>
            </div>
            <div class="text-right text-xs opacity-80">แตะเพื่อพลิก</div>
          </div>
          <div>
            <div class="text-xs opacity-80">คะแนนคงเหลือ</div>
            <div class="flex items-baseline gap-2">
              <span class="text-4xl font-semibold tracking-tight" aria-label="คะแนนคงเหลือ">{{ num(view.points) }}</span>
              <span class="text-sm opacity-90">คะแนน</span>
            </div>
          </div>
          <div>
            <div class="flex items-end justify-between gap-2">
              <span class="text-lg font-semibold tracking-wide">{{ view.phone }}</span>
            </div>
            <div v-if="view.levelName" class="mt-2 space-y-2">
              <div>
                <div class="flex justify-between text-[11px] opacity-80">
                  <span>ระดับถัดไปอีก</span>
                  <span v-if="view.progress.top">ระดับสูงสุดแล้ว</span>
                  <span v-else>{{ money(view.progress.remaining) }} · {{ view.progress.nextName }}</span>
                </div>
                <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/25" role="progressbar" :aria-valuenow="view.progress.pct" aria-valuemin="0" aria-valuemax="100" aria-label="ความคืบหน้ายอดสะสมไประดับถัดไป">
                  <div class="h-full rounded-full bg-white" :style="{ width: view.progress.pct + '%' }" />
                </div>
              </div>
              <div>
                <div class="text-[11px] opacity-80">{{ view.line }}</div>
                <div class="mt-1 h-1 w-full overflow-hidden rounded-full bg-white/20" role="progressbar" :aria-valuenow="view.validPct" aria-valuemin="0" aria-valuemax="100" aria-label="วันที่เหลือของสิทธิระดับ">
                  <div class="h-full rounded-full bg-white/80" :style="{ width: view.validPct + '%' }" />
                </div>
              </div>
            </div>
          </div>
        </div>
        <!-- ด้านหลัง -->
        <div class="member-face member-back">
          <div class="text-sm font-semibold text-stone-900">แสดงให้พนักงานสแกน</div>
          <div class="mt-2 w-full">
            <CouponBarcode v-if="scanCode" :value="scanCode" label="บาร์โค้ดสมาชิก" />
            <p v-else-if="scanErr" class="text-sm text-danger-700" role="alert">{{ scanErr }}</p>
            <p v-else class="text-sm text-stone-500">กำลังเตรียมบาร์โค้ด…</p>
          </div>
        </div>
      </div>
    </button>
  </div>
</template>

<style scoped>
.member-card-wrap { width: 100%; perspective: 1200px; }
.member-card {
  display: block; width: 100%; border: 0; padding: 0; background: transparent; cursor: pointer;
  border-radius: 20px; min-height: 13.5rem;
}
.member-card:focus-visible { outline: 3px solid #c2413f; outline-offset: 3px; }
.member-card-inner {
  display: grid; width: 100%; height: 100%;
  transition: transform 0.6s; transform-style: preserve-3d;
}
.member-card-inner.is-flipped { transform: rotateY(180deg); }
.member-face {
  grid-area: 1 / 1; border-radius: 20px; padding: 18px 20px;
  display: flex; flex-direction: column; justify-content: space-between; gap: 14px;
  backface-visibility: hidden; -webkit-backface-visibility: hidden; text-align: left;
  box-shadow: 0 10px 30px rgba(120, 30, 30, 0.25);
}
.member-front {
  color: #fff;
  background: linear-gradient(135deg, #d6486a 0%, #a8323c 55%, #7c2330 100%);
}
.member-back {
  transform: rotateY(180deg); background: #fff; color: #1c1917;
  align-items: center; justify-content: center; text-align: center;
  border: 1px solid #e7e5e4;
}
@media (prefers-reduced-motion: reduce) { .member-card-inner { transition: none; } }
</style>
