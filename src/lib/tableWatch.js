// ฟังการเปลี่ยนแปลงของตารางด้วย Realtime (postgres_changes) · RLS ของฐานข้อมูลกำหนดว่าพนักงานเห็นแถวไหนได้
// คืน { stop, isLive } · ไม่มีการเชื่อมต่อ = isLive false (ผู้เรียกต้องโพลล์สำรองเอง)
let seq = 0
export function startTableWatch(client, { table, event = '*', filter = '' }, onChange) {
  if (!client?.channel || !table) return { stop() {}, isLive: () => false }
  let live = false
  let stopped = false
  const cfg = { event, schema: 'public', table }
  if (filter) cfg.filter = filter
  const ch = client.channel(`tw-${table}-${++seq}-${Math.random().toString(36).slice(2, 8)}`)
  ch.on('postgres_changes', cfg, (payload) => { if (!stopped) onChange(payload) })
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
