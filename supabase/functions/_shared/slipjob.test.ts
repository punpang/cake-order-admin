import { Buffer } from 'node:buffer'
// ทดสอบงานตรวจสลิป end-to-end: รูป (สร้างจริงแล้วถอดรหัส) → จับคู่ออร์เดอร์ → ข้อมูลออร์เดอร์/แชท/กระดิ่ง
// ใช้ตัวจำลอง supabase ที่เลียนแบบ select/eq/contains/update(CAS)/insert/rpc/storage
import { assertEquals } from 'jsr:@std/assert@1'
import QRCode from 'npm:qrcode@1.5.4'
import { PNG } from 'npm:pngjs@7.0.0'
import { checkSlipImage } from './slipjob.ts'

const SLIP = '0037000600000101030040216A1B2C3D4E5F6G7H85102TH9104DE9E' // สลิปธนาคาร 004 เลขอ้างอิง A1B2C3D4E5F6G7H8
const PROMPTPAY_540 = '00020101021229370016A000000677010111011300668123456785802TH53037645406540.0063048A50'
const NOW = Date.UTC(2026, 10, 11, 3, 0, 0) // 10:00 เวลาไทย 11-11-2569

// รูปหน้าจอสลิป: พื้นขาว 1080x1920 มี QR ขนาดราว 150 px อยู่ด้านล่างขวา (ใกล้เคียงสลิปจริง)
async function slipScreenshot(text: string, scale = 3): Promise<Uint8Array> {
  const qr = PNG.sync.read(Buffer.from(await QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 4, scale })))
  const W = 1080, H = 1920
  const img = new PNG({ width: W, height: H })
  img.data.fill(255)
  const x0 = W - qr.width - 80, y0 = H - qr.height - 200
  for (let y = 0; y < qr.height; y++) for (let x = 0; x < qr.width; x++) {
    const si = (y * qr.width + x) * 4, di = ((y0 + y) * W + (x0 + x)) * 4
    img.data[di] = qr.data[si]; img.data[di + 1] = qr.data[si + 1]; img.data[di + 2] = qr.data[si + 2]; img.data[di + 3] = 255
  }
  return new Uint8Array(PNG.sync.write(img))
}
const qrPlain = async (text: string) => new Uint8Array(await QRCode.toBuffer(text, { type: 'png', errorCorrectionLevel: 'M', margin: 4, scale: 4 }))

// ---- ตัวจำลอง supabase ----
function fakeSb(init: { chats?: any[]; orders?: any[]; kv?: any[] } = {}) {
  const T: Record<string, any[]> = { punpang_chats: init.chats ?? [], punpang_orders: init.orders ?? [], punpang_kv: init.kv ?? [], punpang_records: [] }
  const files = new Map<string, Uint8Array>()
  const calls = { rpc: 0, uploads: 0, removes: 0 }
  const hooks: { beforeOrderUpdate: null | ((rows: any[]) => void); uploadFail: boolean; orderUpdateError: null | { code: string; message: string }; chatConflicts: number } = { beforeOrderUpdate: null, uploadFail: false, orderUpdateError: null, chatConflicts: 0 }
  let tick = 0
  let payNo = 1
  const stamp = () => new Date(NOW + ++tick * 1000).toISOString()
  const jsonContains = (a: any, b: any): boolean => {
    if (Array.isArray(b)) return Array.isArray(a) && b.every((bi) => a.some((ai) => jsonContains(ai, bi)))
    if (b && typeof b === 'object') return !!a && typeof a === 'object' && !Array.isArray(a) && Object.keys(b).every((k) => jsonContains(a[k], b[k]))
    return a === b
  }
  const from = (table: string) => {
    const q: any = { op: 'select', filters: [] as Array<(r: any) => boolean>, patch: null, limitN: null }
    const api: any = {
      select: () => api,
      eq: (c: string, v: any) => { q.filters.push((r: any) => r[c] === v); return api },
      in: (c: string, vs: any[]) => { q.filters.push((r: any) => vs.includes(r[c])); return api },
      contains: (c: string, obj: any) => { q.filters.push((r: any) => jsonContains(r[c], obj)); return api },
      limit: (n: number) => { q.limitN = n; return api },
      update: (patch: any) => { q.op = 'update'; q.patch = patch; return api },
      insert: (row: any) => { q.op = 'insert'; q.patch = row; return api },
      maybeSingle: () => run(true),
      then: (res: any, rej: any) => run(false).then(res, rej),
    }
    const run = (single: boolean) => Promise.resolve().then(() => {
      const list = T[table]
      if (q.op === 'insert') { list.push(structuredClone(q.patch)); return { data: q.patch, error: null } }
      if (q.op === 'update' && table === 'punpang_orders' && hooks.orderUpdateError) { const e = hooks.orderUpdateError; hooks.orderUpdateError = null; return { data: null, error: e } }
      if (q.op === 'update' && table === 'punpang_orders' && hooks.beforeOrderUpdate) { const h = hooks.beforeOrderUpdate; hooks.beforeOrderUpdate = null; h(list) }
      // จำลองแชทถูกเขียนชนกัน: เปลี่ยน updated_at ของแถวที่ตรงเงื่อนไข ทำให้การเขียนตามเวลาเดิมไม่ตรง
      if (q.op === 'update' && table === 'punpang_chats' && hooks.chatConflicts > 0) { hooks.chatConflicts--; for (const r of list) if (q.filters.every((f: any) => f(r))) r.updated_at = stamp() }
      const hit = list.filter((r) => q.filters.every((f: any) => f(r)))
      if (q.op === 'update') {
        for (const r of hit) Object.assign(r, q.patch, { updated_at: stamp() })
        return { data: hit.map((r) => ({ id: r.id })), error: null }
      }
      const out = q.limitN != null ? hit.slice(0, q.limitN) : hit
      if (single) return { data: out[0] ? structuredClone(out[0]) : null, error: null }
      return { data: structuredClone(out), error: null }
    })
    return api
  }
  return {
    from,
    rpc: async (name: string, _args: any) => { calls.rpc++; return name === 'punpang_alloc_numbers_server' ? { data: payNo++, error: null } : { data: null, error: { message: 'unknown rpc' } } },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, bytes: Uint8Array) => { calls.uploads++; if (hooks.uploadFail) return { error: { message: 'fail' } }; files.set(`${bucket}/${path}`, bytes); return { error: null } },
        remove: async (paths: string[]) => { calls.removes++; for (const p of paths) files.delete(`${bucket}/${p}`); return { error: null } },
      }),
    },
    T, files, calls, hooks,
  }
}

