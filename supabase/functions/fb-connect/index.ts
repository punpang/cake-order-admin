import { createClient } from 'npm:@supabase/supabase-js@2'

// เชื่อมเพจ Facebook แบบกดปุ่ม (Facebook Login for Business · OAuth) — token เก็บฝั่งเซิร์ฟเวอร์เท่านั้น
// Secrets: FB_APP_ID, FB_APP_SECRET, FB_CONFIG_ID (ตัวเลือก: FB_GRAPH_VERSION, FB_APP_URL)
// POST (พนักงานล็อกอิน · JWT ตรวจในฟังก์ชัน): status | start | pages | select | disconnect (start/pages/select/disconnect ต้องมีสิทธิ์ manage)
// GET (Facebook เปลี่ยนเส้นทางกลับมา): ?code&state → แลก token → เก็บรายชื่อเพจชั่วคราว → กลับหน้าแอปให้เลือกเพจ
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const GRAPH = 'https://graph.facebook.com'
const TTL_MS = 15 * 60 * 1000

const hex = (b: ArrayBuffer | Uint8Array) => [...new Uint8Array(b as ArrayBuffer)].map((x) => x.toString(16).padStart(2, '0')).join('')
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)))
const cfg = () => ({
  appId: (Deno.env.get('FB_APP_ID') || '').trim(),
  secret: (Deno.env.get('FB_APP_SECRET') || '').trim(),
  configId: (Deno.env.get('FB_CONFIG_ID') || '').trim(),
  ver: (Deno.env.get('FB_GRAPH_VERSION') || 'v24.0').trim(),
  appUrl: (Deno.env.get('FB_APP_URL') || 'https://cake-order-admin.vercel.app').trim().replace(/\/+$/, ''),
})
const configured = (c: ReturnType<typeof cfg>) => /^\d{5,}$/.test(c.appId) && /^[0-9a-f]{20,}$/i.test(c.secret) && /^\d{5,}$/.test(c.configId)
const b64u = (t: string) => btoa(t).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const redirectUri = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1/fb-connect`
const back = (c: ReturnType<typeof cfg>, q: string) => new Response(null, { status: 302, headers: { Location: `${c.appUrl}/#/admin/settings/integrations?${q}`, 'Cache-Control': 'no-store' } })

