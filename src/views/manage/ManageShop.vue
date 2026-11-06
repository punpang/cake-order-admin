<script setup>
import { reactive, ref } from 'vue'
import { db, saveShopSettings, pickupSlots } from '../../data/store'
import { toDateStr } from '../../lib/format'
import ManageShell from '../../components/ManageShell.vue'
import AppIcon from '../../components/AppIcon.vue'
import AppSwitch from '../../components/AppSwitch.vue'

const st = reactive({ ...db.shop, vat: { ...db.shop.vat } })
const error = ref('')
const saved = ref(false)
const STEPS = [15, 30, 60]
const NEAR = [1, 2, 3, 6, 0]
const num = (v) => Number(v) >= 0 && v !== ''

function save() {
  if (!st.open || !st.close || st.close <= st.open) return (error.value = 'เวลาปิดต้องหลังเวลาเปิด')
  if (!(Number(st.slotMinutes) >= 5)) return (error.value = 'ช่วงเวลาต้องอย่างน้อย 5 นาที')
  if (![st.leadPickup, st.leadDelivery, st.birthdayDays].every(num)) return (error.value = 'กรอกตัวเลขตั้งแต่ 0 ขึ้นไป')
  if (!num(st.depositPercent) || Number(st.depositPercent) > 100) return (error.value = 'มัดจำต้องอยู่ระหว่าง 0–100%')
  const v = st.vat
  if (v.enabled && !(Number(v.rate) > 0 && Number(v.rate) <= 100)) return (error.value = 'อัตรา VAT ต้องอยู่ระหว่าง 0–100%')
  if (String(v.taxId || '').replace(/\D/g, '').length && String(v.taxId).replace(/\D/g, '').length !== 13) return (error.value = 'เลขประจำตัวผู้เสียภาษีต้องมี 13 หลัก')
  error.value = ''
  saveShopSettings(st)
  Object.assign(st, db.shop, { vat: { ...db.shop.vat } })
  saved.value = true
  setTimeout(() => (saved.value = false), 1500)
}
// ตัวอย่างเวลาของพรุ่งนี้ (ตามค่าที่บันทึกแล้ว)
const tomorrow = (() => { const d = new Date(); d.setDate(d.getDate() + 1); return toDateStr(d) })()
</script>

