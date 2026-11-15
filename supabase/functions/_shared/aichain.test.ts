// ทดสอบลำดับผู้ตอบของบอท AI: Workers AI ก่อน → Claude สำรอง · เปิดปิดแยกกัน · เพดานนับแยกตามผู้ให้บริการ
import { assertEquals } from 'jsr:@std/assert@1'
import { aiChainOf, DEFAULT_WAI_MODEL } from './aichain.ts'

const DAY = '2026-11-15'
const ON = { enabled: true, waiEnabled: true, waiModel: '@cf/openai/gpt-oss-120b', waiDailyLimit: 50, model: 'claude-sonnet-5-5', dailyLimit: 50, claudeEnabled: true }
const BOTH = { workers: true, anthropic: true }

Deno.test('ปิดบอท AI → ไม่มีผู้ตอบเลย', () => {
  assertEquals(aiChainOf({ ...ON, enabled: false }, BOTH, DAY), [])
  assertEquals(aiChainOf(undefined, BOTH, DAY), [])
})

Deno.test('เปิดทั้งสอง → Workers AI ก่อน แล้ว Claude สำรอง และนับเพดานคนละตัวนับ', () => {
  const steps = aiChainOf(ON, BOTH, DAY)
  assertEquals(steps.map((s) => [s.provider, s.usageKey, s.limit]), [['workers', `${DAY}:wai`, 50], ['anthropic', DAY, 50]])
})

Deno.test('ปิด Workers AI → เหลือ Claude อย่างเดียว', () => {
  assertEquals(aiChainOf({ ...ON, waiEnabled: false }, BOTH, DAY).map((s) => s.provider), ['anthropic'])
})

Deno.test('ปิด Claude → เหลือ Workers AI อย่างเดียว', () => {
  assertEquals(aiChainOf({ ...ON, claudeEnabled: false }, BOTH, DAY).map((s) => s.provider), ['workers'])
})

Deno.test('ไม่มีคีย์/รหัสบัญชีของผู้ให้บริการใด → ตัดออกจากลำดับ', () => {
  assertEquals(aiChainOf(ON, { workers: false, anthropic: true }, DAY).map((s) => s.provider), ['anthropic'])
  assertEquals(aiChainOf(ON, { workers: true, anthropic: false }, DAY).map((s) => s.provider), ['workers'])
  assertEquals(aiChainOf(ON, { workers: false, anthropic: false }, DAY), [])
})

Deno.test('ค่าเก่าที่ยังไม่มี claudeEnabled → ถือว่าเปิด Claude (เข้ากันได้กับค่าเดิม)', () => {
  const old = { enabled: true, model: 'claude-sonnet-5-5', dailyLimit: 50 }
  assertEquals(aiChainOf(old, { workers: false, anthropic: true }, DAY).map((s) => s.provider), ['anthropic'])
})

Deno.test('เพดานถูกจำกัดช่วง 0–1000 และไม่ตั้งค่าไว้ = 0 (ไม่เรียก)', () => {
  const steps = aiChainOf({ ...ON, waiDailyLimit: 9999, dailyLimit: undefined }, BOTH, DAY)
  assertEquals([steps[0].limit, steps[1].limit], [1000, 0])
})

Deno.test('ชื่อโมเดลว่างใช้ค่าเริ่มต้น และตัดอักขระที่ไม่ใช่ชื่อโมเดลออก', () => {
  assertEquals(aiChainOf({ ...ON, waiModel: '' }, BOTH, DAY)[0].model, DEFAULT_WAI_MODEL)
  assertEquals(aiChainOf({ ...ON, waiModel: '@cf/meta/x?y=1 &z' }, BOTH, DAY)[0].model, '@cf/meta/xy1z')
  assertEquals(aiChainOf({ ...ON, model: '' }, BOTH, DAY)[1].model, 'claude-sonnet-5-5')
})
