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

export async function startSync({ list, replace, load, push, canWrite, onError = () => {}, label = '', debounceMs = 600 }) {
  const loaded = await load()
  if (loaded.error) { onError(`โหลด${label}จากฐานข้อมูลไม่สำเร็จ: ${loaded.error}`); return { stop() {}, loaded: false } }
  replace(loaded.items)
  const snapshot = new Map(list().map((i) => [i.id, JSON.stringify(i)]))
  if (!canWrite) return { stop() {}, loaded: true }
  let timer = null
  let busy = false
  let again = false
  const flush = async () => {
    if (busy) { again = true; return }
    busy = true
    const changes = diffById(snapshot, list())
    if (changes.upserts.length || changes.deletes.length) {
      const r = await push(changes)
      if (r.error) onError(`บันทึก${label}ไม่สำเร็จ: ${r.error}`)
      else {
        for (const it of changes.upserts) snapshot.set(it.id, JSON.stringify(it))
        for (const id of changes.deletes) snapshot.delete(id)
      }
    }
    busy = false
    if (again) { again = false; flush() }
  }
  const stopWatch = watch(() => JSON.stringify(list()), () => { clearTimeout(timer); timer = setTimeout(flush, debounceMs) })
  return { stop() { stopWatch(); clearTimeout(timer) }, loaded: true, flush }
}