const ORDER_CREATED = '2026-11-11T02:00:00.000Z' // ออร์เดอร์สร้างเวลา 09:00 เวลาไทย 11-11-2569
const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', code: 'OR-111126-000010', status: 'awaiting_payment', customer_id: 'cu1', updated_at: 't0',
  data: { items: [{ unitPrice: 540, qty: 1 }], payments: [], history: [], createdAt: ORDER_CREATED, ...over },
})
const chatWith = (messages: any[]) => ({ id: 'c1', channel: 'facebook', external_id: '123', customer_id: 'cu1', updated_at: 'v0', data: { profileName: 'ลูกค้าทดสอบ', messages } })
const slipMsg = { id: 'm1', from: 'customer', kind: 'text', text: '', fbMid: 'mid1', attachments: [{ type: 'image', path: 'fb/123/mid1-0.png' }], by: 'ลูกค้า' }
const staffRef = (orderId: string) => ({ id: 's1', from: 'staff', kind: 'text', text: 'สรุปออร์เดอร์ให้แล้วค่ะ', orderId, by: 'พนักงาน' })
const kvSlip = (enabled: boolean) => ({ collection: 'config', id: 'slipQr', data: { v: { enabled } } })
// เซิร์ฟเวอร์ไฟล์จำลอง (Worker): เก็บไฟล์ลงแมป sb.files ตามคีย์ที่ Worker จะออกให้ และนับการอัปโหลด/ลบเหมือนตัวจำลองเดิม
const svcFake = (sb: any) => ({
  url: 'https://files.test',
  key: 'svc-key',
  fetchImpl: (async (input: any, init: any) => {
    const u = new URL(String(input))
    if (u.pathname === '/svc/upload') {
      sb.calls.uploads++
      if (sb.hooks.uploadFail) return new Response('{"error":"fail"}', { status: 500 })
      const body = new Uint8Array(init.body)
      const key = `${u.searchParams.get('prefix') || ''}/${'a'.repeat(32)}.${body[0] === 0x89 ? 'png' : 'jpg'}`
      sb.files.set(key, body)
      return new Response(JSON.stringify({ key, ref: `r2://private/${key}` }), { status: 200 })
    }
    if (u.pathname === '/svc/delete') {
      sb.calls.removes++
      for (const k of JSON.parse(String(init.body)).keys) sb.files.delete(k)
      return new Response('{"ok":true}', { status: 200 })
    }
    return new Response('{}', { status: 404 })
  }) as typeof fetch,
})
const runCheck = (sb: any, bytes: Uint8Array, extra: Record<string, unknown> = {}) => checkSlipImage({ sb, chatId: 'c1', msgId: 'm1', bytes, nowMs: NOW, rand: (n) => 'a'.repeat(n * 2).slice(0, n * 2), files: svcFake(sb), ...extra })

// ---- ตั้งค่าและตัวอ่านสำหรับการผูกอัตโนมัติ: ต้องอ่านได้ครบ 4 ข้อและตรงกับออร์เดอร์ o1 ----
const SHOP = '014000000517185' // รหัสร้านค้าที่ตั้งไว้ในหน้าตั้งค่าร้าน
const WAI_CRED = { accountId: 'a', token: 't', model: '' }
const shopKv = { collection: 'config', id: 'shop', data: { v: { merchantCode: SHOP } } }
const slipKv = (v: Record<string, unknown>) => ({ collection: 'config', id: 'slipQr', data: { v } })
const kvOcr = (mode: 'auto' | 'manual', enabled: boolean) => ({ collection: 'config', id: 'slipQr', data: { v: { enabled: true, mode, ocr: { claude: enabled } } } })
const kvOcrAll = (flags: { wai?: boolean; claude?: boolean }) => ({ collection: 'config', id: 'slipQr', data: { v: { enabled: true, mode: 'auto', ocr: flags } } })
const ocrFields = (f: { amount: number | null; paidAt: string | null }) => async () => f
// ค่าที่อ่านได้ครบและตรงกับออร์เดอร์ o1: ยอด 540 = ยอดค้าง · วัน-เวลาหลัง 09:00 · รหัสร้านค้าตรง · รหัสอ้างอิง OR-111126-000010
const QR_REF = 'K7M3QRT2XBHD' // รหัสสุ่ม (Ref 2) ของรายการแจ้งชำระที่ลูกค้าขอ QR ไว้
const fieldsOk = (over: Record<string, unknown> = {}) => ({ amount: 540, paidAt: '2026-11-11T10:00', receiverName: null, receiverAccount: 'xxx-x-x8154-x', merchantCode: SHOP, shopRef: 'ORD111126000010', qrRef: QR_REF, ...over })
const autoOpts = (over: Record<string, unknown> = {}) => ({ ocrWai: WAI_CRED, ocrReadBy: { wai: async () => fieldsOk(over) } })
const AUTO_KV = () => [kvOcrAll({ wai: true }), shopKv]
// รายการแจ้งชำระที่ลูกค้าขอ QR ไว้ (รหัสสุ่มตรงกับ fieldsOk · ยอดเท่ากับยอดในสลิป) → ยืนยันอัตโนมัติได้ครบ 5 ข้อ
const reqPayment = (over: Record<string, unknown> = {}) => ({ id: 'pr1', code: 'PAY-111126-00001', status: 'reported', requested: 540, amount: 540, method: 'โอนเงิน', dueAt: '', extension: null, source: 'customer', qrRequest: true, qrRef: QR_REF, customerSubmitted: false, createdAt: ORDER_CREATED, reportedBy: 'customer', confirmedBy: null, ...over })
const orderQr = (over: Record<string, unknown> = {}) => order({ payments: [reqPayment()], ...over })

