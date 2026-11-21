// สะพานไปยังอุปกรณ์ของแอป Android (Capacitor): เครื่องพิมพ์ Bluetooth และจอลูกค้า · บนเว็บทุกฟังก์ชันไม่ทำงาน
import { Capacitor, registerPlugin } from '@capacitor/core'
import { DEVICE_KEY, LEGACY_DEVICE_KEY, defaultDevice, normalizeDevice, migrateDevice, printerFor, autoPrintFor } from './printConfig'

export const isNative = () => Capacitor.isNativePlatform()
const BtPrinter = registerPlugin('BtPrinter')
const CustomerDisplay = registerPlugin('CustomerDisplay')

// ค่าเฉพาะเครื่องนี้ (เครื่องพิมพ์ของแต่ละส่วน ความกว้าง พิมพ์อัตโนมัติ) เก็บในเครื่อง ไม่ใช่ข้อมูลร้าน · รายละเอียดใน printConfig.js
export function getDevice() {
  try {
    const raw = localStorage.getItem(DEVICE_KEY)
    if (raw != null) return normalizeDevice(JSON.parse(raw))
    // ครั้งแรกของเวอร์ชันนี้: ย้ายค่าเดิม (ไม่ลบคีย์เดิม เพื่อย้อนกลับได้)
    return normalizeDevice(migrateDevice(JSON.parse(localStorage.getItem(LEGACY_DEVICE_KEY) || 'null')))
  } catch {
    return defaultDevice()
  }
}
// แก้ค่าเฉพาะเครื่อง: fn รับสำเนาที่แก้ได้ · คืนค่าที่บันทึกแล้ว (เก็บไม่ได้ เช่นโหมดส่วนตัว ก็ใช้ค่าปัจจุบันต่อไป)
export function updateDevice(fn) {
  const d = getDevice()
  fn(d)
  const next = normalizeDevice(d)
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify(next))
  } catch {
    // เก็บไม่ได้ก็ใช้ค่าปัจจุบันต่อไป
  }
  return next
}
export const hasPrinter = (section) => !!printerFor(getDevice(), section)?.address
export const canAutoPrint = (section) => {
  const d = getDevice()
  return autoPrintFor(d, section) && !!printerFor(d, section)?.address
}

// เครื่องพิมพ์ที่จับคู่ Bluetooth ไว้แล้วในเครื่อง Android
export async function listPrinters() {
  if (!isNative()) return []
  const r = await BtPrinter.list()
  return Array.isArray(r?.devices) ? r.devices : []
}

const toBase64 = (bytes) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x2000) s += String.fromCharCode(...bytes.subarray(i, i + 0x2000))
  return btoa(s)
}
// งาน Bluetooth ทีละงาน (เครื่องพิมพ์รับทีละการเชื่อมต่อ) · งานก่อนหน้าล้มเหลวก็ยังส่งงานถัดไปต่อ
let printQueue = Promise.resolve()
export function printBytes(address, bytes) {
  if (!isNative()) return Promise.reject(new Error('พิมพ์ได้เฉพาะแอป Android'))
  const job = printQueue.then(() => BtPrinter.print({ address, data: toBase64(bytes) }))
  printQueue = job.catch(() => {})
  return job
}

// จอลูกค้า (จอที่สองของเครื่อง)
export async function displayCount() {
  if (!isNative()) return 0
  const r = await CustomerDisplay.available()
  return r?.count || 0
}
export async function showDisplay() {
  if (!isNative()) return
  await CustomerDisplay.show()
}
export async function hideDisplay() {
  if (!isNative()) return
  await CustomerDisplay.hide()
}
let lastJson = ''
export function pushDisplay(state) {
  if (!isNative()) return
  const json = JSON.stringify(state)
  if (json === lastJson) return
  lastJson = json
  CustomerDisplay.update({ json }).catch(() => {})
}
