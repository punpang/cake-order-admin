import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// ข้อมูลเวอร์ชันของโปรแกรม (แสดงเฉพาะหน้าหลังบ้าน) · เวอร์ชันจาก package.json · commit จาก Cloudflare Pages หรือ git ตอน build
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const gitSha = () => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const commit = (process.env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) || gitSha() || 'dev'

export default defineConfig({
  plugins: [vue(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_COMMIT__: JSON.stringify(commit),
    __APP_BUILT_AT__: JSON.stringify(new Date().toISOString()),
  },
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
