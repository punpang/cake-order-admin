import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { vNum } from './lib/numInput'
import { seedDemo } from './data/demo'
import './style.css'

// ข้อมูลตัวอย่างสมจริง ~90 วัน (จำลองในหน่วยความจำ) — ตอนต่อ Supabase ลบบรรทัดนี้ + src/data/demo.js
seedDemo()

createApp(App).use(router).directive('num', vNum).mount('#app')
