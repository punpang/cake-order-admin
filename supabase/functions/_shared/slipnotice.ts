// แจ้งลูกค้าทาง Facebook เมื่อส่งสลิปผ่านหน้าออร์เดอร์/บัญชี (ฟังก์ชันล้วน · ทดสอบได้)
// ใช้กติกา slip_received ของร้าน (ถ้ายังไม่ได้บันทึกกติกานี้ ใช้ค่าเริ่มต้นด้านล่าง) · ส่งเฉพาะ Facebook
// Facebook ส่งข้อความได้เฉพาะภายใน 24 ชม. หลังลูกค้าทักล่าสุด (นโยบายของ Meta)
export const SLIP_RECEIVED_TPL = 'ร้านได้รับสลิปการชำระเงินของออร์เดอร์ {เลขออร์เดอร์} ยอด {ยอดที่แจ้ง} บาทแล้วค่ะ ร้านจะตรวจสอบและยืนยันให้เร็ว ๆ นี้ ขอบคุณค่ะ'
export const FB_WINDOW_MS = 24 * 3600e3

type Cfg = { integrations?: any; notifyRules?: any }
const slipRule = (cfg: Cfg) => (Array.isArray(cfg.notifyRules) ? cfg.notifyRules : []).find((r: any) => r?.event === 'slip_received')

// เปิดส่งหรือไม่: ร้านปิดช่อง Facebook → ไม่ส่ง · กติกาถูกปิด หรือไม่รวม Facebook → ไม่ส่ง · ยังไม่มีกติกา = ส่ง
// LINE เป็นช่องที่ร้านต้องเปิดเองในกติกา (ยังไม่มีกติกา = ไม่ส่ง) · Facebook คงพฤติกรรมเดิม (ยังไม่มีกติกา = ส่ง)
export function slipNoticeOnFor(cfg: Cfg, channel: 'facebook' | 'line'): boolean {
  if (cfg.integrations?.[channel]?.enabled === false) return false
  const rule = slipRule(cfg)
  if (!rule) return channel === 'facebook'
  return rule.enabled !== false && Array.isArray(rule.channels) && rule.channels.includes(channel)
}
export function slipNoticeOn(cfg: Cfg): boolean {
  return slipNoticeOnFor(cfg, 'facebook')
}

// ข้อความจากกติกาที่ร้านบันทึก (ถ้ายังไม่มี ใช้ค่าเริ่มต้น)
export function slipNoticeTemplate(cfg: Cfg): string {
  const rule = slipRule(cfg)
  return typeof rule?.template === 'string' && rule.template.trim() ? rule.template : SLIP_RECEIVED_TPL
}

export function renderSlipNotice(tpl: string, v: { code: string; amount: number; name?: string }): string {
  return tpl
    .replaceAll('{เลขออร์เดอร์}', v.code)
    .replaceAll('{ยอดที่แจ้ง}', Number(v.amount).toFixed(2))
    .replaceAll('{ชื่อลูกค้า}', v.name || '')
}

// อยู่ในช่วง 24 ชม. หลังลูกค้าทักล่าสุดหรือไม่ (ไม่มีเวลาทัก = ไม่อยู่ในช่วง)
export function inFbWindow(lastInboundAt: string | null | undefined, nowMs: number): boolean {
  const t = lastInboundAt ? new Date(lastInboundAt).getTime() : 0
  return t > 0 && nowMs - t <= FB_WINDOW_MS
}
