// แจ้งเตือนบนแอป Android (ลูกค้า) เมื่อร้านตอบกลับในแชท: ขอสิทธิ์ → ลงทะเบียนโทเค็น FCM กับเซสชันของลูกค้า
// เรียกตอนลูกค้าเปิดแท็บแชท (ลูกค้าจะได้รับการตอบกลับก็ต่อเมื่อส่งข้อความไปแล้ว) · เว็บเบราว์เซอร์ไม่ทำอะไร
// กดแจ้งเตือนแล้วไปหน้าบัญชี (path มาจากเซิร์ฟเวอร์ ยอมรับเฉพาะ /account)
import { Capacitor } from '@capacitor/core'
import { remoteChat } from './customerOrderRemote'

const CHANNEL = 'customer-alerts'
let busy = false
let listening = false

async function register(token) {
  // ไม่สำเร็จ (เครือข่าย/เซสชัน) ไม่ต้องทำอะไร · เปิดแท็บแชทครั้งหน้าจะลงทะเบียนใหม่
  try { await remoteChat('push_register', { pushToken: token }) } catch { /* ข้าม */ }
}

async function openPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/account')) return
  const { default: router } = await import('../router')
  router.push(path)
}

// เรียกทุกครั้งที่เปิดแท็บแชท (หลังล็อกอิน) · เรียกซ้ำได้ ไม่ซ้อนกัน · ความล้มเหลวไม่กระทบการใช้แชท
export async function startCustomerPush() {
  if (!Capacitor.isNativePlatform() || busy) return
  busy = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') return
    await PushNotifications.createChannel({
      id: CHANNEL,
      name: 'แจ้งเตือนจากร้าน',
      description: 'ร้านตอบกลับข้อความในแชท',
      importance: 4,
      visibility: 1,
    })
    if (!listening) {
      listening = true
      PushNotifications.addListener('registration', (t) => { register(t.value) })
      PushNotifications.addListener('pushNotificationActionPerformed', (a) => { openPath(a.notification?.data?.path) })
    }
    // เรียกซ้ำเพื่อให้โทเค็นผูกกับเซสชันที่ล็อกอินอยู่ตอนนี้ (เครื่องเดิมที่ล็อกอินบัญชีอื่นภายหลัง)
    await PushNotifications.register()
  } catch {
    // ไม่กระทบการใช้แชท
  } finally {
    busy = false
  }
}
