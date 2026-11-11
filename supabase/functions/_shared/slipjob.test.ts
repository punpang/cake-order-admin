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
  const hooks: { beforeOrderUpdate: null | ((rows: any[]) => void); uploadFail: boolean } = { beforeOrderUpdate: null, uploadFail: false }
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
      if (q.op === 'update' && table === 'punpang_orders' && hooks.beforeOrderUpdate) { const h = hooks.beforeOrderUpdate; hooks.beforeOrderUpdate = null; h(list) }
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

const order = (over: Record<string, unknown> = {}) => ({
  id: 'o1', code: 'OR-111126-000010', status: 'awaiting_payment', customer_id: 'cu1', updated_at: 't0',
  data: { items: [{ unitPrice: 540, qty: 1 }], payments: [], history: [], ...over },
})
const chatWith = (messages: any[]) => ({ id: 'c1', channel: 'facebook', external_id: '123', customer_id: 'cu1', updated_at: 'v0', data: { profileName: 'ลูกค้าทดสอบ', messages } })
const slipMsg = { id: 'm1', from: 'customer', kind: 'text', text: '', fbMid: 'mid1', attachments: [{ type: 'image', path: 'fb/123/mid1-0.png' }], by: 'ลูกค้า' }
const staffRef = (orderId: string) => ({ id: 's1', from: 'staff', kind: 'text', text: 'สรุปออร์เดอร์ให้แล้วค่ะ', orderId, by: 'พนักงาน' })
const kvSlip = (enabled: boolean) => ({ collection: 'config', id: 'slipQr', data: { v: { enabled } } })
const runCheck = (sb: any, bytes: Uint8Array, extra: Record<string, unknown> = {}) => checkSlipImage({ sb, chatId: 'c1', msgId: 'm1', bytes, nowMs: NOW, rand: (n) => 'a'.repeat(n * 2).slice(0, n * 2), ...extra })

Deno.test('สลิปในแชท + ออร์เดอร์ที่คุยล่าสุด → จับคู่ เก็บยอดรอตรวจ แจ้งกระดิ่ง และติดป้ายในแชท', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()], kv: [] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  const o = sb.T.punpang_orders[0]
  assertEquals(o.status, 'payment_reported')
  assertEquals(o.data.payments.length, 1)
  const p = o.data.payments[0]
  assertEquals([p.code, p.amount, p.status, p.source, p.customerSubmitted], ['PAY-111126-00001', 540, 'reported', 'customer', true])
  assertEquals(p.slipKey, '004:A1B2C3D4E5F6G7H8')
  assertEquals(p.slip, 'sb://punpang-slips/o1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
  assertEquals(sb.files.has('punpang-slips/o1/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png'), true)
  assertEquals(o.data.history.at(-1).by, 'customer')
  const bell = sb.T.punpang_records.find((r: any) => r.collection === 'bell')
  assertEquals([bell.data.event, bell.data.orderId, bell.data.audience], ['team_customer_paid', 'o1', 'staff'])
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'matched')
  assertEquals(msg.slipCheck.orderCode, 'OR-111126-000010')
})

Deno.test('สลิปเดิมส่งซ้ำ → ไม่แนบซ้ำ (ซ้ำทั้งระบบ) และแจ้งพนักงาน', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  const bytes = await slipScreenshot(SLIP)
  assertEquals(await runCheck(sb, bytes), 'matched')
  assertEquals(await runCheck(sb, bytes), 'duplicate')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  const msg = sb.T.punpang_chats[0].data.messages.find((m: any) => m.id === 'm1')
  assertEquals(msg.slipCheck.status, 'duplicate')
})

Deno.test('ออร์เดอร์ที่คุยล่าสุดคือรายการใหม่กว่า: แนบเข้าเฉพาะออร์เดอร์นั้น', async () => {
  const sb = fakeSb({
    chats: [chatWith([staffRef('o0'), staffRef('o1'), { id: 'x', from: 'customer', orderId: null }, slipMsg])],
    orders: [{ ...order(), id: 'o0', code: 'OR-111126-000009' }, order()],
  })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  assertEquals(sb.T.punpang_orders.find((o: any) => o.id === 'o0').data.payments.length, 0)
  assertEquals(sb.T.punpang_orders.find((o: any) => o.id === 'o1').data.payments.length, 1)
})

