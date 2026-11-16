// บอท LINE: ใช้กติกา AI และการตั้งค่าชุดเดียวกับ Facebook (../fb-webhook/bot.ts) แต่ตอบอัตโนมัติ ไม่มีโหมดพนักงานตอบ
import { decide, isSensitiveText, loadConfig, tryAi, type BotInput } from '../fb-webhook/bot.ts'
import { lineLinkReply } from '../_shared/lineliff.ts'

export const FALLBACK_TEXT = 'ขออภัยค่ะ ตอนนี้ตอบเรื่องนี้ไม่ได้ ลองติดต่อร้านโดยตรงได้เลยนะคะ'
export const GREETING_TEXT = 'สวัสดีค่ะ ยินดีต้อนรับ พิมพ์คำถามได้เลยนะคะ'
const STALE_MS = 5 * 60_000 // ข้อความเก่ากว่านี้ (LINE ส่งซ้ำ) ไม่ตอบ
const LOCKED = ['handoff', 'order_unverified'] // กติกาที่ไม่ควรตอบเอง → ส่งข้อความแนะนำให้ติดต่อร้านแทน

export type LineBotInput = {
  sb: any
  lineUserId: string
  eventId: string
  text: string
  at: string // เวลาที่ลูกค้าส่ง (ISO)
  lastBot?: string // ข้อความบอทล่าสุดของแชทนี้ (กันตอบซ้ำแบบเดิม)
  profileName?: string
  aiKey?: string
  waiToken?: string
  waiAccountId?: string
}

// คืน null เมื่อบอท LINE ปิดอยู่หรือยังไม่ได้เปิดช่อง line (ไม่ตอบ) · คืนข้อความที่จะตอบพร้อมแหล่งที่มา
export async function answerLine(o: LineBotInput): Promise<{ text: string; source: string } | null> {
  const { bot, shop, storefront } = await loadConfig(o.sb)
  if (!bot || bot.enabled !== true || bot.mode === 'off' || bot.channels?.line !== true) return null
  // ถามเรื่องสั่งเค้กหรือคะแนน → ส่งลิงก์ (ไม่ขึ้นกับเวลาร้าน)
  const link = lineLinkReply(o.text)
  if (link) return { text: link, source: 'liff' }
  if (!shop?.open || !shop?.close) return null
  const at = new Date(o.at)
  if (!(Date.now() - at.getTime() <= STALE_MS)) return null
  if (isSensitiveText(o.text)) return { text: FALLBACK_TEXT, source: 'fallback' }
  const dec0 = decide(o.text, bot, shop, storefront, at, o.lastBot)
  const input: BotInput = {
    sb: o.sb, token: '', ver: '', psid: o.lineUserId, chatId: o.lineUserId, mid: o.eventId,
    text: o.text, at: o.at, aiKey: o.aiKey, waiToken: o.waiToken, waiAccountId: o.waiAccountId, channel: 'line',
  }
  // ไม่แน่ใจ + เปิด AI ไว้ → ให้ AI ตอบ (เหมือน Facebook แต่ตอบเองเลย ไม่รอพนักงาน)
  const dec = dec0.unsure && bot.ai?.enabled === true
    ? await tryAi(input, bot, shop, storefront, o.profileName || '', dec0, null)
    : dec0
  if (dec.handoff || LOCKED.includes(dec.source) || !String(dec.reply || '').trim()) return { text: FALLBACK_TEXT, source: 'fallback' }
  return { text: dec.reply, source: dec.source }
}