// ---- ผูกอัตโนมัติเมื่อครบ 4 ข้อ (ยอด · วัน-เวลา · รหัสร้านค้า · รหัสอ้างอิงร้านค้า) ----
Deno.test('วัน-เวลาชำระก่อนเวลาสร้างออร์เดอร์ → ไม่ผูกอัตโนมัติ ส่งให้พนักงานตรวจพร้อมเครื่องหมาย ✗', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ createdAt: '2026-11-11T08:00:00.000Z' })], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ paidAt: '2026-11-11T14:48' })), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'manual')
  assertEquals(msg.slipCheck.checks.find((c: any) => c.key === 'paidAt').ok, false)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('โอนก่อนเวลาสร้างออร์เดอร์'), true)
})

Deno.test('ยอดเกินยอดค้าง → ไม่ผูกอัตโนมัติ ส่งให้พนักงานพร้อม ✗ ที่ยอด', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ amount: 900 })), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.status, msg.slipCheck.orderId], ['manual', 'o1'])
  assertEquals(msg.slipCheck.checks.find((c: any) => c.key === 'amount').ok, false)
  assertEquals(msg.slipCheck.checks.find((c: any) => c.key === 'paidAt').ok, true)
})

Deno.test('รหัสอ้างอิงร้านค้า (ORD) บนสลิปจับคู่ออร์เดอร์ได้ แม้แชทยังไม่มีออร์เดอร์ที่คุยล่าสุด', async () => {
  const sb = fakeSb({ chats: [chatWith([slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  const p = sb.T.punpang_orders[0].data.payments[0]
  assertEquals([p.shopRef, p.merchantMismatch], ['ORD111126000010', undefined])
})

Deno.test('รหัสร้านค้าไม่ตรงกับที่ตั้งไว้ หรืออ่านไม่ได้ → ไม่ผูกอัตโนมัติ ส่งให้พนักงานพร้อมธง', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ merchantCode: '014000000517186' })), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.merchantMismatch, true)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('รหัสร้านค้าในสลิปไม่ตรง'), true)
  const sb2 = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb2, await slipScreenshot(SLIP), autoOpts({ merchantCode: undefined })), 'manual')
  assertEquals(sb2.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1').slipCheck.merchantMismatch, true)
})

Deno.test('ครบ 5 เงื่อนไข → ผูกอัตโนมัติเข้ารายการแจ้งชำระที่ขอ QR ไว้ เก็บยอดรอตรวจ แจ้งกระดิ่ง และติดป้ายในแชท', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals(o.status, 'payment_reported')
  assertEquals(o.data.payments.length, 1)
  const p = o.data.payments[0]
  assertEquals([p.code, p.amount, p.status, p.source, p.customerSubmitted], ['PAY-111126-00001', 540, 'reported', 'customer', true])
  assertEquals(p.slipKey, '004:A1B2C3D4E5F6G7H8')
  assertEquals(p.slip, 'r2://private/o1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
  assertEquals(sb.files.has('o1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)
  assertEquals(o.data.history.at(-1).by, 'customer')
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.event, bell.data.orderId, bell.data.audience], ['team_customer_paid', 'o1', 'staff'])
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'matched')
  assertEquals(msg.slipCheck.orderCode, 'OR-111126-000010')
})

Deno.test('สลิปเดิมส่งซ้ำ → ไม่แนบซ้ำ (ซ้ำทั้งระบบ) และแจ้งพนักงาน', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  const bytes = await slipScreenshot(SLIP)
  assertEquals(await runCheck(sb, bytes, autoOpts()), 'matched')
  assertEquals(await runCheck(sb, bytes, autoOpts()), 'duplicate')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'duplicate')
})

Deno.test('รหัสอ้างอิงชี้ออร์เดอร์ที่ตรง (ไม่ใช่ออร์เดอร์ที่คุยล่าสุด) → แนบเข้าเฉพาะออร์เดอร์ที่รหัสตรง', async () => {
  const sb = fakeSb({
    chats: [chatWith([staffRef('o1'), staffRef('o0'), { id: 'x', from: 'customer', orderId: null }, slipMsg])],
    orders: [{ ...order(), id: 'o0', code: 'OR-111126-000009' }, orderQr()],
    kv: AUTO_KV(),
  })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders.find((o: any) => o.id === 'o0').data.payments.length, 0)
  assertEquals(sb.T.punpang_orders.find((o: any) => o.id === 'o1').data.payments.length, 1)
})

