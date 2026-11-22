// เรียก SMS Gateway บนโทรศัพท์ที่ใช้ใบรับรองที่แอปสร้างเอง (self-signed ไม่มี SAN)
// - ไม่ตั้ง SMS_GATEWAY_CERT = ใช้ fetch ปกติ (เกตเวย์/รีเลย์ที่ใบรับรองออกโดย CA ที่เชื่อถือได้)
// - ตั้ง SMS_GATEWAY_CERT (PEM ของใบรับรองโทรศัพท์) = เปิด TLS โดยเชื่อเฉพาะใบนี้ใบเดียว (ใบอื่นถูกปฏิเสธ = ตรึงใบรับรอง)
//   ใบของแอปไม่มีชื่อโฮสต์ (มีแค่ CN=sms-gateway) จึงปิดเฉพาะการเทียบชื่อโฮสต์ ส่วนการตรวจลายเซ็น/อายุใบยังทำตามปกติ
// - คืน Response เหมือน fetch เพื่อให้จุดเรียกเดิมเปลี่ยนแค่ชื่อฟังก์ชัน
const MAX_REPLY = 64 * 1024

// อ่าน PEM จาก secret โดยยอมรับรูปแบบที่มักวางมา: บรรทัดเดียวมี \n · ขึ้นบรรทัดจริง · เว้นวรรคแทนการขึ้นบรรทัด · ไม่มีตัวคั่น
// แล้วจัดใหม่เป็น PEM มาตรฐาน (ขึ้นบรรทัดจริง ทุก 64 ตัว) · ตั้งค่าไว้แต่อ่านไม่ได้ = โยน gateway_cert_invalid (ไม่ลดเป็น fetch ปกติ)
export function gatewayCert(): string {
  const raw = (Deno.env.get('SMS_GATEWAY_CERT') || '').trim()
  if (!raw) return ''
  const m = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(raw.replace(/\\n/g, '\n'))
  const b64 = m ? m[1].replace(/[^A-Za-z0-9+/=]/g, '') : ''
  if (!b64) throw new Error('gateway_cert_invalid')
  return `-----BEGIN CERTIFICATE-----\n${b64.match(/.{1,64}/g)!.join('\n')}\n-----END CERTIFICATE-----\n`
}

type Init = { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }

export async function gwFetch(url: string, init: Init = {}): Promise<Response> {
  const cert = gatewayCert()
  if (!cert) return fetch(url, init)
  const u = new URL(url)
  if (u.protocol !== 'https:') throw new Error('gateway_cert_requires_https')
  return await tlsRequest(u, init, cert)
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

function indexOfCrlf2(b: Uint8Array): number {
  for (let i = 0; i + 3 < b.length; i++) if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i
  return -1
}

// ถอด Transfer-Encoding: chunked (คืน null ถ้ารูปแบบเสีย)
export function dechunk(b: Uint8Array): Uint8Array | null {
  const dec = new TextDecoder()
  const parts: Uint8Array[] = []
  let i = 0
  while (i < b.length) {
    let j = i
    while (j + 1 < b.length && !(b[j] === 13 && b[j + 1] === 10)) j++
    if (j + 1 >= b.length) return null
    const size = parseInt(dec.decode(b.subarray(i, j)).split(';')[0].trim(), 16)
    if (!Number.isFinite(size) || size < 0) return null
    if (size === 0) return concat(parts)
    const start = j + 2
    if (start + size > b.length) return null
    parts.push(b.subarray(start, start + size))
    i = start + size + 2
  }
  return null
}

// แยกคำตอบ HTTP/1.1 ดิบเป็น Response
export function parseHttpResponse(raw: Uint8Array): Response {
  const h = indexOfCrlf2(raw)
  if (h < 0) throw new Error('bad_response')
  const lines = new TextDecoder().decode(raw.subarray(0, h)).split('\r\n')
  const m = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0] || '')
  if (!m) throw new Error('bad_status_line')
  const headers = new Headers()
  for (const line of lines.slice(1)) {
    const k = line.indexOf(':')
    if (k > 0) headers.append(line.slice(0, k).trim(), line.slice(k + 1).trim())
  }
  let body: Uint8Array | null = raw.subarray(h + 4)
  if (/chunked/i.test(headers.get('transfer-encoding') || '')) body = dechunk(body)
  else {
    const len = Number(headers.get('content-length'))
    if (Number.isFinite(len) && len >= 0 && headers.has('content-length')) body = body.length >= len ? body.subarray(0, len) : null
  }
  if (!body) throw new Error('truncated_response')
  const status = Number(m[1])
  headers.delete('transfer-encoding')
  headers.delete('content-length')
  return new Response(status === 204 || status === 304 ? null : new Uint8Array(body), { status, headers })
}

// ตอบครบแล้วหรือยัง: ครบเมื่อได้หัวและเนื้อครบตาม Content-Length (หรือถึงช่อง chunked สุดท้าย)
// ไม่รอให้เซิร์ฟเวอร์ปิดการเชื่อมต่อ เพราะเซิร์ฟเวอร์อาจไม่ปิดทันทีแม้ส่ง Connection: close ทำให้รอจนหมดเวลา
function replyComplete(b: Uint8Array): boolean {
  const h = indexOfCrlf2(b)
  if (h < 0) return false
  const head = new TextDecoder().decode(b.subarray(0, h))
  const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0)
  if (status === 204 || status === 304) return true
  const body = b.subarray(h + 4)
  if (/^transfer-encoding:\s*chunked/im.test(head)) return dechunk(body) !== null
  const m = /^content-length:\s*(\d+)/im.exec(head)
  return m ? body.length >= Number(m[1]) : false
}

async function tlsRequest(u: URL, init: Init, cert: string): Promise<Response> {
  const port = Number(u.port || 443)
  const body = new TextEncoder().encode(init.body ?? '')
  const head: string[] = [`${(init.method || 'GET').toUpperCase()} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, 'Connection: close', 'Accept: application/json']
  for (const [k, v] of Object.entries(init.headers || {})) {
    if (/[\r\n]/.test(k + v) || /^(host|connection|content-length|transfer-encoding)$/i.test(k)) continue
    head.push(`${k}: ${v}`)
  }
  head.push(`Content-Length: ${body.length}`)
  const signal = init.signal
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
  // deno-lint-ignore no-explicit-any
  const opts: any = { hostname: u.hostname, port, caCerts: [cert], unsafelyDisableHostnameVerification: true }
  const conn = await Deno.connectTls(opts)
  const onAbort = () => { try { conn.close() } catch { /* ปิดแล้ว */ } }
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    await conn.handshake()
    await conn.write(concat([new TextEncoder().encode(head.join('\r\n') + '\r\n\r\n'), body]))
    const parts: Uint8Array[] = []
    let size = 0
    const buf = new Uint8Array(16 * 1024)
    while (true) {
      const n = await conn.read(buf)
      if (n === null) break
      size += n
      if (size > MAX_REPLY) throw new Error('reply_too_large')
      parts.push(buf.slice(0, n))
      if (replyComplete(concat(parts))) break
    }
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    return parseHttpResponse(concat(parts))
  } catch (e) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
    throw e
  } finally {
    signal?.removeEventListener('abort', onAbort)
    try { conn.close() } catch { /* ปิดแล้ว */ }
  }
}
