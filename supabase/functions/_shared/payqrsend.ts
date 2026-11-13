// ลูกค้ากด "ถูกต้อง/ชำระเงิน" ในการ์ดแจ้งชำระ (Facebook) → ส่ง QR พร้อมเพย์ Biller ตามยอดที่แจ้ง (มีรหัสสุ่ม Ref 2 ให้ตรวจสลิป)
// พร้อมรายละเอียดช่องทางชำระอื่นที่ร้านเปิดไว้ · รายการนั้นได้รหัสสุ่มเก็บไว้ที่งวดนี้ (สลิปที่ส่งมาจับคู่ได้)
import QRCode from 'npm:qrcode@1.5.4'
import { billerIdOf, promptPayBillerPayload, shopRefOfCode } from './schedlib/promptpay.js'
import { newQrSuffix } from './payqr.ts'
import { publicPaymentOf, type PublicPayAccount } from './shoppay.ts'
import { filesEnv, svcSign, svcUpload } from './filesvc.ts'

const GRAPH = 'https://graph.facebook.com'
const TEXT_MAX = 1900

export const PAY_OK_PREFIX = 'pay:ok:'

const accountLine = (a: PublicPayAccount): string =>
  a.kind === 'promptpay'
    ? `พร้อมเพย์ ${a.promptpayId}${a.accountName ? ` (${a.accountName})` : ''}`
    : `${a.bankName || 'บัญชีธนาคาร'} ${a.accountNo || ''}${a.accountName ? ` ${a.accountName}` : ''}`.trim()

async function graphSend(psid: string, token: string, ver: string, message: Record<string, unknown>): Promise<boolean> {
  try {
    const r = await fetch(`${GRAPH}/${ver}/me/messages?${new URLSearchParams({ access_token: token })}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipient: { id: psid }, messaging_type: 'RESPONSE', message }), signal: AbortSignal.timeout(15000) })
    return r.ok
  } catch {
    return false
  }
}

// คืนข้อความตอบลูกค้า (ใช้เมื่อไม่สามารถส่ง QR ได้)
export async function sendPaymentQr(sb: any, o: { psid: string; paymentId: string; token: string; ver: string }): Promise<string> {
  const chat = await sb.from('punpang_chats').select('id,customer_id').eq('channel', 'facebook').eq('external_id', o.psid).maybeSingle()
  if (!chat.data?.customer_id) return 'ไม่พบข้อมูลการแจ้งชำระนี้ค่ะ กรุณาติดต่อร้าน'
  const found = await sb.from('punpang_orders').select('id,code,status,customer_id,data,updated_at').eq('customer_id', chat.data.customer_id).contains('data', { payments: [{ id: o.paymentId }] }).maybeSingle()
  const order = found.data
  if (!order || order.status === 'cancelled' || order.status === 'draft') return 'ไม่พบการแจ้งชำระนี้ หรือออร์เดอร์นี้ปิดแล้วค่ะ'
  const payments: any[] = Array.isArray(order.data?.payments) ? order.data.payments : []
  const p = payments.find((x) => x?.id === o.paymentId)
  if (!p || p.status !== 'reported' || p.customerSubmitted === true) return 'ยอดนี้ไม่ได้รอชำระแล้วค่ะ'
  const amount = Number(p.requested ?? p.amount)
  if (!(amount > 0)) return 'ยอดนี้ไม่ถูกต้อง กรุณาติดต่อร้านค่ะ'

  const kv = await sb.from('punpang_kv').select('data').eq('collection', 'config').eq('id', 'shop').maybeSingle()
  const shopV = kv.data?.data?.v || {}
  const pay = publicPaymentOf(shopV)
  const biller = billerIdOf(pay.billerId)

  // รหัสสุ่ม Ref 2 ของงวดนี้ (สร้างครั้งเดียว เก็บไว้ให้สลิปจับคู่ได้)
  let qrRef: string = p.qrRef || ''
  if (!qrRef) {
    qrRef = `${shopRefOfCode(order.code)}${newQrSuffix()}`
    const nextPayments = payments.map((x) => (x?.id === p.id ? { ...x, qrRef } : x))
    const up = await sb.from('punpang_orders').update({ data: { ...order.data, payments: nextPayments } }).eq('id', order.id).eq('updated_at', order.updated_at).select('id')
    if (up.error || !(up.data || []).length) return 'ระบบกำลังปรับปรุงออร์เดอร์ กรุณากดอีกครั้งค่ะ'
  }

  const lines: string[] = []
  if (biller && pay.merchantCode) {
    // ฟังก์ชันร่วมกับแอป (ไฟล์ JS) รับยอดเป็นตัวเลข
    const build = promptPayBillerPayload as unknown as (b: string, a: number, c: string, r: string) => string | null
    const payload = build(biller, amount, pay.merchantCode, qrRef)
    try {
      const png = new Uint8Array(await QRCode.toBuffer(payload, { type: 'png', margin: 2, width: 480, errorCorrectionLevel: 'M' }))
      const up = await svcUpload(filesEnv(), png, `pay-qr/${order.id}`)
      const url = await svcSign(filesEnv(), up.key, 900)
      if (!url) return 'ส่ง QR ไม่สำเร็จ กรุณาลองใหม่ค่ะ'
      const imgOk = await graphSend(o.psid, o.token, o.ver, { attachment: { type: 'image', payload: { url } } })
      if (!imgOk) return 'ส่ง QR ไม่สำเร็จ กรุณาลองใหม่ค่ะ'
      lines.push(`สแกน QR พร้อมเพย์เพื่อชำระ ${amount.toFixed(2)} บาท`)
    } catch {
      return 'สร้าง QR ไม่สำเร็จ กรุณาติดต่อร้านค่ะ'
    }
  } else {
    lines.push('ร้านยังไม่ได้ตั้งค่า QR พร้อมเพย์ ชำระตามช่องทางด้านล่างแทนค่ะ')
  }
  if (pay.accounts.length) {
    lines.push('ช่องทางชำระอื่น:')
    for (const a of pay.accounts) lines.push(`• ${accountLine(a)}`)
  }
  if (pay.note) lines.push(pay.note)
  const text = lines.join('\n').slice(0, TEXT_MAX)
  await graphSend(o.psid, o.token, o.ver, { text })
  return 'ส่ง QR และช่องทางชำระให้แล้วค่ะ'
}
