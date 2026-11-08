import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    rollupOptions: {
      // แยกไลบรารีหลักออกจากโค้ดแอป: อัปเดตแอปแล้วผู้ใช้ไม่ต้องโหลด vue/router ใหม่ (เบราว์เซอร์จำแคชไว้)
      output: { manualChunks: (id) => (/node_modules[\\/](vue|@vue|vue-router)[\\/]/.test(id) ? 'vue' : undefined) },
    },
  },
})
