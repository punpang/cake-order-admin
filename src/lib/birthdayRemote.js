// บันทึก/ถอนเดือนเกิดสมาชิก (Edge Function customer-loyalty · กติกาที่ punpang_cust_set_birth)
import { callLoyalty, readSessionToken, injectBundle } from './customerRemote'
import { db } from '../data/store'

const DAY_MS = 86400000
// วันที่ใช้สิทธิได้ = วันที่กรอกล่าสุด + 30 วัน (ข้อมูลจากบัญชีลูกค้า)
export function birthEligibleDate(birth) {
  if (!birth?.setAt) return null
  const t = new Date(birth.setAt).getTime() + 30 * DAY_MS
  return Number.isFinite(t) ? new Date(t) : null
}

export async function setBirthRemote(month, consent) {
  const r = await callLoyalty('set_birth', { session: readSessionToken(), month: Number(month), consent: consent === true })
  if (r.error) return { error: r.error }
  injectBundle(db, r)
  return { ok: true }
}

export async function clearBirthRemote() {
  const r = await callLoyalty('clear_birth', { session: readSessionToken() })
  if (r.error) return { error: r.error }
  injectBundle(db, r)
  return { ok: true }
}
