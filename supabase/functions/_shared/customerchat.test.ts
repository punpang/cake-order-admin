// ทดสอบส่วนที่เป็นฟังก์ชันล้วนของแชทลูกค้า: ตรวจความยาวข้อความ และข้อความที่ลูกค้าเห็นไม่มีข้อมูลภายใน
import { assertEquals } from 'jsr:@std/assert@1'
import { CHAT_TEXT_MAX, cleanChatText, cleanReplyTo, customerCardView, customerOrderView, legacyOrderCardOf, customerQuoteView, isCustomerVisible, replySnippetOf, toCustomerView } from './customerchat.ts'

Deno.test('ข้อความว่างหรือเกินความยาวไม่ผ่าน · ตัดช่องว่างหัวท้ายแล้วผ่าน', () => {
  assertEquals(cleanChatText(''), null)
  assertEquals(cleanChatText('   \n '), null)
  assertEquals(cleanChatText('a'.repeat(CHAT_TEXT_MAX + 1)), null)
  assertEquals(cleanChatText('  สวัสดีค่ะ  '), 'สวัสดีค่ะ')
  assertEquals(cleanChatText('บรรทัด 1\r\nบรรทัด 2'), 'บรรทัด 1\nบรรทัด 2')
})

Deno.test('ข้อความที่ลูกค้าเห็นมีเฉพาะ id ผู้ส่ง ข้อความ และเวลา', () => {
  const v = toCustomerView({ id: 'cm1', from: 'staff', text: 'รับทราบค่ะ', at: '2026-11-14T10:00:00.000Z', by: 'owner', orderId: 'o1', delivery: 'simulated' })
  assertEquals(v, { id: 'cm1', from: 'staff', text: 'รับทราบค่ะ', at: '2026-11-14T10:00:00.000Z' })
})

Deno.test('ใบเสนอในแชทลูกค้า: แสดงเฉพาะการ์ดที่ร้านเก็บไว้ · รูปเฉพาะ https · ใบเก่าไม่มีข้อมูลภายใน', () => {
  const v = customerQuoteView({
    id: 'cm2', from: 'staff', kind: 'quote', quoteId: 'qt1', at: '2026-11-16T12:58:09.252Z', by: 'owner', cost: 120, profit: 80,
    cardText: 'รายการสินค้า\n• เค้ก × 1', card: { kind: 'quote', title: 'ใบเสนอราคา QT-1', subtitle: 'ยอดรวม 30.00', image: 'http://insecure.example/x.png' },
  })
  assertEquals(v, {
    id: 'cm2', from: 'staff', kind: 'quote', text: 'รายการสินค้า\n• เค้ก × 1', at: '2026-11-16T12:58:09.252Z', photos: [],
    card: { title: 'ใบเสนอราคา QT-1', subtitle: 'ยอดรวม 30.00', image: null },
  })
  const old = customerQuoteView({ id: 'cm3', from: 'staff', kind: 'quote', quoteId: 'qt0', at: '2026-11-16T12:00:00.000Z', cost: 99 })
  assertEquals(old, { id: 'cm3', from: 'staff', kind: 'quote', text: 'ร้านส่งใบเสนอราคาให้แล้ว', at: '2026-11-16T12:00:00.000Z', photos: [], card: null })
})

Deno.test('การตอบกลับ: รหัสต้องปลอดภัยและอ้างถึงได้เฉพาะข้อความที่ลูกค้าเห็น', () => {
  assertEquals(cleanReplyTo('cm_abc-1'), 'cm_abc-1')
  assertEquals(cleanReplyTo('../x'), null)
  assertEquals(cleanReplyTo(''), null)
  assertEquals(cleanReplyTo(123), null)
  const all = [
    { id: 'a1', from: 'customer', kind: 'text', text: 'สั่งเค้กวันเสาร์ได้ไหม' },
    { id: 'a2', from: 'staff', kind: 'text', text: 'ได้เลยค่ะ '.repeat(20) },
    { id: 'a3', from: 'staff', kind: 'payreq', text: 'ข้อมูลภายใน', paymentId: 'p1' },
    { id: 'a4', from: 'staff', kind: 'quote', text: '', card: null },
  ]
  assertEquals(replySnippetOf(all, 'a1'), { id: 'a1', from: 'customer', text: 'สั่งเค้กวันเสาร์ได้ไหม' })
  assertEquals(replySnippetOf(all, 'a2')?.text.length, 80)
  assertEquals(replySnippetOf(all, 'a3'), null)
  assertEquals(replySnippetOf(all, 'a4')?.text, 'ใบเสนอราคา')
  assertEquals(replySnippetOf(all, 'missing'), null)
  assertEquals(isCustomerVisible({ from: 'staff', kind: 'payreq' }), false)
  assertEquals(isCustomerVisible({ from: 'customer' }), true)
})

