// ยินยอมก่อนชำระเงิน (ลูกค้าที่ยังไม่เคยยินยอมฉบับปัจจุบัน): ประกาศความเป็นส่วนตัว (PDPA) · เงื่อนไขการใช้งาน · นโยบายคุกกี้
// เก็บในคอลเลกชัน consents แบบเดียวกับบัญชีลูกค้า (customer-auth) · เวอร์ชันมาจาก config/legal (docs[kind].version)
export const ORDER_CONSENT_KINDS = ['privacy', 'terms', 'cookie'] as const

async function currentDocs(sb: any): Promise<Record<string, { version?: unknown }>> {
  const legal = await sb.from('punpang_kv').select('data').eq('collection', 'legal').eq('id', 'legal').maybeSingle()
  return legal.data?.data?.v?.docs || {}
}

// ชนิดที่ลูกค้ายังไม่ได้ยินยอมเวอร์ชันปัจจุบัน · ไม่มีลูกค้า (ออร์เดอร์ที่ไม่ผูกลูกค้า) = ไม่ต้องยินยอม
export async function consentNeededFor(sb: any, customerId: string | null | undefined): Promise<string[]> {
  if (!customerId) return []
  const docs = await currentDocs(sb)
  const have = (await sb.from('punpang_records').select('data').eq('collection', 'consents').eq('data->>customerId', customerId)).data || []
  return ORDER_CONSENT_KINDS.filter((k) => {
    const cur = Number(docs[k]?.version) || 1
    return !have.some((r: any) => r.data?.kind === k && Number(r.data?.version) >= cur)
  }) as string[]
}

// บันทึกการยินยอมของชนิดที่ระบุ ณ เวอร์ชันปัจจุบัน
export async function recordConsents(sb: any, customerId: string, kinds: string[], via: string): Promise<void> {
  if (!customerId || !kinds.length) return
  const docs = await currentDocs(sb)
  const at = new Date().toISOString()
  for (const kind of kinds) {
    await sb.from('punpang_records').insert({ collection: 'consents', id: `cs${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`, data: { customerId, kind, version: Number(docs[kind]?.version) || 1, detail: null, at, via } })
  }
}
