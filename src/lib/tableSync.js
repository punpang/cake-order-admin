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

// เวอร์ชันของแถว (updated_at) แนบกับอ็อบเจกต์แบบไม่นับในข้อมูล (non-enumerable → ไม่เข้า JSON/สแนปช็อต/คอลัมน์ data)
export function withVer(obj, updatedAt) {
  if (updatedAt) Object.defineProperty(obj, '_v', { value: updatedAt, writable: true, enumerable: false, configurable: true })
  return obj
}
// แก้แถวแบบเทียบเวอร์ชัน (compare-and-swap): เขียนเฉพาะเมื่อ updated_at ยังเป็นค่าที่เครื่องนี้อ่านมา
// ไม่ใช้ RETURNING (ผู้มีสิทธิ์เขียนแต่ไม่มีสิทธิ์อ่านแถวจะโดน RLS) → นับแถวด้วย count แล้วอ่านเวอร์ชันใหม่แยก (อ่านไม่ได้ = ไม่มีเวอร์ชัน รอบหน้าเขียนแบบไม่เทียบ)
// คืน { ok, ver } | { conflict: true } | { error }
export async function casUpdate(client, table, id, values, ver) {
  let q = client.from(table).update(values, { count: 'exact' }).eq('id', id)
  if (ver) q = q.eq('updated_at', ver)
  const r = await q
  if (r.error) return { error: r.error }
  if (ver && !r.count) return { conflict: true }
  const v = await client.from(table).select('updated_at').eq('id', id).maybeSingle()
  return { ok: true, ver: v.data?.updated_at || null }
}

