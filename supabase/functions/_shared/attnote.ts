// ข้อความแทนไฟล์แนบที่ Messenger ส่งมาแต่ระบบไม่เก็บเป็นไฟล์ (ลิงก์ที่แชร์ การกล่าวถึงในสตอรี่ ข้อความแชร์ การ์ด ตำแหน่ง)
// แสดงชื่อเรื่อง/ลิงก์ที่มี เพื่อให้พนักงานเห็นว่าลูกค้าส่งอะไร · คืน null เมื่อไม่มีอะไรให้แสดง (ผู้เรียกจะใช้ข้อความสำรอง)
const LABEL: Record<string, string> = {
  share: 'ลิงก์ที่แชร์',
  story_mention: 'ลูกค้ากล่าวถึงเพจในสตอรี่',
  fallback: 'ข้อความที่แชร์',
  template: 'การ์ดข้อความ',
  location: 'ตำแหน่ง',
}
const clean = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function attachmentNote(a: any): string | null {
  const type = clean(a?.type, 40)
  const url = clean(a?.payload?.url ?? a?.url, 500)
  const title = clean(a?.title ?? a?.payload?.title, 200)
  const safeUrl = /^https:\/\//i.test(url) ? url : ''
  if (!LABEL[type] && !safeUrl && !title) return null
  return [`[${LABEL[type] || 'ข้อความแนบ'}]`, title, safeUrl].filter(Boolean).join(' ')
}