Deno.test('ไม่มีออร์เดอร์อ้างอิงในแชท → ไม่แนบ แจ้งพนักงานให้ผูกเอง', async () => {
  const sb = fakeSb({ chats: [chatWith([{ id: 'x', from: 'customer', orderId: null }, slipMsg])], orders: [order()] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'no_order')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  assertEquals(sb.T.punpang_records.some((r: any) => r.data.event === 'slip_check'), true)
})

Deno.test('ออร์เดอร์ชำระครบ / ยกเลิก / มียอดรอตรวจอยู่แล้ว → ไม่แนบ', async () => {
  const cases: Array<[any, string]> = [
    [order({ payments: [{ status: 'confirmed', amount: 540 }] }), 'order_paid'],
    [order({ payments: [{ status: 'reported', customerSubmitted: true, amount: 540 }] }), 'pending_exists'],
    [{ ...order(), status: 'cancelled' }, 'order_inactive'],
  ]
  for (const [o, want] of cases) {
    const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [o] })
    assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), want)
    assertEquals(sb.T.punpang_orders[0].data.payments.length, o.data.payments.length)
    assertEquals(sb.calls.uploads, 0)
  }
})

Deno.test('ชนกันตอนเขียนออร์เดอร์ (CAS) → อ่านใหม่แล้วแนบได้ครั้งเดียว ออกเลข PAY ครั้งเดียว', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  sb.hooks.beforeOrderUpdate = (rows) => { rows[0].updated_at = 'changed-by-staff' }
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 1)
  assertEquals(sb.calls.rpc, 1)
  assertEquals(sb.calls.uploads, 1)
})

Deno.test('อัปโหลดไฟล์สลิปไม่สำเร็จ → ไม่แตะออร์เดอร์ และแจ้งให้ส่งใหม่', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  sb.hooks.uploadFail = true
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'upload_failed')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
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
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [order()] })
  let n = 0
  const conflict = (rows: any[]) => { rows[0].updated_at = `changed-${++n}`; sb.hooks.beforeOrderUpdate = conflict } // ชนซ้ำทุกครั้งที่เขียน
  sb.hooks.beforeOrderUpdate = conflict
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'busy')
  assertEquals(n, 3)
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 0)
  assertEquals([sb.calls.uploads, sb.calls.removes, sb.calls.rpc, sb.files.size], [1, 1, 1, 0])
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
  const cancelled = order({ payments: [{ id: 'px', code: 'PAY-111126-00000', status: 'cancelled', amount: 540, ref: 'A1B2C3D4E5F6G7H8' }] })
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), slipMsg])], orders: [cancelled] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments.length, 2)
})

Deno.test('เวลาชำระของสลิปในแชท = เวลาที่ลูกค้าส่งข้อความ (เวลาไทย) และเก็บธนาคาร/เลขอ้างอิงจาก QR', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), { ...slipMsg, at: '2026-11-11T02:30:00.000Z' }])], orders: [order({ createdAt: '2026-11-11T08:00' })] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  const p = sb.T.punpang_orders[0].data.payments[0]
  assertEquals([p.paidAt, p.bankCode, p.bankName, p.ref, p.refSource], ['2026-11-11T09:30', '004', 'ธนาคารกสิกรไทย', 'A1B2C3D4E5F6G7H8', 'qr'])
})

Deno.test('ข้อความสลิปก่อนวันสร้างออร์เดอร์ → ใช้เวลาปัจจุบันแทน', async () => {
  const sb = fakeSb({ chats: [chatWith([staffRef('o1'), { ...slipMsg, at: '2026-11-11T02:30:00.000Z' }])], orders: [order({ createdAt: '2026-11-11T11:00' })] })
  assertEquals(await runCheck(sb, await slipScreenshot(SLIP)), 'matched')
  assertEquals(sb.T.punpang_orders[0].data.payments[0].paidAt, '2026-11-11T10:00')
})