Deno.test('ไม่มีออร์เดอร์อ้างอิงในแชท → ไม่แนบ แจ้งพนักงานให้ผูกเอง', async () => {
  const sb = fakeSb({ chats: [chatWith([{ id: 'x', from: 'customer', orderId: null }, slipMsg])], orders: [order()] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'no_order')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  assertEquals(sb.T.punpang_records.some((r: any) => r.data.event === 'slip_check'), true)
})

Deno.test('ออร์เดอร์มียอดรอตรวจอยู่แล้ว / ยกเลิก → ไม่แนบ · ออร์เดอร์ชำระครบ → ยอดเกินยอดค้างจึงส่งพนักงาน', async () => {
  const cases: Array<[any, string, number]> = [
    [order({ payments: [{ status: 'confirmed', amount: 540 }] }), 'manual', 1],
    [order({ payments: [{ status: 'reported', customerSubmitted: true, amount: 540 }, reqPayment()] }), 'pending_exists', 0],
    [{ ...orderQr(), status: 'cancelled' }, 'order_inactive', 0],
  ]
  for (const [o, want, uploads] of cases) {
    const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [o], kv: AUTO_KV() })
    assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), want)
    assertEquals(sb.T.punpang_orders[0].data.payments.length, o.data.payments.length)
    assertEquals(sb.calls.uploads, uploads)
  }
})

Deno.test('ชนกันตอนเขียนออร์เดอร์ (CAS) → อ่านใหม่แล้วแนบได้ครั้งเดียว ใช้เลขรายการที่ขอ QR ไว้ (ไม่ออกเลข PAY)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  sb.hooks.beforeOrderUpdate = (rows) => { rows[0].updated_at = 'changed-by-staff' }
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  assertEquals(sb.calls.rpc, 0)
  assertEquals(sb.calls.uploads, 1)
})

Deno.test('อัปโหลดไฟล์สลิปไม่สำเร็จ → ไม่แตะออร์เดอร์ และแจ้งให้ส่งใหม่', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  sb.hooks.uploadFail = true
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'upload_failed')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  assertEquals(sb.T.punpang_orders[0].status, 'awaiting_payment')
})

Deno.test('ปิดการตรวจสลิปใน config (enabled=false) → ไม่ทำอะไรเลย', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvSlip(false)] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'disabled')
  assertEquals(sb.calls.uploads, 0)
  assertEquals(sb.T.punpang_records.length, 0)
})

Deno.test('QR พร้อมเพย์ของร้าน / รูปไม่มี QR → ไม่ใช่สลิป ไม่แตะข้อมูล', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  assertEquals(await runCheck(sb, await qrPlain(PROMPTPAY_540)), 'no_slip')
  const blank = new PNG({ width: 400, height: 400 }); blank.data.fill(255)
  assertEquals(await runCheck(sb, new Uint8Array(PNG.sync.write(blank))), 'no_slip')
  assertEquals(sb.calls.uploads + sb.T.punpang_records.length, 0)
})

Deno.test('ออร์เดอร์ถูกแก้ทุกครั้งที่เขียน (ชนซ้ำจนหมดรอบ) → busy: ไม่แนบ ลบไฟล์ที่อัปโหลดไว้ แจ้งพนักงานและติดป้ายในแชท', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  let n = 0
  const conflict = (rows: any[]) => { rows[0].updated_at = `changed-${++n}`; sb.hooks.beforeOrderUpdate = conflict } // ชนซ้ำทุกครั้งที่เขียน
  sb.hooks.beforeOrderUpdate = conflict
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'busy')
  assertEquals(n, 3)
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  assertEquals([sb.calls.uploads, sb.calls.removes, sb.calls.rpc, sb.files.size], [1, 1, 0, 0])
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.event, bell.data.orderId, bell.data.chatId], ['slip_check', 'o1', 'c1'])
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'busy')
})

Deno.test('ไม่มีแถวแชท → chat_missing', async () => {
  const sb = fakeSb({ chats: [], orders: [order()] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'chat_missing')
})

Deno.test('เลขอ้างอิงซ้ำกับรายการที่ยังไม่ยกเลิกของออร์เดอร์อื่น → ไม่แนบซ้ำ และบอกเลขออร์เดอร์ที่ใช้เลขนี้อยู่', async () => {
  const other = { ...order(), id: 'o0', code: 'OR-111126-000009', data: { items: [], history: [], payments: [{ id: 'pz', code: 'PAY-111126-00000', status: 'confirmed', amount: 100, ref: 'A1B2C3D4E5F6G7H8' }] } }
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [other, order()] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'duplicate')
  assertEquals(sb.T.punpang_orders.find((o: any) => o.id === 'o1').data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.status, msg.slipCheck.orderCode], ['duplicate', 'OR-111126-000009'])
})

Deno.test('เลขอ้างอิงที่เคยอยู่ในรายการที่ยกเลิกแล้ว → แนบใหม่ได้', async () => {
  const cancelled = order({ payments: [{ id: 'px', code: 'PAY-111126-00000', status: 'cancelled', amount: 540, ref: 'A1B2C3D4E5F6G7H8' }, reqPayment()] })
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [cancelled], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 2)
})

Deno.test('สลิป QR ที่ไม่มีรหัสอ้างอิงร้านค้า → ไม่ผูกอัตโนมัติ ส่งพนักงาน และเก็บธนาคาร/เลขอ้างอิงจาก QR ไว้ในป้าย', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.bankCode, msg.slipCheck.bankName, msg.slipCheck.ref, msg.slipCheck.orderId], ['004', 'ธนาคารกสิกรไทย', 'A1B2C3D4E5F6G7H8', 'o1'])
})

