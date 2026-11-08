import { watch } from 'vue'

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

export async function startSync({ list, replace, load, push, canWrite, onError = () => {}, label = '', debounceMs = 600, poll = false }) {
  const loaded = await load()
  if (loaded.error) { onError(`โหลด${label}จากฐานข้อมูลไม่สำเร็จ: ${loaded.error}`); return { stop() {}, loaded: false } }
  replace(loaded.items)
  const snapshot = new Map(list().map((i) => [i.id, JSON.stringify(i)]))
  let timer = null
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
  if (!canWrite) return { stop() {}, loaded: true, refresh: poll ? refresh : undefined }
  // คืน true เมื่อไม่มีอะไรค้าง/เขียนสำเร็จ · false เมื่อเขียนล้มเหลวหรือกำลังเขียนอยู่ (ให้ผู้เรียกที่ต้องเรียงลำดับรอแล้วลองใหม่)
  const flush = async () => {
    if (busy) { again = true; return false }
    busy = true
    let ok = true
    const changes = diffById(snapshot, list())
    if (changes.upserts.length || changes.deletes.length) {
      const r = await push(changes)
      if (r.error) { onError(`บันทึก${label}ไม่สำเร็จ: ${r.error}`); ok = false }
      else {
        for (const it of changes.upserts) snapshot.set(it.id, JSON.stringify(it))
        for (const id of changes.deletes) snapshot.delete(id)
      }
    }
    busy = false
    if (again) { again = false; flush() }
    return ok
  }
  const stopWatch = watch(() => JSON.stringify(list()), () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush, refresh: poll ? refresh : undefined }
}
