// Supabase Realtime: ฟังการเปลี่ยนแปลงของตาราง แล้วสั่ง "refresh เดิม" (ไม่ apply payload ตรง)
// → คงกติกาเดิมทั้งหมด: ข้ามเมื่อมีแก้ค้างในเครื่อง · เทียบ diff · ผลข้างเคียงของแชท/ใบเสนอ
// bindings: [{ table, filter?, key }]  ·  onEvent(key, payload) = ผู้เรียกตัดสินใจว่าจะ refresh อะไร
import { syncRealtime } from './syncStatus'

const GRACE_MS = 8000 // หลุดเกินนี้ถึงจะแสดงว่า "ไม่เรียลไทม์"

export function startRealtime({ client, name, bindings, onEvent, onLive, onDown }) {
  if (!client?.channel) return { stop() {} }
  let stopped = false
  let wasLive = false
  let downTimer = null
  const ch = client.channel(name)
  for (const b of bindings) {
    const cfg = { event: '*', schema: 'public', table: b.table }
    if (b.filter) cfg.filter = b.filter
    ch.on('postgres_changes', cfg, (payload) => { if (!stopped) onEvent(b.key, payload) })
  }
  const markDown = () => {
    if (stopped) return
    if (wasLive) { wasLive = false; onDown?.() }
    if (syncRealtime.state === 'live') syncRealtime.state = 'connecting'
    clearTimeout(downTimer)
    downTimer = setTimeout(() => { if (!stopped && !wasLive) syncRealtime.state = 'down' }, GRACE_MS)
  }
  syncRealtime.state = 'connecting'
  ch.subscribe((status) => {
    if (stopped) return
    if (status === 'SUBSCRIBED') {
      clearTimeout(downTimer)
      const reconnect = syncRealtime.everLive
      wasLive = true
      syncRealtime.state = 'live'
      syncRealtime.everLive = true
      syncRealtime.lastLiveAt = Date.now()
      onLive?.(reconnect) // reconnect = true → ต้อง catch-up (อาจพลาด event ระหว่างหลุด)
    } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') markDown()
  })
  return {
    stop() {
      stopped = true
      clearTimeout(downTimer)
      try { client.removeChannel(ch) } catch { /* ข้าม */ }
      syncRealtime.state = 'off'
      syncRealtime.everLive = false
    },
  }
}

// ตัวหน่วงแบบ trailing + รวมเหตุการณ์ (key เดียวกันที่มาถี่ ๆ รันครั้งเดียว) · เวลาห่างขั้นต่ำระหว่างรอบ
export function makeDebouncer(run, { wait = 400, minGap = 1500, now = () => Date.now() } = {}) {
  const timers = new Map()
  const last = new Map()
  const fire = (key) => { timers.delete(key); last.set(key, now()); run(key) }
  const hit = (key, ms = wait) => {
    if (timers.has(key)) return
    const gap = Math.max(0, (last.get(key) || 0) + minGap - now())
    timers.set(key, setTimeout(() => fire(key), Math.max(ms, gap)))
  }
  hit.cancel = () => { for (const t of timers.values()) clearTimeout(t); timers.clear() }
  return hit
}
