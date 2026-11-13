// ทดสอบกฎรหัสร้านค้า: ซ้ำกับบัญชีผู้รับหรือเป็นตัวเลขจากรหัส POS → ทิ้งเป็นค่าว่าง · คำสั่ง Workers AI ใช้ได้กับตัวอ่านที่ตอบถูกต้อง
import { assertEquals } from 'jsr:@std/assert@1'
import { readSlipFieldsWorkersAI } from './slipocr.ts'
import { merchantCodeOk } from './slipref.ts'

const NOW = Date.UTC(2026, 10, 11, 3, 0, 0)
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
const reply = (payload: unknown) => (async () => new Response(
  JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }] }),
  { status: 200, headers: { 'content-type': 'application/json' } },
)) as typeof fetch
const read = (payload: unknown) => readSlipFieldsWorkersAI({ bytes: JPG, accountId: 'a', token: 't', nowMs: NOW, fetchImpl: reply(payload) })

Deno.test('รหัสร้านค้าที่เป็นตัวเลขจากรหัส POS ถูกทิ้ง และรหัสอ้างอิงร้านค้ายังอยู่', async () => {
  const r = await read({ amount: 1, date_text: '13 พ.ย. 69 15:15', receiver_account: '014000000517185', sender_account: null, merchant_code: '123927229', shop_ref: 'POS123927229' })
  assertEquals(r?.merchantCode, undefined)
  assertEquals(r?.shopRef, 'POS123927229')
  assertEquals(r?.receiverAccount, '014000000517185')
})

Deno.test('รหัสร้านค้าที่ซ้ำกับเลขบัญชีผู้รับถูกทิ้ง', async () => {
  const r = await read({ amount: 1, date_text: '13 พ.ย. 69 15:15', receiver_account: '014000000517185', sender_account: null, merchant_code: '014000000517185', shop_ref: null })
  assertEquals(r?.merchantCode, undefined)
})

Deno.test('คำตอบที่ถูกต้องคงรหัสร้านค้าและรหัสอ้างอิงไว้ครบ', async () => {
  const r = await read({ amount: 1, date_text: '13 พ.ย. 69 15:15', receiver_account: 'xxx-x-x8154-x', sender_account: null, merchant_code: '014000000517185', shop_ref: 'POS123927229' })
  assertEquals([r?.merchantCode, r?.shopRef, r?.receiverAccount], ['014000000517185', 'POS123927229', 'xxx-x-x8154-x'])
})

Deno.test('กฎรหัสร้านค้า: ทิ้งเมื่อซ้ำกับบัญชีผู้รับ หรือเป็นตัวเลขจากรหัส POS · ความยาวสั้นเกินไปก็ทิ้ง', () => {
  assertEquals(merchantCodeOk('123927229', null, 'POS123927229'), false)
  assertEquals(merchantCodeOk('014000000517185', '014000000517185', ''), false)
  assertEquals(merchantCodeOk('014000000517185', 'xxx-x-x8154-x', 'POS123927229'), true)
  assertEquals(merchantCodeOk('12345', null, ''), false)
})
