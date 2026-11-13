// เรียกเซิร์ฟเวอร์ไฟล์ (Worker punpang-files บน R2) จากฟังก์ชันของ Supabase
// ไฟล์ใหม่ทั้งหมดเก็บที่ R2 ผ่าน Worker เท่านั้น · อ้างอิงของ R2 = r2://private/<key>
// Secrets ที่ต้องตั้งในฟังก์ชัน: FILES_URL (URL ของ Worker) และ FILES_SERVICE_KEY (ค่าเดียวกับ Secret FILES_SERVICE_KEY ของ Worker)
export const R2_REF = 'r2://private/'
export const isR2Ref = (v: unknown): v is string => typeof v === 'string' && v.startsWith(R2_REF)
export const keyOfR2Ref = (ref: string): string => ref.slice(R2_REF.length)

export type FilesEnv = { url: string; key: string; fetchImpl?: typeof fetch }
// ค่าจาก Deno.env (ฟังก์ชันจริง)
export const filesEnv = (): FilesEnv => ({ url: (Deno.env.get('FILES_URL') || '').replace(/\/$/, ''), key: Deno.env.get('FILES_SERVICE_KEY') || '' })

// อัปโหลดรูปไป R2 ใต้ prefix (<orderId> · staff/<psid> · manual/<chatId> · train) · คืน key และ ref · ล้มเหลว = โยน error
export async function svcUpload(f: FilesEnv, bytes: Uint8Array, prefix: string): Promise<{ key: string; ref: string }> {
  if (!f.url || !f.key) throw new Error('ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์ไฟล์')
  const doFetch = f.fetchImpl ?? fetch
  const res = await doFetch(`${f.url}/svc/upload?bucket=private&prefix=${encodeURIComponent(prefix)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${f.key}`, 'Content-Type': 'application/octet-stream' },
    body: new Uint8Array(bytes),
    signal: AbortSignal.timeout(20_000),
  })
  const j: any = await res.json().catch(() => ({}))
  if (!res.ok || typeof j?.ref !== 'string' || typeof j?.key !== 'string') throw new Error(`${j?.error || 'อัปโหลดรูปไม่สำเร็จ'} (HTTP ${res.status})`)
  return { key: j.key, ref: j.ref }
}

// ลิงก์ชั่วคราวของไฟล์ส่วนตัว (Worker ออกลายเซ็นให้) · ล้มเหลว = null
export async function svcSign(f: FilesEnv, key: string, ttl = 3600): Promise<string | null> {
  if (!f.url || !f.key) return null
  const doFetch = f.fetchImpl ?? fetch
  try {
    const res = await doFetch(`${f.url}/svc/sign`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, ttl }),
      signal: AbortSignal.timeout(10_000),
    })
    const j: any = await res.json().catch(() => ({}))
    return res.ok && typeof j?.url === 'string' ? j.url : null
  } catch {
    return null
  }
}

// ลบไฟล์ที่เพิ่งอัปโหลดแต่ไม่ได้ใช้ (ลบไม่สำเร็จไม่กระทบข้อมูล) · คืน true เมื่อสำเร็จ
export async function svcDelete(f: FilesEnv, keys: string[]): Promise<boolean> {
  if (!f.url || !f.key || keys.length === 0) return false
  const doFetch = f.fetchImpl ?? fetch
  try {
    const res = await doFetch(`${f.url}/svc/delete`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${f.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys }),
      signal: AbortSignal.timeout(10_000),
    })
    return res.ok
  } catch {
    return false
  }
}