Deno.test('ตั้งค่า mode ที่ไม่รู้จัก หรือไม่มี mode → ใช้โหมดอัตโนมัติเหมือนเดิม', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: [slipKv({ enabled: true, mode: 'whatever', ocr: { wai: true } }), shopKv] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
})

// ---- โหมดแมนนวล: เก็บสลิปให้พนักงานผูกเองในแชท · ไม่แนบ ไม่สร้างรายการชำระ ไม่แตะออร์เดอร์ ----
const kvMode = (mode: string, enabled = true) => ({ collection: 'config', id: 'slipQr', data: { v: { enabled, mode } } })
const RAND32 = 'a'.repeat(32)

Deno.test('โหมดแมนนวล: เก็บรูปไว้ในโฟลเดอร์ manual และติดป้าย "รอรับชำระ" พร้อมออร์เดอร์ที่แนะนำ โดยไม่แตะออร์เดอร์', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvMode('manual')] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'manual')
  const o = sb.T.punpang_orders[0]
  assertEquals([o.status, o.data.payments.length, o.data.history.length], ['awaiting_payment', 0, 0])
  assertEquals(sb.files.has(`manual/c1/${RAND32}.png`), true)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(
    [msg.slipCheck.status, msg.slipCheck.orderId, msg.slipCheck.orderCode, msg.slipCheck.ref, msg.slipCheck.bankCode, msg.slipCheck.slipRef],
    ['manual', 'o1', 'OR-111126-000010', 'A1B2C3D4E5F6G7H8', '004', `r2://private/manual/c1/${RAND32}.png`],
  )
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.event, bell.data.orderId, bell.data.audience], ['slip_check', 'o1', 'staff'])
})

Deno.test('โหมดแมนนวล: ไม่มีออร์เดอร์ที่คุยล่าสุดก็เก็บสลิปไว้ให้เลือกในแชทได้ (ไม่มีออร์เดอร์แนะนำ)', async () => {
  const sb = fakeSb({ chats: [chatWith([slipMsg])], orders: [order()], kv: [kvMode('manual')] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'manual')
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.status, msg.slipCheck.orderId, msg.slipCheck.orderCode], ['manual', undefined, undefined])
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.event, bell.data.orderId], ['slip_check', null])
})

Deno.test('โหมดแมนนวล: สลิปที่แนบไว้แล้ว → ยังตอบซ้ำ ไม่เก็บรูปซ้ำ', async () => {
  const attached = order({ payments: [{ id: 'px', code: 'PAY-111126-00000', status: 'reported', amount: 540, ref: 'A1B2C3D4E5F6G7H8' }] })
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [attached], kv: [kvMode('manual')] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'duplicate')
  assertEquals(sb.calls.uploads, 0)
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
})

Deno.test('โหมดแมนนวล: อัปโหลดไฟล์ไม่สำเร็จ → บอกให้ส่งใหม่ ไม่เก็บป้ายที่ใช้ไม่ได้', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvMode('manual')] })
  sb.hooks.uploadFail = true
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'upload_failed')
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'upload_failed')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
})

Deno.test('โหมดแมนนวลไม่ผูกอัตโนมัติ แม้ครบ 4 ข้อ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [slipKv({ enabled: true, mode: 'manual', ocr: { wai: true } }), shopKv] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
})

Deno.test('ตัวกันเลขอ้างอิงซ้ำระดับฐานข้อมูล (23505) ตอนแนบ → ซ้ำ ไม่แนบ ลบไฟล์ที่อัปโหลด และไม่แตะออร์เดอร์', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  sb.hooks.orderUpdateError = { code: '23505', message: 'punpang_duplicate_ref: A1B2C3D4E5F6G7H8' }
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'duplicate')
  assertEquals([sb.calls.uploads, sb.calls.removes, sb.files.size], [1, 1, 0])
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'duplicate')
})

Deno.test('ข้อผิดพลาดอื่นตอนแนบ (ไม่ใช่ 23505) → error ลบไฟล์ที่อัปโหลด ไม่แตะออร์เดอร์', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_KV() })
  sb.hooks.orderUpdateError = { code: '08006', message: 'connection failure' }
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'error')
  assertEquals([sb.calls.uploads, sb.calls.removes, sb.files.size], [1, 1, 0])
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
})

// ---- อ่านยอดและวัน-เวลาจากภาพ (ตั้งค่า ocr.claude) ----
Deno.test('OCR (Claude) ในโหมดอัตโนมัติ ครบ 5 ข้อ → ใช้ยอดและวัน-เวลาที่อ่านจากภาพ และผูกอัตโนมัติ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ payments: [reqPayment({ amount: 178, requested: 178 })] })], kv: [kvOcr('auto', true), shopKv] })
  const read = async () => fieldsOk({ amount: 178, paidAt: '2026-11-11T14:48' })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: read }), 'matched')
  const p = sb.T.punpang_orders[0].data.payments[0]
  assertEquals([p.amount, p.paidAt, p.status], [178, '2026-11-11T14:48', 'reported'])
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('อ่านจากภาพสลิป'), true)
})

Deno.test('OCR (Claude) อ่านไม่ได้ → ไม่ผูกอัตโนมัติ ส่งพนักงาน (ไม่ใช้ยอดคงค้างแทน)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('auto', true), shopKv] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: ocrFields({ amount: null, paidAt: null }) }), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
})

