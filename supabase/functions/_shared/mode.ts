// โหมดทดสอบ (ฐานข้อมูลเดียวกัน · ข้อมูลทดสอบอยู่ที่ schema punpang_test)
// แอปส่งหัว x-punpang-mode: test มาเฉพาะตอนเปิดโหมดทดสอบ · ไม่มีหัวนี้ = โหมดจริง (ค่าเริ่มต้น ปลอดภัย)
// ฟังก์ชันที่ใช้ข้อมูลจริงทั้งหมดเลือก schema ตามโหมด · ฟังก์ชันที่ไม่ควรทำงานในโหมดทดสอบจะตอบ 409 (ดู refuseInTest)

export type Mode = 'live' | 'test'
export const TEST_SCHEMA = 'punpang_test'
export const TEST_MODE_HEADER = 'x-punpang-mode'

export const modeOf = (req: Request): Mode => (req.headers.get(TEST_MODE_HEADER) === 'test' ? 'test' : 'live')
export const schemaOf = (mode: Mode): string => (mode === 'test' ? TEST_SCHEMA : 'public')

// หัวสำหรับเรียก REST (PostgREST) โดยตรง: เลือกสคีมาทั้งการอ่าน (Accept-Profile) และการเขียน (Content-Profile)
export const restProfileHeaders = (mode: Mode): Record<string, string> => {
  const schema = schemaOf(mode)
  return schema === 'public' ? {} : { 'Accept-Profile': schema, 'Content-Profile': schema }
}

// ฟังก์ชันที่ไม่ควรทำงานในโหมดทดสอบ (เช่น งานตามเวลา เว็บฮุก ลูกค้าจริง) ตอบ 409 ด้วยข้อความไทย
export const refuseInTest = (mode: Mode, cors: Record<string, string> = {}): Response | null =>
  mode === 'test'
    ? new Response(JSON.stringify({ error: 'ทำรายการนี้ไม่ได้ในโหมดทดสอบ' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors },
      })
    : null

// ผู้รับที่อนุญาตให้ส่งจริงในโหมดทดสอบ (รายการ records collection "testRecipients" ของสำเนา)
export type TestRecipient = { channel: 'sms' | 'telegram' | 'facebook'; to: string }
export const RECIPIENT_CHANNELS = ['sms', 'telegram', 'facebook'] as const

const cleanTo = (channel: string, to: string): string => {
  const raw = String(to ?? '').trim()
  return channel === 'sms' ? raw.replace(/[\s-]/g, '') : raw
}

// ตรวจว่าผู้รับนี้อยู่ในรายการทดสอบของช่องทางเดียวกัน (ไม่ตรง = ห้ามส่ง)
export function recipientAllowed(list: unknown, channel: string, to: string): boolean {
  if (!Array.isArray(list) || !to) return false
  const want = cleanTo(channel, to)
  if (!want) return false
  return list.some((r) => r && typeof r === 'object' && (r as TestRecipient).channel === channel && cleanTo(channel, (r as TestRecipient).to) === want)
}

// รายการผู้รับทดสอบที่ใช้ได้ (ตัดรายการที่ช่องทางหรือค่าไม่ถูกต้อง)
export function cleanRecipients(list: unknown): TestRecipient[] {
  if (!Array.isArray(list)) return []
  return list.filter((r): r is TestRecipient => !!r && typeof r === 'object' && RECIPIENT_CHANNELS.includes((r as TestRecipient).channel) && !!cleanTo((r as TestRecipient).channel, (r as TestRecipient).to))
}
