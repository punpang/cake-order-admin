// เทสต์รีเลย์ SMS Gateway · รัน: node --test tools/sms-relay/relay.test.mjs (ต้องมีคำสั่ง openssl)
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { after, before, test } from 'node:test'
import { createRelay, pinOf } from './relay.mjs'

const SKIP = (() => {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); return false } catch { return true }
})()
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-relay-'))
const quiet = () => {}

// ใบรับรองทดสอบ (self-signed) สร้างด้วย openssl ในโฟลเดอร์ชั่วคราว
function makeCert(name) {
  const key = path.join(dir, `${name}.key`)
  const crt = path.join(dir, `${name}.crt`)
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'ignore' })
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt), crtPath: crt }
}
const derOf = (pem) => Buffer.from(pem.toString().replace(/-----[^-]+-----|\s+/g, ''), 'base64')

// โทรศัพท์จำลอง: บันทึกทุกคำขอที่มาถึง
function startPhone(cert) {
  const received = []
  const server = https.createServer({ key: cert.key, cert: cert.cert }, (req, res) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8')
      received.push({ route: `${req.method} ${req.url}`, headers: req.headers, body })
      const reply = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
      if (req.method === 'POST' && req.url === '/v1/sms') {
        return req.headers['idempotency-key'] === 'dup-key-000001' ? reply(409, { error: 'idempotency_key_reused' }) : reply(202, { id: 7, status: 'QUEUED' })
      }
      if (req.method === 'GET' && req.url === '/v1/status') return reply(200, { running: true })
      reply(404, { error: 'not_found' })
    })
  })
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok({ server, port: server.address().port, received })))
}

const listen = (srv) => new Promise((ok) => srv.listen(0, '127.0.0.1', () => ok(srv.address().port)))
const freePort = () => new Promise((ok) => {
  const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)) })
})