Deno.test('สรุปออร์เดอร์ในแชทลูกค้า: แสดงเฉพาะการ์ดที่เก็บไว้ · ลิงก์และรูปเฉพาะ https · ออร์เดอร์เก่าไม่มีข้อมูลภายใน', () => {
  const v = customerOrderView({
    id: 'cm9', from: 'staff', kind: 'order', at: '2026-11-16T13:00:00.000Z', orderId: 'o1', cost: 90,
    cardText: 'สยพสพ\nยอดรวม: 650', card: { kind: 'order', title: 'ออร์เดอร์ ORD-1', subtitle: 'คงค้าง 650', image: 'javascript:alert(1)', url: 'https://example.test/o/abc' },
  })
  assertEquals(v, {
    id: 'cm9', from: 'staff', kind: 'order', text: 'สยพสพ\nยอดรวม: 650', at: '2026-11-16T13:00:00.000Z', photos: [],
    card: { title: 'ออร์เดอร์ ORD-1', subtitle: 'คงค้าง 650', image: null, url: 'https://example.test/o/abc' },
  })
  const old = customerOrderView({ id: 'cm8', from: 'staff', kind: 'order', at: '2026-11-16T12:00:00.000Z', orderId: 'o0', cost: 40 })
  assertEquals(old, { id: 'cm8', from: 'staff', kind: 'order', text: 'ร้านส่งสรุปออร์เดอร์ให้แล้ว', at: '2026-11-16T12:00:00.000Z', photos: [], card: null })
})

Deno.test('การ์ดแจ้งเตือนในแชทลูกค้า: ชนิดการ์ดต้องอยู่ในรายการ · ลิงก์และรูปเฉพาะ https · ไม่มีการ์ดแสดงข้อความเดิม', () => {
  const v = customerCardView({
    id: 'cm20', from: 'staff', kind: 'card', at: '2026-11-17T01:00:00.000Z', cardText: 'ยอดที่แจ้ง 500 บาท',
    card: { kind: 'payreq', title: 'แจ้งยอดชำระ', subtitle: 'ยอด 500.00 บาท', url: 'https://example.test/o/x', pay: true, image: 'http://x.test/a.png' },
  })
  assertEquals(v, {
    id: 'cm20', from: 'staff', kind: 'card', text: 'ยอดที่แจ้ง 500 บาท', at: '2026-11-17T01:00:00.000Z', photos: [],
    card: { kind: 'payreq', title: 'แจ้งยอดชำระ', subtitle: 'ยอด 500.00 บาท', image: null, url: 'https://example.test/o/x', pay: true },
  })
  const unknown = customerCardView({ id: 'cm21', from: 'staff', kind: 'card', at: '2026-11-17T01:01:00.000Z', text: 'ข้อความ', card: { kind: 'internal_secret', title: 'x', url: 'javascript:1' } })
  assertEquals(unknown.card?.kind, 'info')
  assertEquals(unknown.card?.url, null)
  const plain = customerCardView({ id: 'cm22', from: 'staff', kind: 'card', at: '2026-11-17T01:02:00.000Z', text: 'ข้อความสำรอง', card: null })
  assertEquals(plain.text, 'ข้อความสำรอง')
  assertEquals(plain.card, null)
})

Deno.test('ออร์เดอร์เดิมในแชทเว็บ: สร้างการ์ดสรุปจากข้อมูลออร์เดอร์ได้ (ไม่มีปุ่มลิงก์) และแสดงยอดค้าง', () => {
  const order = {
    id: 'o1', code: 'OR-161126-0007', status: 'prepared', fulfillment: 'pickup', pickupAt: '2026-11-17T02:00:00.000Z',
    items: [{ name: 'เค้กช็อกโกแลต 6 นิ้ว', qty: 1, unitPrice: 650, fullPrice: 650, discounts: [] }],
    payments: [], couponsUsed: [], returns: [],
  }
  const r = legacyOrderCardOf(order)
  assertEquals(r.card.kind, 'order')
  assertEquals(r.card.title, 'ออร์เดอร์ OR-161126-0007')
  assertEquals(r.card.url, undefined)
  assertEquals(String(r.card.subtitle).includes('คงค้าง'), true)
  assertEquals(r.text.includes('เค้กช็อกโกแลต 6 นิ้ว'), true)
  assertEquals(r.text.includes('ยอดรวม'), true)
})
