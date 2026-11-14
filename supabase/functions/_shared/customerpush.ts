// ลงทะเบียนโทเค็น FCM ของแอปลูกค้า (Android) ผูกกับเซสชันที่ล็อกอินอยู่
// ออกจากระบบ / หมดอายุ / ออกจากเครื่องอื่น → เซสชันถูกลบ → โทเค็นถูกลบตามอัตโนมัติ (on delete cascade) จึงไม่มีแจ้งเตือนค้างหลังออกจากระบบ
type Json = Record<string, any>

// โทเค็น FCM เป็นสตริงอักขระที่พิมพ์ได้ ไม่มีช่องว่าง ยาวไม่เกิน 4096 · ค่าอื่นไม่รับ
export function cleanPushToken(v: unknown): string | null {
  const t = String(v ?? '').trim()
  return /^[\x21-\x7e]{20,4096}$/.test(t) ? t : null
}

// ลงทะเบียนโทเค็นของเครื่องนี้ให้เซสชันปัจจุบัน · เครื่องเดิมที่ล็อกอินบัญชีอื่นภายหลัง → โทเค็นย้ายมาเป็นของบัญชีนี้ (upsert ตามโทเค็น)
export async function customerPushRegister(sb: any, customerId: string, sessionHash: string, rawToken: unknown): Promise<{ status: number; body: Json }> {
  const token = cleanPushToken(rawToken)
  if (!token) return { status: 400, body: { error: 'โทเค็นแจ้งเตือนไม่ถูกต้อง' } }
  const r = await sb.from('punpang_customer_push_devices').upsert(
    { token, customer_id: customerId, session_hash: sessionHash, platform: 'android', updated_at: new Date().toISOString() },
    { onConflict: 'token' },
  )
  if (r?.error) {
    // เซสชันถูกลบระหว่างทาง (ออกจากระบบแล้ว) → ให้เข้าสู่ระบบใหม่ (23503 = foreign key ไม่พบ)
    if (r.error.code === '23503') return { status: 401, body: { error: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่' } }
    return { status: 500, body: { error: 'ลงทะเบียนแจ้งเตือนไม่สำเร็จ' } }
  }
  return { status: 200, body: { ok: true } }
}
