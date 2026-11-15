// ชื่อช่องสัญญาณ "มีข้อความใหม่" ของลูกค้า · สุ่มต่อลูกค้า 192 บิต เดาไม่ได้ · ส่งให้ลูกค้าเฉพาะหลังล็อกอิน (chat_list)
export const CHAT_TOPIC_RE = /^chat-[0-9a-f]{48}$/

export function newChatTopic(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return `chat-${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
