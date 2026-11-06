// สร้างรายการบัญชีจากฟอร์ม "บันทึกรายได้/ค่าใช้จ่าย" (ฟังก์ชันล้วน)
import { toS, toB } from './money'
import { CASH, BANK, AR, AP, INPUT_VAT, OUTPUT_VAT } from './chart'

export const SETTLE = {
  expense: { cash: ['จ่ายเงินสด', CASH], bank: ['จ่ายผ่านธนาคาร/โอน/บัตร', BANK], payable: ['ค้างจ่าย (เจ้าหนี้)', AP] },
  income: { cash: ['รับเงินสด', CASH], bank: ['รับผ่านธนาคาร/โอน/บัตร', BANK], receivable: ['ค้างรับ (ลูกหนี้)', AR] },
}

// แยกยอดตามโหมด VAT → { net, vat, total } (สตางค์)
export function splitVat(amount, mode, rate) {
  const a = toS(amount)
  const r = Number(rate) || 0
  if (mode === 'included' && r > 0) {
    const net = Math.round((a * 100) / (100 + r))
    return { net, vat: a - net, total: a }
  }
  if (mode === 'excluded' && r > 0) {
    const vat = Math.round((a * r) / 100)
    return { net: a, vat, total: a + vat }
  }
  return { net: a, vat: 0, total: a }
}

// form: { kind, date, account, amount, vatMode: none|included|excluded, vatRate, claimable (ขอคืนภาษีซื้อได้), settle, payee, taxInvoiceNo, taxInvoiceDate, payeeTaxId, memo }
// คืน { entry } | { error }
export function buildManualEntry(form) {
  const kind = form.kind === 'income' ? 'income' : 'expense'
  const amount = Number(form.amount)
  if (!(amount > 0) || !Number.isFinite(amount)) return { error: 'ใส่จำนวนเงินมากกว่า 0' }
  if (!form.account) return { error: 'เลือกหมวด/บัญชี' }
  const st = SETTLE[kind][form.settle]
  if (!st) return { error: 'เลือกวิธีรับ/จ่ายเงิน' }
  const { net, vat, total } = splitVat(amount, form.vatMode, form.vatRate)
  const lines = []
  if (kind === 'expense') {
    const claim = vat > 0 && !!form.claimable
    lines.push({ account: form.account, dr: toB(claim ? net : net + vat) })
    if (claim) lines.push({ account: INPUT_VAT, dr: toB(vat) })
    lines.push({ account: st[1], cr: toB(total) })
  } else {
    lines.push({ account: st[1], dr: toB(total) })
    lines.push({ account: form.account, cr: toB(net) })
    if (vat > 0) lines.push({ account: OUTPUT_VAT, cr: toB(vat) })
  }
  const tax = vat > 0 ? [{ kind: kind === 'income' ? 'output' : form.claimable ? 'input' : null, base: toB(net), vat: toB(vat), rate: Number(form.vatRate) || 0, party: String(form.payee || '').trim().slice(0, 100), docNo: String(form.taxInvoiceNo || '').trim().slice(0, 40), taxId: String(form.payeeTaxId || '').replace(/\D/g, '').slice(0, 13), docDate: String(form.taxInvoiceDate || '') }].filter((t) => t.kind) : []
  return {
    entry: {
      date: form.date,
      ...(tax.length ? { tax } : {}),
      memo: String(form.memo || '').trim().slice(0, 200),
      lines,
      source: {
        type: 'manual', kind, account: form.account, amount, settle: form.settle, payee: String(form.payee || '').trim().slice(0, 100), vatMode: form.vatMode || 'none', vatRate: Number(form.vatRate) || 0,
        vat: toB(vat), net: toB(net), total: toB(total), claimable: kind === 'expense' && vat > 0 && !!form.claimable,
        taxInvoiceNo: String(form.taxInvoiceNo || '').trim().slice(0, 40), taxInvoiceDate: String(form.taxInvoiceDate || ''), payeeTaxId: String(form.payeeTaxId || '').replace(/\D/g, '').slice(0, 13),
        attachments: (form.attachments || []).slice(0, 5),
        ...(form.recurringId ? { recurringId: String(form.recurringId), recurringYm: String(form.recurringYm || '') } : {}),
      },
    },
  }
}
