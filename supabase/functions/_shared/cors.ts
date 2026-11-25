// CORS แบบจำกัดต้นทาง (แทน '*'): ตอบ Access-Control-Allow-Origin เฉพาะหน้าเว็บและแอปที่อนุญาต
// ห่อ handler ด้วย corsWrap ใน Deno.serve · คำขอจากเซิร์ฟเวอร์ (ไม่มีหัว Origin) ไม่ได้รับหัว CORS
export const ALLOWED_ORIGINS = [
  'https://cake-order-admin.pages.dev', // หน้าเว็บ (Cloudflare Pages)
  'https://punpang.com', // โดเมนหลักของร้าน (Cloudflare)
  'https://www.punpang.com', // โดเมนหลักของร้าน (www)
  'https://localhost', // แอป Android (Capacitor 7 ค่าเริ่มต้น androidScheme = https)
  'capacitor://localhost', // แอป iOS (Capacitor)
  'http://localhost:5173', // พัฒนาในเครื่อง (vite dev)
  'http://localhost:4173', // ทดสอบในเครื่อง (vite preview)
] as const
const ALLOWED = new Set<string>(ALLOWED_ORIGINS)
const ALLOW_HEADERS = 'authorization, x-client-info, apikey, content-type, x-region, x-supabase-api-version'

export function allowedOrigin(origin: string | null): string | null {
  return origin && ALLOWED.has(origin) ? origin : null
}

type Handler = (req: Request) => Response | Promise<Response>

export function corsWrap(handler: Handler): (req: Request) => Promise<Response> {
  return async (req: Request) => {
    const origin = allowedOrigin(req.headers.get('origin'))
    if (req.method === 'OPTIONS') {
      const h = new Headers({
        'Access-Control-Allow-Headers': ALLOW_HEADERS,
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Max-Age': '600',
        'Vary': 'Origin',
      })
      if (origin) h.set('Access-Control-Allow-Origin', origin)
      return new Response('ok', { status: 200, headers: h })
    }
    const res = await handler(req)
    const h = new Headers(res.headers)
    h.set('Vary', 'Origin')
    if (origin) h.set('Access-Control-Allow-Origin', origin)
    else h.delete('Access-Control-Allow-Origin')
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h })
  }
}
