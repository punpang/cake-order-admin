// ทดสอบการจัดประเภทผลอัปโหลดรูปของออร์เดอร์: 2xx พร้อมลิงก์ = สำเร็จ · 2xx ไม่มีลิงก์ = ถาวรเฉพาะออร์เดอร์นั้น · 401/5xx = ชั่วคราว · 403 = ถาวร · รัน: node src/lib/storage.upload.test.mjs
import { fileURLToPath } from 'node:url'
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { isTransientError } from './tableSync.js'

process.env.VITE_FILES_URL = 'https://files.test' // เซิร์ฟเวอร์ไฟล์จำลอง (โมดูลอ่านค่านี้ตอนโหลด)
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const server = await createServer({ root: ROOT, server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' })
after(() => server.close())
const { uploadPrivateImage } = await server.ssrLoadModule('/src/lib/storage.js')

// คำตอบของเซิร์ฟเวอร์ไฟล์ตามแต่ละเทสต์ · ข้อมูลรูปในเครื่อง (data:) ยังอ่านจริง
let reply = null
const realFetch = globalThis.fetch
globalThis.fetch = async (url, init) => (String(url).startsWith('https://files.test/') ? reply : realFetch(url, init))
after(() => { globalThis.fetch = realFetch })

const client = { auth: { getSession: async () => ({ data: { session: null } }) } }
const img = 'data:image/png;base64,iVBORw0KGgo='
const respond = (ok, status, body) => { reply = { ok, status, json: async () => body } }

test('เซิร์ฟเวอร์ตอบพร้อมลิงก์ → สำเร็จ', async () => {
  respond(true, 200, { ref: 'r2://private/o1/a.png' })
  assert.equal(await uploadPrivateImage(client, img, 'o1'), 'r2://private/o1/a.png')
})

test('ตอบ 2xx แต่ไม่มีลิงก์ → ถาวรเฉพาะออร์เดอร์นั้น ไม่ใช่ชั่วคราว', async () => {
  respond(true, 200, {})
  await assert.rejects(uploadPrivateImage(client, img, 'o1'), (e) => { assert.equal(e.code, 'BAD_RESPONSE'); assert.equal(isTransientError(e), false); return true })
})

test('เซิร์ฟเวอร์ตอบ 503 → ชั่วคราว ลองใหม่ได้', async () => {
  respond(false, 503, { error: 'ไม่พร้อม' })
  await assert.rejects(uploadPrivateImage(client, img, 'o1'), (e) => { assert.equal(isTransientError(e), true); return true })
})

test('เซสชันหมดอายุ 401 → ชั่วคราว', async () => {
  respond(false, 401, { error: 'JWT expired' })
  await assert.rejects(uploadPrivateImage(client, img, 'o1'), (e) => { assert.equal(isTransientError(e), true); return true })
})

test('ไม่มีสิทธิ์ 403 → ถาวร', async () => {
  respond(false, 403, { error: 'ไม่มีสิทธิ์' })
  await assert.rejects(uploadPrivateImage(client, img, 'o1'), (e) => { assert.equal(isTransientError(e), false); return true })
})