// ลองเขียนซ้ำเองเมื่อเขียนไม่สำเร็จ: 5 → 15 → 60 วินาที (ค้างที่ 60)
export const RETRY_MS = [5000, 15000, 60000]
// แอปจริง (staffAuth) เปิดไว้: โหลดไม่สำเร็จ = ล้างรายการตัวอย่างในเครื่อง ไม่ให้ดูเหมือนข้อมูลจริง · ค่าเริ่มต้นปิด (เทสต์/การใช้งานอื่นคงข้อมูลเดิม)
export const syncOptions = { clearOnLoadFail: false }
let syncSeq = 0
export async function startSync({ list, replace, load, push, canWrite, onError = () => {}, label = '', debounceMs = 600, poll = false, loadByIds = null, applyRows = null }) {
  const loaded = await load()
  if (loaded.error) {
    onError(`โหลด${label}จากฐานข้อมูลไม่สำเร็จ: ${loaded.error}`)
    // ไม่แสดงข้อมูลตัวอย่าง/ค่าเริ่มต้นในเครื่องแทนข้อมูลจริง: ล้างรายการ (ยังไม่มีตัวเขียนกลับ จึงไม่กระทบเซิร์ฟเวอร์) แล้วให้แถบเตือนพา "ลองโหลดใหม่"
    if (syncOptions.clearOnLoadFail) { try { replace([]) } catch { /* ข้าม */ } }
    return { stop() {}, loaded: false, label }
  }
  replace(loaded.items)
  let loadedAt = Date.now() // เวลาโหลดสำเร็จล่าสุด (ใช้บอกว่าข้อมูลในเครื่องสดแค่ไหน)
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
    if (!r.error) loadedAt = Date.now()
    if (r.error || busy || dirty()) return false // โหลดไม่สำเร็จ หรือระหว่างโหลดมีการแก้ในเครื่อง → รอบหน้า
    const remote = diffById(snapshot, r.items)
    if (!remote.upserts.length && !remote.deletes.length) return false
    replace(r.items, { refresh: true })
    snapshot.clear()
    for (const i of list()) snapshot.set(i.id, JSON.stringify(i))
    return true
  }
  // รีเฟรชเฉพาะแถวที่ระบุ (จาก Realtime) · คืน true=จัดการแล้ว, false=ให้ผู้เรียกรีเฟรชทั้งตารางแทน
  // แถวที่แก้ค้างในเครื่อง = ข้าม (ไม่ทับงาน) · ไม่ลบแถวใด (ออร์เดอร์ไม่ถูกลบจริง)
  const refreshIds = loadByIds ? async (ids) => {
    if (busy || !ids.length) return false
    const clean = ids.filter((id) => { const cur = list().find((i) => i.id === id); return !cur || snapshot.get(id) === JSON.stringify(cur) })
    if (!clean.length) return true
    const r = await loadByIds(clean)
    if (r.error || busy) return false
    const rows = r.items.filter((it) => { const cur = list().find((i) => i.id === it.id); return !cur || snapshot.get(it.id) === JSON.stringify(cur) }) // ระหว่างโหลดมีแก้ในเครื่อง → ข้ามแถวนั้น
    const arr = list()
    for (const it of rows) {
      const k = arr.findIndex((i) => i.id === it.id)
      if (k >= 0) { if (JSON.stringify(arr[k]) !== JSON.stringify(it)) arr.splice(k, 1, it) } else arr.push(it)
    }
    applyRows?.(rows)
    for (const it of rows) { const cur = arr.find((i) => i.id === it.id); if (cur) snapshot.set(it.id, JSON.stringify(cur)) }
    return true
  } : undefined
  if (!canWrite) return { stop() {}, loaded: true, label, refresh: poll ? refresh : undefined, refreshIds, loadedAt: () => loadedAt }
  // คืน true เมื่อไม่มีอะไรค้าง/เขียนสำเร็จ · false เมื่อเขียนล้มเหลวหรือกำลังเขียนอยู่ (ให้ผู้เรียกที่ต้องเรียงลำดับรอแล้วลองใหม่)
  const flush = async () => {
    if (busy) { again = true; return false }
    clearTimeout(retryTimer); clearTimeout(timer)
    busy = true
    let ok = true
    try {
    const changes = diffById(snapshot, list())
    if (changes.upserts.length || changes.deletes.length) {
      syncSet(key, 'saving', '', flush)
      // จดสถานะที่ "ส่งไป" ก่อน await: ถ้าผู้ใช้แก้ระหว่างรอ จะถือว่ายังไม่ซิงก์ (รอบถัดไปเขียนต่อ) ไม่ใช่ซิงก์แล้ว
      const sent = new Map(changes.upserts.map((it) => [it.id, JSON.stringify(it)]))
      let r
      try { r = await push(changes) } catch (e) { r = { error: String(e?.message || e || 'เขียนไม่สำเร็จ') } }
      if (r.error) {
        ok = false
        if (fails === 0) onError(`บันทึก${label}ไม่สำเร็จ: ${r.error}`) // แจ้งครั้งแรกของชุดที่ล้มเหลว (รอบลองซ้ำไม่แจ้งซ้ำ)
        syncSet(key, 'failed', r.error, flush)
        retryTimer = setTimeout(flush, RETRY_MS[Math.min(fails, RETRY_MS.length - 1)])
        fails++
      } else {
        // แถวที่ถูกเครื่องอื่น/ระบบแก้ไปก่อน (เทียบเวอร์ชันไม่ตรง): ไม่เขียนทับ → โหลดฉบับล่าสุดแทนที่ แล้วแจ้งให้ทำรายการซ้ำ
        const conflicts = r.conflicts || []
        if (conflicts.length) {
          const fresh = loadByIds ? await loadByIds(conflicts) : { error: 'no loader' }
          if (fresh.error) {
            // โหลดไม่สำเร็จ = ยังไม่ตัดสิน: คงแถวไว้ในสถานะรอเขียน แล้วลองใหม่ตามรอบ
            ok = false
            const rows = new Set(conflicts)
            for (const [id, s] of sent) if (!rows.has(id)) snapshot.set(id, s)
            onError(`${label}ถูกแก้ที่อื่น โหลดข้อมูลล่าสุดไม่สำเร็จ: ${fresh.error}`)
            syncSet(key, 'failed', fresh.error, flush)
            retryTimer = setTimeout(flush, RETRY_MS[Math.min(fails, RETRY_MS.length - 1)])
            fails++
            return ok
          }
          const arr = list()
          for (const it of fresh.items) {
            const k = arr.findIndex((i) => i.id === it.id)
            if (k >= 0) arr.splice(k, 1, it); else arr.push(it)
          }
          applyRows?.(fresh.items)
          for (const it of fresh.items) snapshot.set(it.id, JSON.stringify(arr.find((i) => i.id === it.id)))
          onError(`${label}ที่แก้ไว้ถูกแก้ที่อื่นไปก่อน (เช่น ลูกค้าแจ้งชำระ/อีกเครื่องแก้) โหลดข้อมูลล่าสุดแล้ว ตรวจแล้วทำรายการซ้ำอีกครั้ง`)
        }
        for (const [id, s] of sent) if (!conflicts.includes(id)) snapshot.set(id, s)
        for (const id of changes.deletes) snapshot.delete(id)
        fails = 0
        // ระหว่างเขียนมีการแก้ใหม่ → เขียนต่ออีกรอบ
        if (diffById(snapshot, list()).upserts.length) again = true
        syncOk(key)
      }
    } else if (fails) { fails = 0; syncOk(key) } else syncOk(key)
    } finally {
      busy = false
    }
    if (again) { again = false; flush() }
    return ok
  }
  const stopWatch = watch(() => JSON.stringify(list()), () => {
    clearTimeout(timer)
    const d = diffById(snapshot, list())
    if (d.upserts.length || d.deletes.length) syncSet(key, busy ? 'saving' : 'pending', '', flush) // เปลี่ยนจากการรีเฟรชของเซิร์ฟเวอร์ ไม่นับเป็นรอบันทึก
    timer = setTimeout(flush, debounceMs)
  })
  return { stop() { stopWatch(); clearTimeout(timer); clearTimeout(retryTimer); syncDrop(key) }, loaded: true, label, flush, refresh: poll ? refresh : undefined, refreshIds, loadedAt: () => loadedAt }
}
