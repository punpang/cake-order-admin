// รีเลย์ SMS Gateway สำหรับรันในวง LAN เดียวกับโทรศัพท์ (Node 20 ขึ้นไป · ไม่มีไลบรารีภายนอก)
// หน้าที่: รับ HTTPS ที่พอร์ตสาธารณะด้วยใบรับรองที่คลาวด์เชื่อถือ แล้วส่งต่อไปยังโทรศัพท์ในวง LAN
// ใบรับรองของแอปเป็น self-signed จึงไม่ตรวจ CA แต่ตรวจ pin ของแอปก่อนส่งข้อมูลทุกครั้ง
// ความปลอดภัย: อนุญาตเฉพาะเส้นทางที่ระบบใช้ · จำกัดขนาด body และอัตรา · ไม่บันทึกคีย์หรือเนื้อหา SMS
// ตั้งค่าด้วยตัวแปรสภาพแวดล้อม ดู README.md

import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import tls from 'node:tls'
import { pathToFileURL } from 'node:url'

// เส้นทางที่อนุญาต (ตาม docs/sms-gateway-api.md) · เส้นทางอื่นตอบ 404 และไม่ส่งต่อ
export const ALLOWED = new Set(['POST /v1/sms', 'GET /v1/status'])
const MAX_BODY = 8 * 1024 // เอกสารกำหนด body สูงสุด 8 KB
const MAX_REPLY = 64 * 1024 // ขนาดคำตอบจากโทรศัพท์ที่ยอมรับ
const FORWARD = ['authorization', 'idempotency-key', 'content-type'] // ส่งต่อเฉพาะ header ที่ใช้

// pin แบบเดียวกับ curl --pinnedpubkey: 'sha256//' + base64(sha256(SPKI ของใบรับรอง)) · รับใบรับรองแบบ DER
export function pinOf(certDer) {
  const spki = new crypto.X509Certificate(certDer).publicKey.export({ type: 'spki', format: 'der' })
  return 'sha256//' + crypto.createHash('sha256').update(spki).digest('base64')
}

// ส่งคำขอหนึ่งครั้งไปยังโทรศัพท์: เปิด TLS → ตรวจ pin → จึงส่ง HTTP (ก่อนผ่าน pin จะไม่ส่งข้อมูลใด ๆ)
function forwardToPhone({ host, port, pin, timeoutMs, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    let settled = false
    const sock = tls.connect({ host, port, rejectUnauthorized: false })
    const fail = (err) => {
      if (settled) return
      settled = true
      sock.destroy()
      reject(err)
    }
    sock.setTimeout(timeoutMs, () => fail(new Error('timeout')))
    sock.on('error', fail)
    sock.on('close', () => fail(new Error('closed')))
    sock.once('secureConnect', () => {
      const cert = sock.getPeerCertificate(true)
      if (!cert?.raw || pinOf(cert.raw) !== pin) return fail(new Error('pin_mismatch'))
      // Agent นี้ใช้ซ็อกเก็ต TLS ที่ตรวจ pin แล้วเท่านั้น ไม่เปิดการเชื่อมต่อใหม่เอง
      const agent = new http.Agent({ keepAlive: false })
      agent.createConnection = () => sock
      const req = http.request({
        method,
        path,
        agent,
        headers: { ...headers, host: `${host}:${port}`, connection: 'close', 'content-length': String(body.length) },
      }, (res) => {
        const chunks = []
        let size = 0
        res.on('data', (c) => {
          size += c.length
          if (size > MAX_REPLY) return fail(new Error('reply_too_large'))
          chunks.push(c)
        })
        res.on('end', () => {
          if (settled) return
          settled = true
          resolve({ status: res.statusCode, type: res.headers['content-type'], body: Buffer.concat(chunks) })
        })
        res.on('error', fail)
      })
      req.on('error', fail)
      req.end(body)
    })
  })
}

// อ่าน body ไม่เกินขนาดที่กำหนด · เกินแล้วคืน null (ส่วนที่เหลือถูกทิ้ง)
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => {
      size += c.length
      if (size > MAX_BODY) return resolve(null)
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', () => resolve(null))
  })
}