Deno.test('OCR ปิดใน config → ไม่เรียกโมเดลเลย และไม่ผูกอัตโนมัติ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('auto', false)] })
  let called = false
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: async () => { called = true; return fieldsOk() } }), 'manual')
  assertEquals(called, false)
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
})

Deno.test('OCR เปิดแต่ไม่มีคีย์ → ไม่เรียกโมเดล', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('auto', true)] })
  let called = false
  await runCheck(sb, await slipScreenshot(SLIP), { ocrRead: async () => { called = true; return null } })
  assertEquals(called, false)
})

Deno.test('OCR เปิดในโหมดแมนนวล: แนบยอดที่อ่านได้ไว้ในป้ายและกระดิ่ง ไม่สร้างรายการชำระ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('manual', true)] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: ocrFields({ amount: 178, paidAt: '2026-11-11T14:48' }) }), 'manual')
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.ocrAmount, msg.slipCheck.ocrPaidAt], [178, '2026-11-11T14:48'])
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('178.00'), true)
})

Deno.test('โหมดแมนนวล: สลิปที่เคยเก็บเป็นป้ายในแชทแล้ว → ซ้ำ ไม่ส่ง AI และไม่เก็บรูปซ้ำ', async () => {
  const prior = { id: 'm0', from: 'customer', kind: 'text', text: '', slipCheck: { status: 'manual', slipKey: '004:A1B2C3D4E5F6G7H8', slipRef: 'sb://punpang-slips/manual/c1/x.png' } }
  const sb = fakeSb({ chats: [chatWith([prior, staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('manual', true)] })
  let called = false
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: async () => { called = true; return null } }), 'duplicate')
  assertEquals(called, false)
  assertEquals(sb.calls.uploads, 0)
})

Deno.test('สลิปใหม่ (ยังไม่เคยเก็บในแชทใด) → ส่ง AI ตามปกติ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcr('manual', true)] })
  let called = false
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrKey: 'k', ocrRead: async () => { called = true; return null } }), 'manual')
  assertEquals(called, true)
})

Deno.test('ลำดับตัวอ่าน: Workers AI → ระบบเดิม (Claude) · ตัวแรกที่ได้ยอดหรือวัน-เวลาจะหยุด', async () => {
  const calls: string[] = []
  const none = (name: string) => async () => { calls.push(name); return null }
  const empty = (name: string) => async () => { calls.push(name); return { amount: null, paidAt: null, receiverName: null, receiverAccount: null } }
  const hit = (name: string) => async () => { calls.push(name); return { amount: 178, paidAt: '2026-11-11T14:48', receiverName: null, receiverAccount: null } }
  const wai = { accountId: 'a', token: 't', model: '' }
  const opts = (ocrReadBy: any, ocrWai: any = wai) => ({ ocrKey: 'k', ocrWai, ocrReadBy })
  // Workers AI ตอบผลว่าง → ไปลองระบบเดิม (Claude) ที่ได้ผล (ยังไม่ครบ 4 ข้อ จึงส่งพนักงาน)
  const sb1 = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true, claude: true })] })
  assertEquals(await runCheck(sb1, await slipScreenshot(SLIP), opts({ wai: empty('wai'), claude: hit('claude') })), 'manual')
  assertEquals(calls, ['wai', 'claude'])
  // Workers AI ได้ผล → ไม่เรียกระบบเดิม
  calls.length = 0
  const sb2 = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true, claude: true })] })
  assertEquals(await runCheck(sb2, await slipScreenshot(SLIP), opts({ wai: hit('wai'), claude: none('claude') })), 'manual')
  assertEquals(calls, ['wai'])
  // ปิด Workers AI → ใช้ระบบเดิม (Claude) เท่านั้น
  calls.length = 0
  const sb3 = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: false, claude: true })] })
  await runCheck(sb3, await slipScreenshot(SLIP), opts({ wai: hit('wai'), claude: hit('claude') }))
  assertEquals(calls, ['claude'])
  // ไม่ได้ตั้งค่า Cloudflare → ข้าม Workers AI ไปใช้ระบบเดิม
  calls.length = 0
  const sb4 = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true, claude: true })] })
  await runCheck(sb4, await slipScreenshot(SLIP), opts({ wai: hit('wai'), claude: hit('claude') }, { accountId: '', token: '', model: '' }))
  assertEquals(calls, ['claude'])
})

Deno.test('ขั้นตอน: รูปที่ไม่ใช่สลิปไม่ถูกส่งต่อให้โมเดล แม้เปิด Workers AI และ Claude ครบ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true, claude: true })] })
  const called: string[] = []
  const reader = (name: string) => async () => { called.push(name); return { amount: 1, paidAt: null, receiverName: null, receiverAccount: null } }
  const opts = { ocrKey: 'k', ocrWai: { accountId: 'a', token: 't', model: '' }, ocrReadBy: { wai: reader('wai'), claude: reader('claude') } }
  assertEquals(await runCheck(sb, await qrPlain(PROMPTPAY_540), opts), 'no_slip')
  const blank = new PNG({ width: 400, height: 400 }); blank.data.fill(255)
  assertEquals(await runCheck(sb, new Uint8Array(PNG.sync.write(blank)), opts), 'no_slip')
  assertEquals(called, [])
})

Deno.test('ป้ายสลิปยังแนบได้แม้แชทถูกเขียนชนกันหลายครั้ง (ลองเขียนซ้ำจนสำเร็จ)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  sb.hooks.chatConflicts = 5
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_chats[0].data.messages.find((x: any) => x.id === 'm1')?.slipCheck?.status, 'matched')
})

