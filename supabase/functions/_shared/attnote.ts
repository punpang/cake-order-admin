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
const httpsOf = (u: unknown) => { const v = clean(u, 500); return /^https:\/\//i.test(v) ? v : '' }

// ค้นชื่อและลิงก์ในโครงสร้างไฟล์แนบ (title / subtitle / text / name และ url) ลึกไม่เกิน 5 ชั้น
// การ์ดข้อความอาจเก็บชื่อและลิงก์ไว้คนละที่ จึงไม่ยึดตำแหน่งเดียว
function findFields(node: any, out: { texts: string[]; urls: string[] } = { texts: [], urls: [] }, depth = 0) {
  if (!node || typeof node !== 'object' || depth > 5) return out
  for (const [k, v] of Object.entries(node)) {
    if (typeof v === 'string') {
      if (['title', 'subtitle', 'text', 'name'].includes(k)) out.texts.push(v)
      else if (k === 'url' || k === 'URL') out.urls.push(v)
    } else if (v && typeof v === 'object') findFields(v, out, depth + 1)
  }
  return out
}

export function attachmentNote(a: any): string | null {
  const type = clean(a?.type, 40)
  const found = findFields(a)
  const texts = [...new Set([a?.title, ...found.texts].map((t) => clean(t, 200)).filter(Boolean))]
  const url = [a?.payload?.url ?? a?.url, ...found.urls].map(httpsOf).find(Boolean) || ''
  if (!LABEL[type] && !url && !texts.length) return null
  const text = texts.join(' · ').slice(0, 240)
  return [`[${LABEL[type] || 'ข้อความแนบ'}]`, text, url].filter(Boolean).join(' ')
}

// โครงไฟล์แนบ: ชื่อคีย์และชนิดของค่าเท่านั้น ไม่มีเนื้อหา · ใช้บันทึกเมื่อดึงชื่อการ์ดไม่ได้ เพื่อดูว่าโครงต่างจากที่คาดไว้
export function attachmentShape(v: any, depth = 0): unknown {
  if (depth > 8) return '…'
  if (Array.isArray(v)) return v.slice(0, 3).map((x) => attachmentShape(x, depth + 1))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 30).map(([k, x]) => [k, attachmentShape(x, depth + 1)]))
  return v === null ? null : typeof v
}