<template>
  <ManageShell title="ตั้งค่าร้าน" :toolbar="false">
    <section class="card mb-4">
      <label class="label">ชื่อร้าน (แสดงบนใบเสร็จ)</label>
      <input v-model="st.name" class="input" />
    </section>
    <section class="card space-y-4">
      <div class="card-title mb-0"><AppIcon name="clock" class="text-brand-600" /> เวลานัดรับ</div>
      <div class="grid grid-cols-2 gap-3">
        <div><label class="label">เวลาเปิด</label><input v-model="st.open" type="time" class="input" /></div>
        <div><label class="label">เวลาปิด (นัดได้ถึง)</label><input v-model="st.close" type="time" class="input" /></div>
      </div>
      <div>
        <div class="label">ห่างกันทุก (นาที)</div>
        <div class="flex flex-wrap items-center gap-2">
          <button v-for="m in STEPS" :key="m" type="button" class="chip" :class="Number(st.slotMinutes) === m ? 'chip-on' : 'chip-off'" @click="st.slotMinutes = m">{{ m }}</button>
          <input v-model.number="st.slotMinutes" type="text" v-num min="5" class="input w-24" />
        </div>
      </div>
      <div>
        <div class="label">ค่าเริ่มต้น ช่วงดูออร์เดอร์ก่อน/หลัง ตอนเลือกเวลา</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="h in NEAR" :key="h" type="button" class="chip" :class="Number(st.nearbyHours) === h ? 'chip-on' : 'chip-off'" @click="st.nearbyHours = h">{{ h ? `±${h} ชม.` : 'ทั้งวัน' }}</button>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="cake" class="text-brand-600" /> ตารางผลิต · ต้องเสร็จก่อนนัด (นาที)</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">รับที่ร้าน</label><input v-model.number="st.leadPickup" type="text" v-num min="0" class="input" /></div>
          <div><label class="label">จัดส่ง</label><input v-model.number="st.leadDelivery" type="text" v-num min="0" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> มัดจำ / วันเกิด</div>
        <div class="grid grid-cols-2 gap-3">
          <div><label class="label">มัดจำขั้นต่ำ (%) <span class="font-normal text-stone-400">0 = ไม่ใช้</span></label><input v-model.number="st.depositPercent" type="text" v-num min="0" max="100" class="input" /></div>
          <div><label class="label">เตือนวันเกิดล่วงหน้า (วัน)</label><input v-model.number="st.birthdayDays" type="text" v-num min="0" class="input" /></div>
        </div>
      </div>
      <div class="border-t border-stone-100 pt-4">
        <div class="card-title mb-3"><AppIcon name="wallet" class="text-brand-600" /> ภาษีมูลค่าเพิ่ม (VAT)</div>
        <AppSwitch v-model="st.vat.enabled" label="คิด VAT กับออร์เดอร์ใหม่ (ทุกช่องทาง รวม POS)" class="flex" />
        <template v-if="st.vat.enabled">
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div><label class="label">อัตรา (%)</label><input v-model="st.vat.rate" type="text" v-num.dec class="input" /></div>
            <div>
              <div class="label">รูปแบบ</div>
              <div class="grid grid-cols-2 gap-1 rounded-xl bg-stone-100 p-1">
                <button v-for="m in [{ v: 'inclusive', l: 'VAT ใน' }, { v: 'exclusive', l: 'VAT นอก' }]" :key="m.v" type="button" class="h-9 rounded-lg text-sm font-medium" :class="st.vat.mode === m.v ? 'bg-white text-brand-800 shadow-sm' : 'text-stone-600'" @click="st.vat.mode = m.v">{{ m.l }}</button>
              </div>
            </div>
          </div>
          <p class="mt-2 text-xs text-stone-500">
            <template v-if="st.vat.mode === 'inclusive'">VAT ใน: ราคาที่ตั้งไว้รวม VAT แล้ว ยอดที่ลูกค้าจ่ายไม่เปลี่ยน ระบบแยกแสดงบรรทัด VAT (ยอด × {{ Number(st.vat.rate) || 0 }} ÷ {{ 100 + (Number(st.vat.rate) || 0) }})</template>
            <template v-else>VAT นอก: บวก VAT {{ Number(st.vat.rate) || 0 }}% เพิ่มท้ายยอด</template>
            · ฐานภาษี = สินค้า + ค่าส่ง หลังส่วนลดทุกประเภท · เก็บค่าที่ใช้ไว้ในแต่ละออร์เดอร์ (แก้ตั้งค่าแล้วออร์เดอร์เดิมไม่เปลี่ยน) · กำไรในหน้ายอดขายนับก่อน VAT
          </p>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <div><label class="label">ชื่อผู้เสียภาษี (แสดงบนใบเสร็จ)</label><input v-model="st.vat.legalName" class="input" maxlength="120" /></div>
            <div><label class="label">เลขประจำตัวผู้เสียภาษี 13 หลัก</label><input v-model="st.vat.taxId" type="text" v-num maxlength="13" class="input" /></div>
          </div>
          <p class="mt-2 text-xs text-amber-700">ใบเสร็จของระบบนี้ไม่ใช่ใบกำกับภาษีเต็มรูป (ไม่มีข้อมูลผู้ซื้อ/เลขที่ใบกำกับตามกฎหมาย) หากต้องออกใบกำกับภาษีให้ปรึกษานักบัญชี</p>
        </template>
      </div>
      <p v-if="error" class="text-sm text-rose-600">{{ error }}</p>
      <button class="btn-primary w-full" @click="save"><AppIcon name="check" :size="18" /> {{ saved ? 'บันทึกแล้ว' : 'บันทึก' }}</button>
      <p class="text-xs text-stone-500">ตัวอย่างพรุ่งนี้: {{ pickupSlots(tomorrow).join(', ') }}</p>
    </section>
  </ManageShell>
</template>
