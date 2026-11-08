import { findPhones } from './chatParse'
import { similarity } from './chatBot'

// แนะนำลูกค้าให้แชทที่ยังไม่ผูก (ไม่ผูกเอง ให้พนักงานกดยืนยัน)
const idField = (channel) => (channel === 'line' ? 'lineUserId' : 'fbPsid')

export function phonesInChat(chat) {
  const seen = new Set()
  for (const m of chat?.messages || []) if (m.from === 'customer' && m.text) for (const p of findPhones(m.text)) seen.add(p.value)
  return [...seen]
}

export function suggestCustomers(chat, customers, minName = 0.6, max = 3) {
  if (!chat || chat.customerId) return []
  const field = idField(chat.channel)
  const phones = phonesInChat(chat)
  const out = []
  for (const c of customers) {
    if (c.active === false || c.deleted || c[field]) continue
    if (c.phone && phones.includes(c.phone)) { out.push({ customer: c, why: 'phone', score: 2 }); continue }
    const s = similarity(chat.profileName || '', c.name || '')
    if (s >= minName) out.push({ customer: c, why: 'name', score: s })
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max)
}
