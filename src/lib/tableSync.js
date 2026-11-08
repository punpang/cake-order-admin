import { watch } from 'vue'
import { syncSet, syncOk, syncDrop } from './syncStatus'

// เครื่องยนต์ซิงก์กลาง: โหลดรายการจาก Supabase เข้า db แล้วเขียนกลับเมื่อมีการแก้ (write-through)
// - โหลดไม่สำเร็จ = ไม่เริ่มตัวเขียนกลับ (กันเขียนทับข้อมูลจริงด้วยรายการว่าง/ตัวอย่าง)
// - เทียบกับสแนปช็อตล่าสุด เขียนเฉพาะรายการที่เปลี่ยน/ถูกลบ
export function diffById(snapshot, items) {
  const upserts = []
  const seen = new Set()
  for (const it of items) {
    seen.add(it.id)
    if (snapshot.get(it.id) !== JSON.stringify(it)) upserts.push(it)
  }
  const deletes = [...snapshot.keys()].filter((id) => !seen.has(id))
  return { upserts, deletes }
}

// อ่านทั้งตารางทีละหน้า (PostgREST จำกัด 1000 แถวต่อคำขอ ถ้าไม่แบ่งหน้าข้อมูลที่เกินจะหายเงียบ ๆ)
// make(from, to) ต้องคืน query ที่เรียงลำดับแบบคงที่ (ไม่ซ้ำ) และเรียก .range(from, to) แล้ว
export const PAGE_SIZE = 1000
export async function selectAll(make) {
  const data = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const r = await make(from, from + PAGE_SIZE - 1)
    if (r.error) return { error: r.error }
    data.push(...(r.data || []))
    if ((r.data || []).length < PAGE_SIZE) return { data }
  }
}

// ลองเขียนซ้ำเองเมื่อเขียนไม่สำเร็จ: 5 → 15 → 60 วินาที (ค้างที่ 60)
export const RETRY_MS = [5000, 15000, 60000]
// แอปจริง (staffAuth) เปิดไว้: โหลดไม่สำเร็จ = ล้างรายการตัวอย่างในเครื่อง ไม่ให้ดูเหมือนข้อมูลจริง · ค่าเริ่มต้นปิด (เทสต์/การใช้งานอื่นคงข้อมูลเดิม)
export const syncOptions = { clearOnLoadFail: false }
let syncSeq = 0
export async function startSync({ list, replace, load, push, canWrite, onError = () => {}, label = '', debounceMs = 600, poll = false }) {
  const loaded = await load()
  if (loaded.error) {
    onError(`โหลด${label}จากฐานข้อมูลไม่สำเร็จ: ${loaded.error}`)
    // ไม่แสดงข้อมูลตัวอย่าง/ค่าเริ่มต้นในเครื่องแทนข้อมูลจริง: ล้างรายการ (ยังไม่มีตัวเขียนกลับ จึงไม่กระทบเซิร์ฟเวอร์) แล้วให้แถบเตือนพา "ลองโหลดใหม่"
    if (syncOptions.clearOnLoadFail) { try { replace([]) } catch { /* ข้าม */ } }
    return { stop() {}, loaded: false, label }
  }
  replace(loaded.items)
  const snapshot = new Map(list().map((i) => [i.id, JSON.stringify(i)]))
  const key = label || `ซิงก์${++syncSeq}`
  let timer = null
  let retryTimer = null
  let fails = 0
  let busy = false
  let again = false
  // ดึงข้อมูลล่าสุดจากฐานข้อมูลมาแทนที่ (เมื่อคนอื่น/ลูกค้าแก้) — ทำเฉพาะเมื่อไม่มีการแก้ค้างอยู่ในเครื่อง (กันทับงานที่กำลังแก้)
  // คืน true เมื่อมีการอัปเดตจริง
  const refresh = async () => {
    const dirty = () => { const d = diffById(snapshot, list()); return d.upserts.length || d.deletes.length }
    if (busy || dirty()) return false
    const r = await load()
    if (r.error || busy || dirty()) return false // โหลดไม่สำเร็จ หรือระหว่างโหลดมีการแก้ในเครื่อง → รอบหน้า
    const remote = diffById(snapshot, r.items)
    if (!remote.upserts.length && !remote.deletes.length) return false
    replace(r.items, { refresh: true })
    snapshot.clear()
    for (const i of list()) snapshot.set(i.id, JSON.stringify(i))
    return true
  }
  if (!canWrite) return { stop() {}, loaded: true, label, refresh: poll ? refresh : undefined }
  // คืน true เมื่อไม่มีอะไรค้าง/เขียนสำเร็จ · false เมื่อเขียนล้มเหลวหรือกำลังเขียนอยู่ (ให้ผู้เรียกที่ต้องเรียงลำดับรอแล้วลองใหม่)
  const flush = async () => {
    if (busy) { again = true; return false }
    clearTimeout(retryTimer); clearTimeout(timer)
    busy = true
    let ok = true
    const changes = diffById(snapshot, list())
    if (changes.upserts.length || changes.deletes.length) {
      syncSet(key, 'saving', '', flush)
      const r = await push(changes)
      if (r.error) {
        ok = false
        if (fails === 0) onError(`บันทึก${label}ไม่สำเร็จ: ${r.error}`) // แจ้งครั้งแรกของชุดที่ล้มเหลว (รอบลองซ้ำไม่แจ้งซ้ำ)
        syncSet(key, 'failed', r.error, flush)
        retryTimer = setTimeout(flush, RETRY_MS[Math.min(fails, RETRY_MS.length - 1)])
        fails++
      } else {
        for (const it of changes.upserts) snapshot.set(it.id, JSON.stringify(it))
        for (const id of changes.deletes) snapshot.delete(id)
        fails = 0
        syncOk(key)
      }
    } else if (fails) { fails = 0; syncOk(key) } else syncOk(key)
    busy = false
    if (again) { again = false; flush() }
    return ok
  }
  const stopWatch = watch(() => JSON.stringify(list()), () => {
    clearTimeout(timer)
    const d = diffById(snapshot, list())
    if (d.upserts.length || d.deletes.length) syncSet(key, busy ? 'saving' : 'pending', '', flush) // เปลี่ยนจากการรีเฟรชของเซิร์ฟเวอร์ ไม่นับเป็นรอบันทึก
    timer = setTimeout(flush, debounceMs)
  })
  return { stop() { stopWatch(); clearTimeout(timer); clearTimeout(retryTimer); syncDrop(key) }, loaded: true, label, flush, refresh: poll ? refresh : undefined }
}
