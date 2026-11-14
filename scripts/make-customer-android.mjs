// สร้างโปรเจกต์ Android ของแอปลูกค้า (android-customer/) จากโปรเจกต์พนักงาน (android/)
// เปลี่ยนชื่อแพ็กเกจเป็น com.punpang.customer · ชื่อแอป "ปั้นแป้ง" · ไม่ใช้ google-services.json ของพนักงาน
// ไฟล์เว็บ: คัดลอกจาก dist-customer (ต้องรัน npm run build:customer ก่อน)
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'android')
const DST = join(ROOT, 'android-customer')
const WEB = join(ROOT, 'dist-customer')
const OLD_PKG = 'com.punpang.cakeadmin'
const NEW_PKG = 'com.punpang.customer'
const APP_NAME = 'ปั้นแป้ง'
const TEXT_FILE = /\.(gradle|kts|xml|java|json|properties|txt|pro)$/

if (!existsSync(join(WEB, 'index.html'))) throw new Error('ไม่พบ dist-customer/index.html · ต้องรัน npm run build:customer ก่อน')
rmSync(DST, { recursive: true, force: true })
// คัดลอกโปรเจกต์ โดยไม่เอาผลการ build/แคชของ Gradle
cpSync(SRC, DST, {
  recursive: true,
  filter: (p) => !/(^|[\\/])(build|\.gradle)([\\/]|$)/.test(p) && !p.endsWith('local.properties'),
})

// ย้ายโฟลเดอร์แพ็กเกจ Java/Kotlin ให้ตรงกับชื่อใหม่
const oldDir = join(DST, 'app', 'src', 'main', 'java', ...OLD_PKG.split('.'))
const newDir = join(DST, 'app', 'src', 'main', 'java', ...NEW_PKG.split('.'))
if (existsSync(oldDir)) {
  mkdirSync(dirname(newDir), { recursive: true })
  renameSync(oldDir, newDir)
}

// เปลี่ยนชื่อแพ็กเกจในทุกไฟล์ข้อความ (gradle, manifest, java, json)
const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name)
  return statSync(p).isDirectory() ? walk(p) : [p]
})
for (const f of walk(DST)) {
  if (!TEXT_FILE.test(f)) continue
  const s = readFileSync(f, 'utf8')
  const t = s.split(OLD_PKG).join(NEW_PKG)
  if (t !== s) writeFileSync(f, t)
}

// ชื่อแอปที่แสดงบนเครื่อง
const strings = join(DST, 'app', 'src', 'main', 'res', 'values', 'strings.xml')
if (existsSync(strings)) {
  const s = readFileSync(strings, 'utf8')
  writeFileSync(strings, s.replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${APP_NAME}</string>`))
}

// ชื่อแอปใน config ของ Capacitor (ให้ตรงกับเว็บที่คัดลอกไป)
const capConfig = join(DST, 'app', 'src', 'main', 'assets', 'capacitor.config.json')
if (existsSync(capConfig)) {
  const cfg = JSON.parse(readFileSync(capConfig, 'utf8'))
  cfg.appId = NEW_PKG
  cfg.appName = APP_NAME
  writeFileSync(capConfig, JSON.stringify(cfg, null, 2))
}

// ไม่ใช้ FCM ของแอปพนักงาน (แอปลูกค้ายังไม่ได้ลงทะเบียนกับ Firebase)
rmSync(join(DST, 'app', 'google-services.json'), { force: true })

// ไฟล์เว็บของแอปลูกค้า
const publicDir = join(DST, 'app', 'src', 'main', 'assets', 'public')
rmSync(publicDir, { recursive: true, force: true })
cpSync(WEB, publicDir, { recursive: true })

console.log(`สร้าง ${DST} แล้ว · แพ็กเกจ ${NEW_PKG} · ชื่อแอป ${APP_NAME}`)