function pickHeaders(h) {
  return Object.fromEntries(FORWARD.filter((k) => h[k] !== undefined).map((k) => [k, h[k]]))
}

// สร้างเซิร์ฟเวอร์รีเลย์ (ยังไม่เปิดพอร์ต · ผู้เรียก listen เอง)
export function createRelay({ key, cert, phoneHost, phonePort = 8443, phonePin, rateLimitPerMin = 30, upstreamTimeoutMs = 10_000, log = (line) => console.log(line) }) {
  const hits = new Map() // IP → { n, reset } · นับคำขอในหน้าต่าง 1 นาที
  const overLimit = (ip) => {
    const now = Date.now()
    let h = hits.get(ip)
    if (!h || now >= h.reset) {
      if (hits.size > 5000) for (const [k, v] of hits) if (now >= v.reset) hits.delete(k)
      h = { n: 0, reset: now + 60_000 }
      hits.set(ip, h)
    }
    h.n += 1
    return h.n > rateLimitPerMin
  }

  const server = https.createServer({ key, cert, minVersion: 'TLSv1.2' }, async (req, res) => {
    const t0 = Date.now()
    const ip = req.socket.remoteAddress || '-'
    let route = '-'
    const logDone = (status, note = '') => log(`${new Date(t0).toISOString()} ${ip} ${route} ${status} ${Date.now() - t0}ms${note ? ` ${note}` : ''}`)
    const sendJson = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' })
      res.end(JSON.stringify(obj))
    }
    try {
      const url = new URL(req.url || '/', 'https://relay.invalid')
      route = `${req.method} ${url.pathname}`
      if (overLimit(ip)) {
        sendJson(429, { error: 'rate_limited' })
        return logDone(429)
      }
      if (!ALLOWED.has(route)) {
        sendJson(404, { error: 'not_found' })
        return logDone(404)
      }
      const body = await readBody(req)
      if (!body) {
        sendJson(413, { error: 'body_too_large' })
        return logDone(413)
      }
      try {
        const up = await forwardToPhone({ host: phoneHost, port: phonePort, pin: phonePin, timeoutMs: upstreamTimeoutMs, method: req.method, path: url.pathname, headers: pickHeaders(req.headers), body })
        res.writeHead(up.status, { 'content-type': up.type || 'application/json; charset=utf-8', 'cache-control': 'no-store', connection: 'close' })
        res.end(up.body)
        return logDone(up.status)
      } catch (e) {
        sendJson(502, { error: 'gateway_unavailable' })
        return logDone(502, e.message)
      }
    } catch (e) {
      if (!res.headersSent) sendJson(500, { error: 'internal_error' })
      logDone(500, e.message)
    }
  })
  server.requestTimeout = 20_000
  server.headersTimeout = 10_000
  return server
}

// เริ่มทำงานเมื่อรันไฟล์นี้โดยตรง: node relay.mjs
const isMain = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const env = process.env
  const need = (name) => {
    const v = (env[name] || '').trim()
    if (!v) throw new Error(`ยังไม่ได้ตั้งค่า ${name}`)
    return v
  }
  try {
    const pin = need('PHONE_PIN')
    if (!/^sha256\/\/[A-Za-z0-9+/]+=*$/.test(pin)) throw new Error('PHONE_PIN ต้องขึ้นต้นด้วย sha256//')
    const phoneHost = need('PHONE_HOST')
    const phonePort = Number(env.PHONE_PORT || 8443)
    const port = Number(env.RELAY_PORT || 6330)
    const server = createRelay({
      key: fs.readFileSync(need('RELAY_TLS_KEY')),
      cert: fs.readFileSync(need('RELAY_TLS_CERT')),
      phoneHost,
      phonePort,
      phonePin: pin,
    })
    server.listen(port, () => console.log(`รีเลย์ฟังที่พอร์ต ${port} → โทรศัพท์ ${phoneHost}:${phonePort}`))
  } catch (e) {
    console.error(e.message)
    process.exit(1)
  }
}