Deno.test('แชทถูกเขียนชนกันเกินจำนวนรอบ → ไม่มีป้าย แต่การรับสลิปยังสำเร็จ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  sb.hooks.chatConflicts = 50
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_chats[0].data.messages.find((x: any) => x.id === 'm1')?.slipCheck, undefined)
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
})

// ---- เก็บผลอ่านไว้ใช้ซ้ำ และเก็บสลิปที่อ่านไม่ผ่านไว้ชุดเทรน ----
Deno.test('อ่านได้ → เก็บค่าที่อ่านไว้ตามเลขอ้างอิง', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  await runCheck(sb, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy: { wai: async () => ({ amount: 178, paidAt: '2026-11-11T14:48', receiverName: null, receiverAccount: null }) } })
  assertEquals(sb.T.punpang_records.filter((r: any) => r.collection === 'slipRead').length, 1)
})

Deno.test('เคยอ่านเลขอ้างอิงนี้แล้ว → ใช้ค่าที่เก็บไว้ ไม่เรียกโมเดลซ้ำ', async () => {
  const first = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  await runCheck(first, await slipScreenshot(SLIP), autoOpts({ amount: 178, paidAt: '2026-11-11T14:48' }))
  const second = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  second.T.punpang_records.push(...first.T.punpang_records.filter((r: any) => r.collection === 'slipRead'))
  let calls = 0
  assertEquals(await runCheck(second, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy: { wai: async () => { calls++; return null } } }), 'matched')
  assertEquals(calls, 0)
  const p = second.T.punpang_orders[0].data.payments[0]
  assertEquals([p.amount, p.paidAt], [178, '2026-11-11T14:48'])
})

Deno.test('อ่านไม่ครบ (ตัวอ่านตอบว่างทั้งหมด) → เก็บรูปไว้ชุดเทรนแยกจากสลิปของออร์เดอร์ และส่งพนักงาน (ไม่ผูกอัตโนมัติ)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  const blank = { amount: null, paidAt: null, receiverName: null, receiverAccount: null }
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy: { wai: async () => blank } }), 'manual')
  assertEquals(sb.T.punpang_records.filter((r: any) => r.collection === 'slipTrain').length, 1)
  assertEquals([...sb.files.keys()].some((k: string) => k.startsWith('train/')), true)
  assertEquals(sb.T.punpang_records.filter((r: any) => r.collection === 'slipRead').length, 1)
})

Deno.test('ตัวอ่านผิดพลาด (ไม่ตอบ) → ไม่จำผลและไม่เก็บชุดเทรน รอบหน้าลองอ่านใหม่', async () => {
  let calls = 0
  const ocrReadBy = { wai: async () => { calls++; return null } }
  const first = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  await runCheck(first, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy })
  assertEquals(first.T.punpang_records.filter((r: any) => r.collection === 'slipRead' || r.collection === 'slipTrain').length, 0)
  const second = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  await runCheck(second, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy })
  assertEquals(calls, 2)
})

Deno.test('อ่านครบ (ยอด วัน-เวลา เลขบัญชีผู้รับ) → จำผล และไม่เก็บชุดเทรน', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  await runCheck(sb, await slipScreenshot(SLIP), { ocrWai: WAI_CRED, ocrReadBy: { wai: async () => ({ amount: 178, paidAt: '2026-11-11T14:48', receiverName: null, receiverAccount: 'xxx-x-x8154-x' }) } })
  assertEquals(sb.T.punpang_records.filter((r: any) => r.collection === 'slipRead').length, 1)
  assertEquals(sb.T.punpang_records.filter((r: any) => r.collection === 'slipTrain').length, 0)
})

// ---- เงื่อนไขผูกอัตโนมัติที่ไม่ผ่าน: ต้องส่งให้พนักงาน พร้อมเหตุผลในกระดิ่ง ----
Deno.test('รหัสอ้างอิงบนสลิปไม่ตรงกับออร์เดอร์ใด → ไม่ผูกอัตโนมัติ ส่งพนักงาน แนะนำออร์เดอร์ที่คุยล่าสุด และแจ้งเหตุผล', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ shopRef: 'POS123927229' })), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.orderId, 'o1')
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('✗ รหัสอ้างอิงไม่ตรงกับออร์เดอร์นี้'), true)
})

Deno.test('ไม่มีรหัสอ้างอิงร้านค้าในสลิป → ไม่ผูกอัตโนมัติ แม้ยอด วัน-เวลา และรหัสร้านค้าถูกต้อง', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ shopRef: undefined })), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('– ไม่มีรหัสอ้างอิงร้านค้าในสลิป'), true)
})

Deno.test('ยังไม่ได้ตั้งรหัสร้านค้าในหน้าตั้งค่า → ไม่ผูกอัตโนมัติ (ตรวจรหัสร้านค้าไม่ได้)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [kvOcrAll({ wai: true })] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('– ยังไม่ได้ตั้งรหัสร้านค้า'), true)
})

Deno.test('วัน-เวลาโอนเท่ากับเวลาสร้างออร์เดอร์ (ถึงนาที) → ไม่ผ่าน ไม่ผูกอัตโนมัติ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ paidAt: '2026-11-11T09:00' })), 'manual')
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.checks.find((c: any) => c.key === 'paidAt').ok, false)
})

Deno.test('ยอดเท่ากับยอดค้างพอดี → ผ่าน (ไม่เกินยอดค้าง)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: AUTO_KV() })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ amount: 540 })), 'matched')
})

