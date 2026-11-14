// สะพานไปยังอุปกรณ์ของแอป Android (Capacitor): เครื่องพิมพ์ Bluetooth และจอลูกค้า · บนเว็บทุกฟังก์ชันไม่ทำงาน
import { Capacitor, registerPlugin } from '@capacitor/core'

export const isNative = () => Capacitor.isNativePlatform()
const BtPrinter = registerPlugin('BtPrinter')
const CustomerDisplay = registerPlugin('CustomerDisplay')

// ค่าเฉพาะเครื่อง (เลือกเครื่องพิมพ์และขนาดกระดาษ) เก็บในเครื่องนั้น ไม่ใช่ข้อมูลร้าน
const KEY = 'punpang.device.v1'
const DEFAULTS = { printer: null, widthMm: 58 }
export function getDeviceConfig() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }
  } catch {
    return { ...DEFAULTS }
  }
}
export function setDeviceConfig(patch) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...getDeviceConfig(), ...patch }))
  } catch {
    // เก็บไม่ได้ (เช่นโหมดส่วนตัว) ก็ใช้ค่าปัจจุบันต่อไป
  }
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
export async function printBytes(address, bytes) {
  if (!isNative()) throw new Error('พิมพ์ได้เฉพาะแอป Android')
  await BtPrinter.print({ address, data: toBase64(bytes) })
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
