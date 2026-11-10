import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  build: {
    rollupOptions: {
      // แยกไลบรารีหลักออกจากโค้ดแอป: อัปเดตแอปแล้วผู้ใช้ไม่ต้องโหลด vue/router ใหม่ (เบราว์เซอร์จำแคชไว้)
      // supabase และ qrcode แยกเป็นชุดของตัวเอง (โหลดเฉพาะเมื่อจำเป็น และแคชแยกจากโค้ดแอป)
      output: {
        manualChunks: (id) => {
          if (/node_modules[\\/](vue|@vue|vue-router)[\\/]/.test(id)) return 'vue'
          if (/node_modules[\\/]@supabase[\\/]/.test(id)) return 'supabase'
          if (/node_modules[\\/]qrcode[\\/]/.test(id)) return 'qrcode'
          return undefined
        },
      },
    },
  },
})
