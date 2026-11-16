// เริ่มทำงาน LIFF ของร้าน (ช่อง LINE Login) · LIFF ID ไม่ใช่ความลับ
// ใช้ร่วมกันระหว่างหน้า Endpoint (/line/) และหน้าเชื่อมบัญชีในแอป
export const LIFF_ID = '2012641404-DlSIXAZp'

// คืน { liff, redirecting } · redirecting = กำลังพาไปเข้าสู่ระบบ LINE (เบราว์เซอร์นอกแอป LINE ที่ยังไม่ได้เข้าสู่ระบบ)
// ไม่กำหนด redirectUri เอง: LINE พากลับมาที่ Endpoint URL (/line/) ซึ่งเป็น URL เดียวที่ลงทะเบียนไว้
export async function startLiff(liffId = LIFF_ID) {
  const { default: liff } = await import('@line/liff')
  await liff.init({ liffId })
  if (!liff.isInClient() && !liff.isLoggedIn()) {
    liff.login()
    return { liff, redirecting: true }
  }
  return { liff, redirecting: false }
}
