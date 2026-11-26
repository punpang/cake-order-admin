// อ่านข้อความจากรูปใบเสร็จด้วย Tesseract.js ในเบราว์เซอร์ · ไฟล์ทั้งหมดอยู่ที่ public/ocr (ไม่ใช้ CDN ตาม CSP)
// โหลดไลบรารีและ worker เฉพาะตอนเรียกใช้ครั้งแรก · รูปไม่ถูกส่งออกนอกเครื่อง
// ไฟล์ public/ocr สร้างด้วย: node scripts/sync-ocr-assets.mjs
const ASSET = '/ocr'
let progressHandler = null
let workerPromise = null

// ตรวจว่าเบราว์เซอร์รองรับ WebAssembly SIMD หรือไม่ (ไบต์ทดสอบมาตรฐาน) · ถ้าไม่รองรับใช้ core แบบไม่ SIMD
const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11])
const coreFile = () => `${ASSET}/tesseract-core-${WebAssembly.validate(SIMD_PROBE) ? 'simd-' : ''}lstm.wasm.js`

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js')
      return createWorker(['tha', 'eng'], 1, {
        workerPath: `${ASSET}/worker.min.js`,
        corePath: coreFile(),
        langPath: `${ASSET}/lang/4.0.0_best_int`,
        logger: (m) => progressHandler?.(m),
      })
    })().catch((e) => {
      workerPromise = null
      throw e
    })
  }
  return workerPromise
}

// รับ dataURL ของรูป · คืนข้อความที่อ่านได้ (อาจว่างถ้าอ่านไม่ออก) · onProgress รับ { progress 0..1 }
export async function readReceiptText(imageDataUrl, onProgress) {
  progressHandler = onProgress || null
  const worker = await getWorker()
  const { data } = await worker.recognize(imageDataUrl)
  return data.text || ''
}

// ปิด worker เพื่อคืนหน่วยความจำ (เรียกเมื่อออกจากหน้าได้ ไม่จำเป็นต้องเรียกทุกครั้ง)
export async function disposeReceiptOcr() {
  if (!workerPromise) return
  const p = workerPromise
  workerPromise = null
  const worker = await p.catch(() => null)
  if (worker) await worker.terminate()
}