async function gget(c: ReturnType<typeof cfg>, path: string, params: Record<string, string>) {
  const r = await fetch(`${GRAPH}/${c.ver}/${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(15000) })
  let body: any = null
  try { body = await r.json() } catch { /* ข้าม */ }
  return { ok: r.ok, status: r.status, body }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const c = cfg()

  // ---------- Facebook เปลี่ยนเส้นทางกลับมา ----------
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const state = u.searchParams.get('state') || ''
    const code = u.searchParams.get('code') || ''
    if (!configured(c)) return back(c, 'fb=error&m=config')
    if (u.searchParams.get('error') || !code || !/^[0-9a-f]{48}$/.test(state)) return back(c, 'fb=error&m=denied')
    const h = await sha256(`fbstate:${state}`)
    const row = await sb.from('punpang_fb_oauth').select('nonce_hash,user_id,expires_at,stage').eq('nonce_hash', h).maybeSingle()
    if (!row.data || row.data.stage !== 'started' || new Date(row.data.expires_at).getTime() < Date.now()) return back(c, 'fb=error&m=expired')
    // ใช้ state ได้ครั้งเดียว: เปลี่ยนสถานะก่อนแลก token (กันกดซ้ำ/เล่นซ้ำ)
    const claim = await sb.from('punpang_fb_oauth').update({ stage: 'pages', expires_at: new Date(Date.now() + TTL_MS).toISOString() }).eq('nonce_hash', h).eq('stage', 'started').select('nonce_hash')
    if (!claim.data?.length) return back(c, 'fb=error&m=expired')
    try {
      const t = await gget(c, 'oauth/access_token', { client_id: c.appId, client_secret: c.secret, redirect_uri: redirectUri(), code })
      const short = t.body?.access_token
      if (!t.ok || !short) return back(c, 'fb=error&m=token')
      // ขยายเป็น token อายุยาว (ถ้าแลกไม่ได้ ใช้ token เดิม)
      const l = await gget(c, 'oauth/access_token', { grant_type: 'fb_exchange_token', client_id: c.appId, client_secret: c.secret, fb_exchange_token: short })
      const userToken = (l.ok && l.body?.access_token) || short
      const p = await gget(c, 'me/accounts', { fields: 'id,name,access_token', limit: '100', access_token: userToken })
      const raw = Array.isArray(p.body?.data) ? p.body.data : []
      const pages = raw.filter((x: any) => x?.id && x?.access_token).map((x: any) => ({ id: String(x.id), name: String(x.name || ''), token: String(x.access_token) }))
      // ทางสำรอง: me/accounts ว่างได้ (เช่น Login for Business ที่เลือกเพจในหน้าอนุญาต) → อ่านเพจที่ผู้ใช้เลือกจาก debug_token (granular_scopes) แล้วดึง token ของเพจโดยตรง
      let picked = 0
      let ty = ''
      let valid = true
      const errs: number[][] = [] // [HTTP status, error.code, error.error_subcode] ของการเรียกที่ไม่ได้ token (ไม่เก็บข้อความ/token)
      const failed: string[] = [] // page id ที่อนุญาตแล้วแต่ดึงไม่ได้
      let fbMsg = '' // ข้อความ error แรกจาก Facebook (ตัดสั้น ลบสิ่งที่คล้าย token)
      const errOf = (r: { status: number; body: any }) => {
        const er = r.body?.error
        if (!fbMsg && er) fbMsg = `${String(er.type || '')}: ${String(er.message || '')}`.replace(/[A-Za-z0-9_\-|]{30,}/g, '***').replace(/[^\x20-\x7e]/g, '?').slice(0, 150)
        return [r.status, Number(er?.code) || 0, Number(er?.error_subcode) || 0]
      }
      try {
        const dbg = await gget(c, 'debug_token', { input_token: userToken, access_token: `${c.appId}|${c.secret}` })
        ty = String(dbg.body?.data?.type || '').replace(/[^A-Z_]/g, '').slice(0, 20)
        valid = dbg.body?.data?.is_valid !== false
        const gs: any[] = Array.isArray(dbg.body?.data?.granular_scopes) ? dbg.body.data.granular_scopes : []
        const ids = new Set<string>()
        for (const g of gs) if (['pages_messaging', 'pages_show_list', 'pages_manage_metadata'].includes(g?.scope)) for (const id of g?.target_ids || []) if (/^\d{5,30}$/.test(String(id))) ids.add(String(id))
        picked = ids.size
        for (const id of [...ids].slice(0, 10)) {
          if (pages.some((x: any) => x.id === id)) continue
          const r = await gget(c, id, { fields: 'id,name,access_token', access_token: userToken })
          if (r.ok && r.body?.id && r.body?.access_token) { pages.push({ id: String(r.body.id), name: String(r.body.name || ''), token: String(r.body.access_token) }); continue }
          failed.push(id)
          errs.push(errOf(r))
          errs.push(errOf(await gget(c, id, { fields: 'id,name', access_token: userToken }))) // อ่านเพจได้ไหม (แยกว่าขาดแค่ token)
        }
        if (!pages.length && !raw.length) { // ลอง me/accounts อีกครั้งโดยไม่ระบุ fields
          const p2 = await gget(c, 'me/accounts', { access_token: userToken })
          for (const x of Array.isArray(p2.body?.data) ? p2.body.data : []) if (x?.id && x?.access_token) pages.push({ id: String(x.id), name: String(x.name || ''), token: String(x.access_token) })
          errs.push(errOf(p2))
        }
      } catch { /* ใช้ผลจาก me/accounts */ }
      // รหัสวินิจฉัย (ไม่มี token/ชื่อเพจ): จำนวนเพจที่ได้/ที่มี token, HTTP status, สิทธิ์ที่ได้รับ
      const perms = await gget(c, 'me/permissions', { access_token: userToken })
      const granted = (Array.isArray(perms.body?.data) ? perms.body.data : []).filter((x: any) => x?.status === 'granted').map((x: any) => String(x.permission).replace(/[^a-z_]/g, '').slice(0, 40)).slice(0, 20)
      const d = b64u(JSON.stringify({ a: raw.length, t: pages.length, s: p.status, p: granted, g: picked, ty, v: valid ? 1 : 0, e: errs.slice(0, 8), m: fbMsg, x: failed.slice(0, 10) }))
      if (!p.ok) return back(c, `fb=error&m=pages&d=${d}`)
      if (!pages.length) return back(c, `fb=error&m=nopage&d=${d}`)
      await sb.from('punpang_fb_oauth').update({ pages }).eq('nonce_hash', h)
      return back(c, `fb=choose&n=${state}${failed.length ? `&d=${d}` : ''}`)
    } catch {
      return back(c, 'fb=error&m=network')
    }
  }

  if (req.method !== 'POST') return json({ error: 'method' }, 405)
  const jwt = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await sb.auth.getUser(jwt) : null
  const uid = u?.data?.user?.id
  if (!uid) return json({ error: 'ต้องเข้าสู่ระบบพนักงาน' }, 401)
  const st = await sb.from('punpang_staff').select('active,perms').eq('user_id', uid).maybeSingle()
  if (!st.data?.active) return json({ error: 'บัญชีนี้ไม่มีสิทธิ์' }, 403)
  const isManage = Array.isArray(st.data.perms) && st.data.perms.includes('manage')
  let body: { action?: string; nonce?: string; pageId?: string } = {}
  try { body = await req.json() } catch { return json({ error: 'คำขอไม่ถูกต้อง' }, 400) }

  if (body.action === 'status') {
    const pg = await sb.from('punpang_fb_pages').select('page_id,name,connected_at').limit(1).maybeSingle()
    return json({ configured: configured(c), page: pg.data ? { id: pg.data.page_id, name: pg.data.name, connectedAt: pg.data.connected_at } : null })
  }
  if (!isManage) return json({ error: 'เฉพาะผู้มีสิทธิ์จัดการ' }, 403)
  if (!configured(c)) return json({ error: 'ยังไม่ได้ตั้งค่า Facebook' }, 503)

  if (body.action === 'start') {
    const nonce = randomHex(24)
    await sb.from('punpang_fb_oauth').delete().lt('expires_at', new Date().toISOString())
    const ins = await sb.from('punpang_fb_oauth').insert({ nonce_hash: await sha256(`fbstate:${nonce}`), user_id: uid, expires_at: new Date(Date.now() + TTL_MS).toISOString() })
    if (ins.error) return json({ error: 'เริ่มเชื่อมไม่สำเร็จ' }, 500)
    const url = `https://www.facebook.com/${c.ver}/dialog/oauth?${new URLSearchParams({ client_id: c.appId, redirect_uri: redirectUri(), state: nonce, config_id: c.configId, response_type: 'code', override_default_response_type: 'true' })}`
    return json({ url })
  }

  const nonce = String(body.nonce || '')
  if (body.action === 'pages' || body.action === 'select') {
    if (!/^[0-9a-f]{48}$/.test(nonce)) return json({ error: 'คำขอไม่ถูกต้อง' }, 400)
    const h = await sha256(`fbstate:${nonce}`)
    const row = await sb.from('punpang_fb_oauth').select('user_id,expires_at,stage,pages').eq('nonce_hash', h).maybeSingle()
    if (!row.data || row.data.user_id !== uid || row.data.stage !== 'pages' || new Date(row.data.expires_at).getTime() < Date.now()) return json({ error: 'หมดอายุ กรุณากดเชื่อมใหม่' }, 410)
    const pages = (row.data.pages || []) as { id: string; name: string; token: string }[]
    if (body.action === 'pages') return json({ pages: pages.map((p) => ({ id: p.id, name: p.name })) })
    const pg = pages.find((p) => p.id === String(body.pageId || ''))
    if (!pg) return json({ error: 'ไม่พบเพจที่เลือก' }, 400)
    // ให้เพจส่งข้อความเข้า webhook ของแอป
    const sub = await fetch(`${GRAPH}/${c.ver}/${encodeURIComponent(pg.id)}/subscribed_apps`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ subscribed_fields: 'messages,messaging_postbacks', access_token: pg.token }), signal: AbortSignal.timeout(15000) }).catch(() => null)
    if (!sub || !sub.ok) return json({ error: 'ลงทะเบียนรับข้อความของเพจไม่สำเร็จ (ตรวจสิทธิ์ pages_manage_metadata และการตั้งค่า Webhook)', status: sub?.status ?? 0 }, 502)
    await sb.from('punpang_fb_pages').delete().neq('page_id', pg.id) // เชื่อมได้ครั้งละ 1 เพจ
    const up = await sb.from('punpang_fb_pages').upsert({ page_id: pg.id, name: pg.name, token: pg.token, connected_by: uid, connected_at: new Date().toISOString() })
    if (up.error) return json({ error: 'บันทึกการเชื่อมไม่สำเร็จ' }, 500)
    await sb.from('punpang_fb_oauth').delete().eq('nonce_hash', h)
    return json({ ok: true, page: { id: pg.id, name: pg.name } })
  }

  if (body.action === 'disconnect') {
    const pg = await sb.from('punpang_fb_pages').select('page_id,token').limit(1).maybeSingle()
    if (pg.data) {
      await fetch(`${GRAPH}/${c.ver}/${encodeURIComponent(pg.data.page_id)}/subscribed_apps?${new URLSearchParams({ access_token: pg.data.token })}`, { method: 'DELETE', signal: AbortSignal.timeout(15000) }).catch(() => null)
      await sb.from('punpang_fb_pages').delete().eq('page_id', pg.data.page_id)
    }
    return json({ ok: true })
  }
  return json({ error: 'ไม่รู้จักคำสั่ง' }, 400)
})
