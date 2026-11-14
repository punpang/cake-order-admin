// แจ้งเตือนระบบบนแอป Android (พนักงาน): ขอสิทธิ์ → ลงทะเบียนโทเค็น FCM → เก็บลงฐานข้อมูลผ่าน RPC
// เว็บเบราว์เซอร์ไม่ทำอะไร · กดแจ้งเตือนแล้วไปหน้าที่เกี่ยวข้อง (path มาจากเซิร์ฟเวอร์ ยอมรับเฉพาะที่ขึ้นต้นด้วย /admin)
import { Capacitor } from '@capacitor/core'
import { getSupabase } from './supabase'

const KEY = 'punpang.push.token.v1'
const CHANNEL = 'staff-alerts'
let started = false

const native = () => Capacitor.isNativePlatform()

async function register(token) {
  const client = await getSupabase()
  if (!client || !token) return
  const { error } = await client.rpc('punpang_register_push_token', { p_token: token })
  if (!error) {
    try { localStorage.setItem(KEY, token) } catch { /* ไม่มีที่เก็บในเครื่อง ไม่กระทบการใช้งาน */ }
  }
}

async function openPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/admin')) return
  const { default: router } = await import('../router')
  router.push(path)
}

// เรียกหลังพนักงานเข้าสู่ระบบ (หรือเปิดแอปที่ยังล็อกอินค้างไว้) · เรียกซ้ำได้ ทำงานครั้งเดียวต่อรอบการใช้งาน
export async function startPush() {
  if (!native() || started) return
  started = true
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    let perm = await PushNotifications.checkPermissions()
    if (perm.receive !== 'granted') perm = await PushNotifications.requestPermissions()
    if (perm.receive !== 'granted') { started = false; return }
    await PushNotifications.createChannel({
      id: CHANNEL,
      name: 'แจ้งเตือนพนักงาน',
      description: 'ออร์เดอร์ใหม่ ลูกค้าแจ้งโอน แชทใหม่ งานใกล้เวลาต้องเสร็จ',
      importance: 5,
      visibility: 1,
    })
    await PushNotifications.removeAllListeners()
    PushNotifications.addListener('registration', (t) => { register(t.value) })
    PushNotifications.addListener('pushNotificationActionPerformed', (a) => { openPath(a.notification?.data?.path) })
    await PushNotifications.register()
  } catch {
    started = false
  }
}

// เรียก "ก่อน" ออกจากระบบ (ต้องยังมีเซสชันอยู่): ลบโทเค็นของเครื่องนี้ออกจากฐานข้อมูล
// เพื่อไม่ให้แจ้งเตือนไปถึงคนที่ออกจากระบบแล้ว
export async function stopPush() {
  if (!native()) return
  started = false
  let token = null
  try { token = localStorage.getItem(KEY) } catch { /* ข้าม */ }
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications')
    await PushNotifications.removeAllListeners()
  } catch { /* ข้าม */ }
  if (!token) return
  const client = await getSupabase()
  if (client) await client.from('punpang_push_devices').delete().eq('token', token)
  try { localStorage.removeItem(KEY) } catch { /* ข้าม */ }
}
