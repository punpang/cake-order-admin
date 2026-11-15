// สัญญาณ "มีข้อความ/สถานะใหม่" ของแชทลูกค้า: ช่อง Realtime แบบสาธารณะที่มีชื่อสุ่มต่อลูกค้า (ได้จาก chat_list หลังล็อกอิน)
// สัญญาณไม่มีเนื้อหา · ลูกค้าโหลดข้อความจริงจาก chat_list ทุกครั้ง · เชื่อมไม่ได้ = หน้าแชทโพลล์ตามเดิม
export const PING_EVENT = 'msg'
export const LIVE_POLL_MS = 10000 // เชื่อมสัญญาณอยู่ → โพลล์สำรองทุก 10 วินาที (กันสัญญาณหายเงียบ ๆ)

// เริ่มฟังช่องของลูกค้า · onPing() ถูกเรียกเมื่อมีสัญญาณ (ไม่ใช้ข้อมูลในสัญญาณ) · คืน { stop, isLive }
export function startChatPing(client, topic, onPing) {
  if (!client?.channel || !topic) return { stop() {}, isLive: () => false }
  let live = false
  let stopped = false
  const ch = client.channel(topic)
  ch.on('broadcast', { event: PING_EVENT }, () => { if (!stopped) onPing() })
  ch.subscribe((status) => { if (!stopped) live = status === 'SUBSCRIBED' })
  return {
    stop() {
      stopped = true
      live = false
      try { client.removeChannel(ch) } catch { /* ข้าม */ }
    },
    isLive: () => live,
  }
}
