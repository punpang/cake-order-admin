// อะแดปเตอร์โมเดล AI สำหรับบอทแชท · อินเทอร์เฟซเดียว complete() → ข้อความตอบ
// รองรับ anthropic (Messages API) · ผู้ให้บริการอื่นเพิ่มเป็น case ใหม่ได้โดยไม่แก้ที่เรียกใช้
// ไม่อ่าน Deno.env ที่นี่ (รับคีย์เป็นพารามิเตอร์) เพื่อให้ทดสอบด้วย Node ได้
// ไม่มีคีย์ API ใน log หรือข้อความที่ส่งกลับ

export type AiMsg = { role: 'user' | 'assistant'; content: string }
export type AiReq = { provider: string; model: string; key: string; system: string; messages: AiMsg[]; maxTokens: number }

const TIMEOUT_MS = 10_000

// Messages API ต้องเริ่มด้วย user และสลับ role · รวมข้อความ role เดียวกันติดกัน และตัดข้อความ assistant นำหน้า
export function normalizeMessages(msgs: AiMsg[]): AiMsg[] {
  const out: AiMsg[] = []
  for (const m of msgs) {
    const content = String(m.content ?? '').trim()
    if (!content) continue
    const last = out[out.length - 1]
    if (last && last.role === m.role) last.content += `\n${content}`
    else out.push({ role: m.role, content })
  }
  while (out.length && out[0].role !== 'user') out.shift()
  return out
}

export async function complete(r: AiReq): Promise<string> {
  if (!r.key) throw new Error('no_key')
  if (r.provider === 'anthropic') return anthropic(r)
  throw new Error('unsupported_provider')
}

async function anthropic(r: AiReq): Promise<string> {
  const messages = normalizeMessages(r.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('no_user_message')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': r.key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: r.model, max_tokens: r.maxTokens, system: r.system, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`anthropic_${res.status}`)
  const data: any = await res.json()
  return (Array.isArray(data?.content) ? data.content : [])
    .filter((x: any) => x?.type === 'text')
    .map((x: any) => String(x.text ?? ''))
    .join('')
    .trim()
}