// เรียกรีเลย์ผ่าน HTTPS (เชื่อใบรับรองทดสอบของรีเลย์)
function call(port, ca, { method = 'GET', path: p = '/', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, method, path: p, ca, agent: false, headers: { ...headers, 'content-length': String(Buffer.byteLength(body)) } }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

let phone, phoneCert, relayCert, relayKey, relay, relayPort, PIN

before(async () => {
  if (SKIP) return
  phoneCert = makeCert('phone')
  const rc = makeCert('relay')
  relayCert = rc.cert
  relayKey = rc.key
  phone = await startPhone(phoneCert)
  PIN = pinOf(derOf(phoneCert.cert))
  relay = createRelay({ key: relayKey, cert: relayCert, phoneHost: '127.0.0.1', phonePort: phone.port, phonePin: PIN, log: quiet })
  relayPort = await listen(relay)
})

after(() => {
  relay?.closeAllConnections()
  relay?.close()
  phone?.server.closeAllConnections()
  phone?.server.close()
  fs.rmSync(dir, { recursive: true, force: true })
})

test('pinOf ตรงกับค่าที่ openssl คำนวณจาก SPKI', { skip: SKIP }, () => {
  const pub = execFileSync('openssl', ['x509', '-in', phoneCert.crtPath, '-pubkey', '-noout'])
  const spki = execFileSync('openssl', ['pkey', '-pubin', '-outform', 'der'], { input: pub })
  assert.equal(pinOf(derOf(phoneCert.cert)), 'sha256//' + crypto.createHash('sha256').update(spki).digest('base64'))
})

test('POST /v1/sms ส่งต่อ header ที่ใช้และ body ครบ แล้วคืนคำตอบของโทรศัพท์', { skip: SKIP }, async () => {
  const n0 = phone.received.length
  const body = JSON.stringify({ to: '0812345678', message: 'รหัส OTP 123456' })
  const r = await call(relayPort, relayCert, { method: 'POST', path: '/v1/sms', headers: { authorization: 'Bearer test-key', 'idempotency-key': 'otp-0123456789abcdef', 'content-type': 'application/json; charset=utf-8', cookie: 'x=1' }, body })
  assert.equal(r.status, 202)
  assert.deepEqual(JSON.parse(r.text), { id: 7, status: 'QUEUED' })
  assert.equal(phone.received.length, n0 + 1)
  const got = phone.received[n0]
  assert.equal(got.route, 'POST /v1/sms')
  assert.equal(got.headers.authorization, 'Bearer test-key')
  assert.equal(got.headers['idempotency-key'], 'otp-0123456789abcdef')
  assert.equal(got.headers.cookie, undefined) // header ที่ไม่ได้ใช้ไม่ถูกส่งต่อ
  assert.equal(got.body, body)
})

test('GET /v1/status ส่งต่อได้', { skip: SKIP }, async () => {
  const r = await call(relayPort, relayCert, { path: '/v1/status', headers: { authorization: 'Bearer test-key' } })
  assert.equal(r.status, 200)
  assert.equal(JSON.parse(r.text).running, true)
})

test('เส้นทางที่ไม่อนุญาตตอบ 404 และไม่ถูกส่งต่อ', { skip: SKIP }, async () => {
  const n0 = phone.received.length
  const blocked = [
    ['DELETE', '/v1/messages/out/1'],
    ['POST', '/v1/messages/clear-finished'],
    ['PUT', '/v1/settings/retention'],
    ['GET', '/v1/messages?direction=in'],
    ['GET', '/v1/sms/7'],
  ]
  for (const [method, p] of blocked) {
    const r = await call(relayPort, relayCert, { method, path: p, headers: { authorization: 'Bearer test-key' } })
    assert.equal(r.status, 404, `${method} ${p}`)
  }
  assert.equal(phone.received.length, n0)
})

test('body เกิน 8 KB ตอบ 413 และไม่ถูกส่งต่อ', { skip: SKIP }, async () => {
  const n0 = phone.received.length
  const r = await call(relayPort, relayCert, { method: 'POST', path: '/v1/sms', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' }, body: 'x'.repeat(9000) })
  assert.equal(r.status, 413)
  assert.equal(phone.received.length, n0)
})

test('pin ไม่ตรง: ไม่ส่งข้อมูลใดไปยังโทรศัพท์ และตอบ 502', { skip: SKIP }, async () => {
  const other = makeCert('other')
  const bad = createRelay({ key: relayKey, cert: relayCert, phoneHost: '127.0.0.1', phonePort: phone.port, phonePin: pinOf(derOf(other.cert)), log: quiet })
  const port = await listen(bad)
  try {
    const n0 = phone.received.length
    const r = await call(port, relayCert, { method: 'POST', path: '/v1/sms', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' }, body: '{"to":"0812345678","message":"x"}' })
    assert.equal(r.status, 502)
    assert.equal(JSON.parse(r.text).error, 'gateway_unavailable')
    assert.equal(phone.received.length, n0)
  } finally {
    bad.closeAllConnections()
    bad.close()
  }
})

test('จำกัดอัตราต่อ IP: เกินโควตาในนาทีเดียวกันตอบ 429', { skip: SKIP }, async () => {
  const limited = createRelay({ key: relayKey, cert: relayCert, phoneHost: '127.0.0.1', phonePort: phone.port, phonePin: PIN, rateLimitPerMin: 3, log: quiet })
  const port = await listen(limited)
  try {
    const codes = []
    for (let i = 0; i < 4; i++) codes.push((await call(port, relayCert, { path: '/v1/status', headers: { authorization: 'Bearer test-key' } })).status)
    assert.deepEqual(codes, [200, 200, 200, 429])
  } finally {
    limited.closeAllConnections()
    limited.close()
  }
})

test('ส่งต่อรหัสผิดพลาดของโทรศัพท์ตามเดิม (เช่น 409)', { skip: SKIP }, async () => {
  const r = await call(relayPort, relayCert, { method: 'POST', path: '/v1/sms', headers: { authorization: 'Bearer test-key', 'idempotency-key': 'dup-key-000001', 'content-type': 'application/json' }, body: '{"to":"0812345678","message":"x"}' })
  assert.equal(r.status, 409)
  assert.equal(JSON.parse(r.text).error, 'idempotency_key_reused')
})

test('โทรศัพท์ไม่ได้เปิดพอร์ต: ตอบ 502', { skip: SKIP }, async () => {
  const off = createRelay({ key: relayKey, cert: relayCert, phoneHost: '127.0.0.1', phonePort: await freePort(), phonePin: PIN, upstreamTimeoutMs: 3000, log: quiet })
  const port = await listen(off)
  try {
    const r = await call(port, relayCert, { path: '/v1/status', headers: { authorization: 'Bearer test-key' } })
    assert.equal(r.status, 502)
  } finally {
    off.closeAllConnections()
    off.close()
  }
})
