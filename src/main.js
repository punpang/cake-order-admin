import { trackLoad } from './lib/loading' // ดักทุกคำขอ fetch ตั้งแต่โมดูลนี้ถูกโหลด (ก่อน supabase)
import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { vNum } from './lib/numInput'
import { supabaseEnabled } from './lib/supabase'
import { startAutoLabel } from './lib/autoLabel'
import { startAutoTitle } from './lib/a11yNav'
import { initStaff } from './lib/staffAuth'
import './style.css'

// ให้เบราว์เซอร์วาดหน้า "กำลังเตรียมข้อมูล" ก่อน แล้วค่อยสร้างข้อมูลตัวอย่าง (งานหนัก ~1 วินาที) — ตอนต่อ Supabase ลบส่วนนี้ + src/data/demo.js
const afterPaint = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)))
trackLoad(afterPaint().then(async () => {
// ข้อมูลตัวอย่างสมจริง ~90 วัน (จำลองในหน่วยความจำ) — เฉพาะโหมดที่ไม่ต่อ Supabase · โหมด Supabase แสดงเฉพาะข้อมูลจริงจากเซิร์ฟเวอร์ (และไม่โหลดโค้ด demo)
if (!supabaseEnabled) (await import('./data/demo')).seedDemo()

await initStaff() // โหมด Supabase: อ่านเซสชันพนักงานที่ล็อกอินค้างไว้ก่อนเริ่มนำทาง
createApp(App).use(router).directive('num', vNum).mount('#app')
startAutoLabel()
startAutoTitle()
}))
