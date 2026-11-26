// คัดลอกไฟล์ OCR (Tesseract.js) จาก node_modules ไปไว้ที่ public/ocr เพื่อให้เว็บโหลดเองได้ ไม่ใช้ CDN (ตาม CSP)
// รัน: node scripts/sync-ocr-assets.mjs  (ต้องรันหลังอัปเดต tesseract.js / tesseract.js-core / @tesseract.js-data)
import { copyFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'public', 'ocr')
const core = join(root, 'node_modules', 'tesseract.js-core')
const dataDir = (pkg) => join(root, 'node_modules', '@tesseract.js-data', pkg, '4.0.0_best_int')
const LANG_DIR = 'lang/4.0.0_best_int'

// ไฟล์ที่ใช้จริง: worker + core แบบ LSTM (ทั้ง SIMD และไม่ SIMD) + ภาษาไทยและอังกฤษ (ชุด best_int ที่ใช้กับ oem 1)
const FILES = [
  [join(root, 'node_modules', 'tesseract.js', 'dist', 'worker.min.js'), 'worker.min.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm.js'), 'tesseract-core-simd-lstm.wasm.js'],
  [join(core, 'tesseract-core-simd-lstm.wasm'), 'tesseract-core-simd-lstm.wasm'],
  [join(core, 'tesseract-core-lstm.wasm.js'), 'tesseract-core-lstm.wasm.js'],
  [join(core, 'tesseract-core-lstm.wasm'), 'tesseract-core-lstm.wasm'],
  [join(dataDir('tha'), 'tha.traineddata.gz'), `${LANG_DIR}/tha.traineddata.gz`],
  [join(dataDir('eng'), 'eng.traineddata.gz'), `${LANG_DIR}/eng.traineddata.gz`],
]

const missing = FILES.filter(([src]) => !existsSync(src)).map(([src]) => src)
if (missing.length) {
  console.error('ไม่พบไฟล์ต้นทาง (ลอง npm install ก่อน):\n' + missing.join('\n'))
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
for (const [src, rel] of FILES) {
  const dest = join(out, rel)
  mkdirSync(dirname(dest), { recursive: true })
  copyFileSync(src, dest)
}
console.log(`คัดลอก ${FILES.length} ไฟล์ไปที่ public/ocr แล้ว`)
