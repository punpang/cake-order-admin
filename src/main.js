import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { vNum } from './lib/numInput'
import './style.css'

// ป้องกันการซูมบนมือถือ (iOS ไม่สนใจ user-scalable=no): ซูมสองนิ้ว / gesture / แตะสองครั้ง
const stop = (e) => e.preventDefault()
for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, stop, { passive: false })
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })
let lastTouch = 0
document.addEventListener(
  'touchend',
  (e) => {
    const now = Date.now()
    if (now - lastTouch < 300) e.preventDefault()
    lastTouch = now
  },
  { passive: false },
)

createApp(App).use(router).directive('num', vNum).mount('#app')
