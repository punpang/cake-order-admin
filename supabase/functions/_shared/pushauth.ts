// ตรวจคีย์ของคำขอแจ้งเตือน push (push-send): ทริกเกอร์ของฐานข้อมูลส่งคีย์จาก Vault ในหัว x-push-key
// ไม่ได้ตั้งคีย์ไว้ในฟังก์ชัน = ปฏิเสธทุกคำขอ (ปลอดภัยไว้ก่อน) · เทียบแบบไม่ขึ้นกับตำแหน่งที่ต่างกัน

export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let d = 0
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return d === 0
}

export type PushAuth = 'ok' | 'not-configured' | 'forbidden'

export function checkPushKey(expected: string, provided: string | null): PushAuth {
  const e = expected.trim()
  if (!e) return 'not-configured'
  return sameSecret(e, provided ?? '') ? 'ok' : 'forbidden'
}
