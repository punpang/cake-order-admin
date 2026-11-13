// แผนเตือนบัญชีตามเวลา (ฟังก์ชันล้วน · ทดสอบได้) — ตรรกะเทียบกับ runAcctChecks ใน src/data/acct.js
// เตือนเฉพาะสิ่งที่คำนวณจากข้อมูลบัญชีอย่างเดียว (ไม่ต้องใช้ยอดขาย และไม่เขียนข้อมูลบัญชี):
//   - ค่าใช้จ่ายประจำที่ยังไม่บันทึก (สถานะ missing)
//   - งวดผ่อนชำระที่ใกล้หรือเลยกำหนด (ภายใน 1 วัน)
// ยังอยู่ในแอป: เตือน VAT (ต้องยอดขายจากออร์เดอร์) และการบันทึกค่าใช้จ่ายประจำอัตโนมัติ (เขียนข้อมูลบัญชี)
import { addDays, loanSchedule, recurringDue, recurringState } from '../schedlib/acct/plan.js'
import { addMonths } from '../schedlib/acct/period.js'
import type { Plan } from './plan.ts'

// deno-lint-ignore no-explicit-any
type Any = any

export type AcctInput = {
  todayStr: string // YYYY-MM-DD เวลาไทย
  closedThrough: string // วันที่ปิดงวดล่าสุด ('' = ยังไม่ปิด)
  recurring: Any[] // kv acct 'recurring'
  recurringSkips: Any[] // kv acct 'recurringSkips'
  installments: Any[] // kv acct 'installments'
  vatFilings: Record<string, Any> // kv acct 'vatFilings'
  postedRecurring: Any[] // รายการบัญชีที่มี source.recurringId (จากตาราง punpang_acct_entries)
}

const locked = (input: AcctInput, date: string) => !!input.closedThrough && date <= input.closedThrough
const vatFiled = (input: AcctInput, ym: string) => !!input.vatFilings?.[ym]?.filedAt
const postedOf = (input: AcctInput, t: Any, ym: string) =>
  input.postedRecurring.find((e: Any) => e.source?.recurringId === t.id && e.source?.recurringYm === ym && !e.reversedBy)
const skipOf = (input: AcctInput, t: Any, ym: string) => input.recurringSkips.find((s: Any) => s.recurringId === t.id && s.ym === ym)

const plan = (key: string, event: string, vars: Record<string, string>): Plan => ({ key, kind: 'team', event, orderId: null, order: null, customer: null, vars })

export function accountingPlans(input: AcctInput): Plan[] {
  const out: Plan[] = []
  const ym = input.todayStr.slice(0, 7)
  // ค่าใช้จ่ายประจำ: เดือนก่อนและเดือนนี้ (เหมือนแอป)
  for (const m of [addMonths(ym, -1), ym]) {
    for (const t of input.recurring) {
      const due = recurringDue(t, m)
      const state = recurringState(t, m, { posted: !!postedOf(input, t, m), skipped: !!skipOf(input, t, m), today: input.todayStr })
      if (state !== 'missing' && state !== 'due') continue
      // แอปบันทึกให้เองเมื่อเปิดอยู่ (คงที่ + autoPost + ยังไม่ล็อก + ยังไม่ยื่นภาษี) → ไม่เตือนที่นี่ กันเตือนรายการที่จะถูกบันทึกแล้ว
      if (t.autoPost && t.kind === 'fixed' && !locked(input, due) && !(t.vatMode !== 'none' && vatFiled(input, due.slice(0, 7)))) continue
      if (state === 'missing') out.push(plan(`expmiss|${t.id}|${m}`, 'team_expense_missing', { รายการ: t.name, เดือนภาษี: m, วันที่: due }))
    }
  }
  // งวดผ่อนชำระ: งวดที่ยังไม่จ่ายแถวแรก ถ้าครบกำหนดภายใน 1 วัน (หรือเลยแล้ว)
  for (const x of input.installments) {
    const rows = loanSchedule(x).map((r: Any) => ({ ...r, paid: (x.payments || []).find((p: Any) => p.no === r.no) || null }))
    const row = rows.find((r: Any) => !r.paid)
    if (row && row.due <= addDays(input.todayStr, 1)) {
      out.push(plan(`instdue|${x.id}|${row.no}`, 'team_installment_due', { รายการ: x.name, งวด: String(row.no), วันที่: row.due, ยอดรวม: String(row.payment) }))
    }
  }
  return out
}
