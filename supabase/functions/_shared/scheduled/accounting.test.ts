// ทดสอบแผนเตือนบัญชี (อ่านอย่างเดียว): ค่าใช้จ่ายประจำที่ยังไม่บันทึก · งวดผ่อนชำระ · กันเตือนซ้ำกับแอป
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { accountingPlans, type AcctInput } from './accounting.ts'

// deno-lint-ignore no-explicit-any
type Any = any

const TODAY = '2026-11-14'
const BASE: AcctInput = { todayStr: TODAY, closedThrough: '', recurring: [], recurringSkips: [], installments: [], vatFilings: {}, postedRecurring: [] }
const RENT: Any = { id: 't1', name: 'ค่าเช่าร้าน', kind: 'fixed', amount: 10000, dueDay: 5, autoPost: false, vatMode: 'none', active: true }
const keys = (ps: Any[]) => ps.map((p) => p.key).sort()

Deno.test('ค่าใช้จ่ายประจำที่ยังไม่บันทึก → เตือนทีม (เดือนก่อนและเดือนนี้)', () => {
  const ps = accountingPlans({ ...BASE, recurring: [RENT] })
  assertEquals(keys(ps), ['expmiss|t1|2026-10', 'expmiss|t1|2026-11'])
  const nov = ps.find((p) => p.key === 'expmiss|t1|2026-11')
  assertEquals(nov?.kind, 'team')
  assertEquals(nov?.event, 'team_expense_missing')
  assertEquals(nov?.vars, { รายการ: 'ค่าเช่าร้าน', เดือนภาษี: '2026-11', วันที่: '2026-11-05' })
})

Deno.test('ตั้งบันทึกอัตโนมัติ (คงที่) และยังไม่ล็อก/ยังไม่ยื่นภาษี → ไม่เตือน (แอปจะบันทึกให้)', () => {
  const ps = accountingPlans({ ...BASE, recurring: [{ ...RENT, autoPost: true }] })
  assertEquals(ps.length, 0)
})

Deno.test('บันทึกแล้วหรือข้ามเดือนแล้ว → ไม่เตือนเดือนนั้น', () => {
  const posted = [{ source: { recurringId: 't1', recurringYm: '2026-10' }, reversedBy: null }, { source: { recurringId: 't1', recurringYm: '2026-11' } }]
  assertEquals(accountingPlans({ ...BASE, recurring: [RENT], postedRecurring: posted }).length, 0)
  const skipped = accountingPlans({ ...BASE, recurring: [RENT], recurringSkips: [{ recurringId: 't1', ym: '2026-10' }] })
  assertEquals(keys(skipped), ['expmiss|t1|2026-11'])
})

Deno.test('รายการที่กลับรายการแล้วไม่นับว่าบันทึกแล้ว', () => {
  const reversed = [{ source: { recurringId: 't1', recurringYm: '2026-11' }, reversedBy: 'jv-x' }]
  const ps = accountingPlans({ ...BASE, recurring: [RENT], postedRecurring: reversed })
  assert(ps.some((p) => p.key === 'expmiss|t1|2026-11'))
})

Deno.test('งวดปิดแล้วหรือยื่น ภ.พ.30 แล้ว → แอปจะไม่บันทึกอัตโนมัติ จึงต้องเตือน', () => {
  const locked = accountingPlans({ ...BASE, recurring: [{ ...RENT, autoPost: true }], closedThrough: '2026-11-30' })
  assertEquals(keys(locked), ['expmiss|t1|2026-10', 'expmiss|t1|2026-11'])
  const vat = accountingPlans({ ...BASE, recurring: [{ ...RENT, autoPost: true, vatMode: 'exclusive' }], vatFilings: { '2026-11': { filedAt: '2026-12-01' } } })
  assert(vat.some((p) => p.key === 'expmiss|t1|2026-11'))
})

Deno.test('ยังไม่ถึงกำหนดหรือยังไม่เลยผ่อนผัน → ไม่เตือน', () => {
  const late = accountingPlans({ ...BASE, recurring: [{ ...RENT, dueDay: 25 }] })
  assertEquals(keys(late), ['expmiss|t1|2026-10']) // เดือนพฤศจิกายนยังไม่ถึงกำหนด
})

Deno.test('งวดผ่อนชำระที่ครบกำหนดภายใน 1 วัน → เตือนทีม', () => {
  const loan = { id: 'x1', name: 'เงินกู้ร้าน', principal: 12000, ratePct: 0, n: 12, method: 'reducing', firstDue: '2026-11-15', payments: [] }
  const ps = accountingPlans({ ...BASE, installments: [loan] })
  assertEquals(keys(ps), ['instdue|x1|1'])
  assertEquals(ps[0].event, 'team_installment_due')
  assertEquals(ps[0].vars.งวด, '1')
  assertEquals(ps[0].vars.วันที่, '2026-11-15')
})

Deno.test('งวดที่จ่ายแล้วไม่เตือน และงวดถัดไปยังไม่ถึงกำหนดจึงไม่เตือน', () => {
  const paid = { id: 'x1', name: 'เงินกู้ร้าน', principal: 12000, ratePct: 0, n: 12, method: 'reducing', firstDue: '2026-11-15', payments: [{ no: 1 }] }
  assertEquals(accountingPlans({ ...BASE, installments: [paid] }).length, 0) // งวด 2 ครบกำหนดธันวาคม
  const future = { ...paid, payments: [], firstDue: '2026-11-20' }
  assertEquals(accountingPlans({ ...BASE, installments: [future] }).length, 0)
})
