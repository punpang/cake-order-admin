// ช่องทางรับชำระที่ส่งให้ลูกค้า (ออเดอร์ที่ลูกค้าเปิดผ่านลิงก์หรือล็อกอิน · เครื่องลูกค้าไม่มีข้อมูลร้าน)
// เฉพาะบัญชีที่ร้านเปิดแสดง และเฉพาะฟิลด์ที่ใช้แสดง · ไม่ส่งค่าอื่นของร้าน (เลขผู้เสียภาษี ที่อยู่ ลิงก์ภายใน ฯลฯ)
// รูปแบบเดิม (promptpayId / accountNo / bank ตัวเดียว) แปลงเป็นรายการเหมือนฝั่งแอป (src/lib/payAccounts.js)
// ใช้ร่วมกันโดย order-link และ customer-auth
export type PublicPayAccount = { id: string; kind: 'bank' | 'promptpay'; bankCode?: string; bankName?: string; accountNo?: string; promptpayId?: string; accountName: string }
export type PublicPayment = { note: string; accounts: PublicPayAccount[]; billerId: string }

const txt = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

export function publicPaymentOf(shopV: any): PublicPayment {
  const p = shopV?.payment || {}
  const legacy: any[] = []
  if (p.promptpayId) legacy.push({ id: 'pa-legacy-pp', kind: 'promptpay', show: true, promptpayId: p.promptpayId, accountName: p.accountName })
  if (p.accountNo || p.bank) legacy.push({ id: 'pa-legacy-bank', kind: 'bank', show: true, bankName: p.bank, accountNo: p.accountNo, accountName: p.accountName })
  const list: any[] = Array.isArray(p.accounts) ? p.accounts : legacy
  const accounts: PublicPayAccount[] = []
  for (const a of list) {
    if (!a || typeof a !== 'object' || a.show === false) continue
    if (a.kind === 'promptpay') {
      const promptpayId = txt(a.promptpayId, 20).replace(/\D/g, '')
      if (promptpayId) accounts.push({ id: txt(a.id, 40), kind: 'promptpay', promptpayId, accountName: txt(a.accountName, 80) })
    } else if (a.kind === 'bank') {
      const accountNo = txt(a.accountNo, 20).replace(/\D/g, '')
      if (accountNo) accounts.push({ id: txt(a.id, 40), kind: 'bank', bankCode: txt(a.bankCode, 3), bankName: txt(a.bankName, 60), accountNo, accountName: txt(a.accountName, 80) })
    }
  }
  // รหัสร้านค้า (Biller ID 15 หลัก) ใช้สร้าง QR แบบ Biller ให้ลูกค้า · อยู่ในคิวอาร์ของร้านอยู่แล้วจึงไม่ใช่ข้อมูลลับ
  const biller = txt(shopV?.merchantCode, 20).replace(/\D/g, '')
  return { note: txt(p.note, 300), accounts, billerId: /^\d{15}$/.test(biller) ? biller : '' }
}
