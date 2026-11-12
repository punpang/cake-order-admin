import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// ข้อมูลเวอร์ชันของโปรแกรม (แสดงเฉพาะหน้าหลังบ้าน) · เวอร์ชันจาก package.json · commit จาก Cloudflare Pages หรือ git ตอน build
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
const gitSha = () => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return '' } }
const commit = (process.env.CF_PAGES_COMMIT_SHA || '').slice(0, 7) || gitSha() || 'dev'

// คำใบ้ให้เบราว์เซอร์จับมือ (DNS + TLS) กับเซิร์ฟเวอร์ข้อมูลไว้ล่วงหน้าตั้งแต่อ่าน HTML → คำขอข้อมูลแรกของหน้าร้านไม่ต้องเสียเวลาเปิดการเชื่อมต่อ
// ใส่เฉพาะเมื่อเปิดใช้ Supabase / ตั้ง Worker ไฟล์ไว้ (อ่านจากตัวแปร VITE_* ตอน build)
// หมายเหตุ: เคยลอง preload ชุดโค้ด supabase และไฟล์ฟอนต์ด้วย แต่วัดบนเครือข่ายช้าแล้วหน้าแรกขึ้นช้าลง (แย่งแบนด์วิดท์กับสคริปต์หลัก) จึงไม่ใส่
export function preconnectHints(env = {}) {
  const originOf = (u) => { try { const o = new URL(u).origin; return o === 'null' ? '' : o } catch { return '' } }
  return {
    name: 'preconnect-hints',
    transformIndexHtml() {
      const origins = new Set()
      if (env.VITE_USE_SUPABASE === '1' && originOf(env.VITE_SUPABASE_URL)) origins.add(originOf(env.VITE_SUPABASE_URL))
      if (originOf(env.VITE_FILES_URL)) origins.add(originOf(env.VITE_FILES_URL))
      return [...origins].map((href) => ({ tag: 'link', attrs: { rel: 'preconnect', href, crossorigin: '' }, injectTo: 'head-prepend' }))
    },
  }
}

export default defineConfig(({ mode }) => ({
  plugins: [vue(), tailwindcss(), preconnectHints(loadEnv(mode, process.cwd(), 'VITE_'))],
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
}))
