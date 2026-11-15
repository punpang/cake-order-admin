// ชื่อช่องสัญญาณ (ลูกค้า/ออร์เดอร์) · สุ่ม 192 บิต เดาไม่ได้ · ส่งให้ลูกค้าเฉพาะหลังยืนยันสิทธิ์ (เซสชันหรือโทเคนลิงก์)
export const CHAT_TOPIC_RE = /^chat-[0-9a-f]{48}$/

export function newTopic(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `${prefix}-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}

export const newChatTopic = (): string => newTopic('chat')