// ---- ยืนยันสลิปอัตโนมัติ: ครบ 4 ข้อ + นัดรับห่างอย่างน้อยตามที่ตั้ง → ยืนยันชำระทันที (ปิดไว้ = รอพนักงานยืนยัน) ----
const AUTO_CONFIRM_KV = (days = 3, enabled = true) => [slipKv({ enabled: true, mode: 'auto', ocr: { wai: true }, autoConfirm: { enabled, days } }), shopKv]

Deno.test('ยืนยันอัตโนมัติ: เปิด และนัดรับห่างอย่างน้อยเท่าที่ตั้ง → ยืนยันชำระ ออร์เดอร์เป็นยืนยันชำระแล้ว และแจ้งทีม', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-14T10:00', payments: [reqPayment()] })], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals(o.status, 'payment_confirmed')
  const p = o.data.payments[0]
  assertEquals([p.status, p.amount, p.confirmedBy, p.customerSubmitted], ['confirmed', 540, 'auto', true])
  assertEquals(o.data.history.at(-1).by, 'auto')
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.title, bell.data.text.includes('ยืนยันอัตโนมัติแล้ว'), bell.data.text.includes('ยังไม่ได้ตรวจกับธนาคาร')], ['ยืนยันชำระอัตโนมัติแล้ว', true, true])
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals([msg.slipCheck.status, msg.slipCheck.autoConfirmed], ['matched', true])
})

Deno.test('ยืนยันอัตโนมัติ: นัดรับน้อยกว่าที่ตั้ง → ยังรอพนักงานยืนยัน (งวดรอตรวจ ออร์เดอร์แจ้งยอดแล้ว)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-13T10:00', payments: [reqPayment()] })], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals([o.status, o.data.payments[0].status, o.data.payments[0].confirmedBy], ['payment_reported', 'reported', null])
  assertEquals(sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1').slipCheck.autoConfirmed, undefined)
})

Deno.test('ยืนยันอัตโนมัติปิดอยู่ → รอพนักงานยืนยันเหมือนเดิม แม้นัดรับห่างพอ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-14T10:00', payments: [reqPayment()] })], kv: AUTO_CONFIRM_KV(3, false) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals([sb.T.punpang_orders[0].status, sb.T.punpang_orders[0].data.payments[0].status], ['payment_reported', 'reported'])
})

Deno.test('ยืนยันอัตโนมัติ: ออร์เดอร์ไม่มีวันนัดรับ → รอพนักงานยืนยัน', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [orderQr()], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments[0].status, 'reported')
})

Deno.test('ยืนยันอัตโนมัติ: ตั้ง 0 วัน → นัดรับวันนี้ยืนยันได้ · นัดวันที่ผ่านไปแล้วไม่ยืนยัน', async () => {
  const sbToday = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-11T18:00', payments: [reqPayment()] })], kv: AUTO_CONFIRM_KV(0) })
  assertEquals(await runCheck(sbToday, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sbToday.T.punpang_orders[0].data.payments[0].status, 'confirmed')
  const sbPast = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-10T18:00', payments: [reqPayment()] })], kv: AUTO_CONFIRM_KV(0) })
  assertEquals(await runCheck(sbPast, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sbPast.T.punpang_orders[0].data.payments[0].status, 'reported')
})

Deno.test('ยืนยันอัตโนมัติ: ยอดบางส่วน → ยืนยันเฉพาะยอดนั้น ออร์เดอร์ยังค้างส่วนที่เหลือ', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-14T10:00', payments: [reqPayment({ amount: 200, requested: 200 })] })], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts({ amount: 200 })), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals([o.status, o.data.payments[0].status, o.data.payments[0].amount], ['payment_confirmed', 'confirmed', 200])
})

Deno.test('ยืนยันอัตโนมัติ: ยกเลิกยอดที่ร้านแจ้งเดิมที่ยังรออยู่ของออร์เดอร์นั้น และบันทึกประวัติ/กระดิ่ง', async () => {
  const staff = { id: 'ps1', code: 'PAY-111126-00000', status: 'reported', requested: 540, amount: 540, method: 'โอนเงิน', dueAt: '', source: 'staff', customerSubmitted: false }
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [{ ...order({ pickupAt: '2026-11-14T10:00', payments: [staff, reqPayment()] }), status: 'payment_reported' }], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals([o.status, o.data.payments[0].status, o.data.payments[0].cancelledBy, o.data.payments[1].status], ['payment_confirmed', 'cancelled', 'auto', 'confirmed'])
  assertEquals(o.data.history.some((h: any) => h.text.includes('ยกเลิกยอดที่แจ้งเดิม 1 รายการ')), true)
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals(bell.data.text.includes('ยกเลิกยอดที่แจ้งเดิม 1 รายการ'), true)
})

Deno.test('ยืนยันอัตโนมัติปิดอยู่ → ยอดที่ร้านแจ้งเดิมยังอยู่ ไม่ถูกยกเลิก', async () => {
  const staff = { id: 'ps1', code: 'PAY-111126-00000', status: 'reported', requested: 540, amount: 540, method: 'โอนเงิน', dueAt: '', source: 'staff', customerSubmitted: false }
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [{ ...order({ pickupAt: '2026-11-14T10:00', payments: [staff, reqPayment()] }), status: 'payment_reported' }], kv: AUTO_CONFIRM_KV(3, false) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP), autoOpts()), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.map((p: any) => p.status), ['reported', 'reported'])
})

Deno.test('ยืนยันอัตโนมัติ: อ่านภาพไม่ครบ 4 ข้อ → ไม่ผูกและไม่ยืนยัน (ส่งพนักงาน)', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order({ pickupAt: '2026-11-14T10:00' })], kv: AUTO_CONFIRM_KV(3) })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'manual')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
})
