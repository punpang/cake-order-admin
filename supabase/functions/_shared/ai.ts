// อะแดปเตอร์โมเดล AI สำหรับบอทแชท · อินเทอร์เฟซเดียว complete() → ข้อความตอบ
// รองรับ workers (Workers AI ของ Cloudflare) และ anthropic (Messages API) · ผู้ให้บริการอื่นเพิ่มเป็น case ใหม่ได้โดยไม่แก้ที่เรียกใช้
// ไม่อ่าน Deno.env ที่นี่ (รับคีย์และรหัสบัญชีเป็นพารามิเตอร์) เพื่อให้ทดสอบได้โดยไม่เรียกระบบจริง
// ไม่มีคีย์ API ใน log หรือข้อความที่ส่งกลับ

export type AiMsg = { role: 'user' | 'assistant'; content: string }
export type AiReq = { provider: string; model: string; key: string; accountId?: string; system: string; messages: AiMsg[]; maxTokens: number }

const TIMEOUT_MS = 10_000
const WAI_TIMEOUT_MS = 15_000

// โควตา Workers AI ของวันหมดแล้ว (หรือถูกจำกัดความถี่) → ผู้เรียกส่งต่อไปผู้ให้บริการสำรอง
export class AiQuotaError extends Error {
  constructor(message = 'quota') {
    super(message)
    this.name = 'AiQuotaError'
  }
}
export const isQuotaError = (e: unknown): boolean => e instanceof AiQuotaError

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
  if (r.provider === 'workers') return workers(r)
  if (r.provider === 'anthropic') return anthropic(r)
  throw new Error('unsupported_provider')
}

// Workers AI: ส่งข้อความระบบเป็นข้อความแรก (role system) แล้วตามด้วยข้อความของลูกค้า
// รับได้ทั้งรูปแบบ result.response และ result.choices[0].message.content (โมเดลบางตัวใช้รูปแบบหลัง)
async function workers(r: AiReq): Promise<string> {
  const messages = normalizeMessages(r.messages)
  if (!messages.length || messages[messages.length - 1].role !== 'user') throw new Error('no_user_message')
  if (!r.accountId) throw new Error('no_account')
  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(r.accountId)}/ai/run/${r.model}`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${r.key}` },
    body: JSON.stringify({ messages: [{ role: 'system', content: r.system }, ...messages], max_tokens: r.maxTokens }),
    signal: AbortSignal.timeout(WAI_TIMEOUT_MS),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    if (res.status === 429 || /allocation|neuron|daily|quota/i.test(body)) throw new AiQuotaError(`workers_${res.status}`)
    throw new Error(`workers_${res.status}`)
  }
  const data: any = await res.json()
  if (data?.success === false) throw new Error('workers_fail')
  const text = data?.result?.response ?? data?.result?.choices?.[0]?.message?.content
  return String(text ?? '').trim()
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
