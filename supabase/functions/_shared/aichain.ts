// ลำดับผู้ตอบของบอท AI: Workers AI ก่อน → Claude สำรอง (ฟังก์ชันล้วน ไม่แตะฐานข้อมูล)
// เปิดปิดแยกกันได้ · เพดานต่อวันแยกตามผู้ให้บริการ (Claude ใช้ตัวนับเดิมของวัน · Workers AI ใช้ตัวนับ "วัน:wai")
// ไม่มีผู้ให้บริการที่เปิดและมีคีย์ → คืนรายการว่าง (บอทส่งต่อพนักงาน)

export const DEFAULT_WAI_MODEL = '@cf/openai/gpt-oss-120b'
const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5'

export type AiStep = { provider: 'workers' | 'anthropic'; model: string; limit: number; usageKey: string }

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

// ชื่อโมเดลต้องเป็นตัวอักษรที่ใช้ในเส้นทาง URL ได้เท่านั้น (กันค่าแปลก ๆ จากการแก้ config โดยตรง)
const safeModel = (v: unknown, d: string) => {
  const s = String(v ?? '').replace(/[^A-Za-z0-9@/._-]/g, '').slice(0, 80)
  return s || d
}

// avail = ผู้ให้บริการที่มีคีย์/รหัสบัญชีพร้อมใช้งานในสภาพแวดล้อมนี้
export function aiChainOf(cfg: any, avail: { workers: boolean; anthropic: boolean }, day: string): AiStep[] {
  const steps: AiStep[] = []
  if (!cfg || cfg.enabled !== true) return steps
  if (cfg.waiEnabled === true && avail.workers) {
    steps.push({ provider: 'workers', model: safeModel(cfg.waiModel, DEFAULT_WAI_MODEL), limit: clampInt(cfg.waiDailyLimit, 0, 1000, 0), usageKey: `${day}:wai` })
  }
  if (cfg.claudeEnabled !== false && avail.anthropic) {
    steps.push({ provider: 'anthropic', model: safeModel(cfg.model, DEFAULT_CLAUDE_MODEL), limit: clampInt(cfg.dailyLimit, 0, 1000, 0), usageKey: day })
  }
  return steps
}
