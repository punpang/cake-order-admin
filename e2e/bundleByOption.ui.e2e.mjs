// ทดสอบหน้าบันเดิ้ลตามตัวเลือกรอง (/admin/settings/bundles/by-option) ในเบราว์เซอร์จริง · ใช้ข้อมูลจำลองในหน่วยความจำเท่านั้น
// ตรวจ: เลือกตัวเลือกแล้วเห็นชุดที่ผูกอยู่ครบ · สร้างชุดข้ามตัวเลือกหลายตัวได้ · แก้ส่วนลดของชุดเดิมได้ · ไม่มี pageerror · ไม่ล้นจอมือถือ
// รัน: node e2e/bundleByOption.ui.e2e.mjs
import { fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createServer } from 'vite'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const server = await createServer({ root: ROOT, logLevel: 'error', server: { host: '127.0.0.1', port: 0, strictPort: false } })
await server.listen()
const base = server.resolvedUrls.local[0].replace(/\/$/, '')
const browser = await chromium.launch({ args: process.getuid?.() === 0 ? ['--no-sandbox'] : [] })
const cases = []
const t = (name, fn) => cases.push([name, fn])
let fails = 0

async function open(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/bundles/by-option`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForSelector('[data-option-picker]', { timeout: 15000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

t('เลือกตัวเลือกแล้วเห็นชุดที่ผูกอยู่ครบ และไม่ล้นจอมือถือ', async () => {
  const { page, errors } = await open({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const pick = await page.evaluate(() => {
    const S = window.__store
    const g = S.db.optionGroups.find((x) => x.id === 'g_topping')
    const o = g.options.find((x) => x.active !== false)
    const expected = S.db.bundles.filter((b) => (b.items || []).some((i) => i.groupId === 'g_topping' && i.optionId === o.id)).length
    return { name: o.name, expected }
  })
  await page.getByRole('button', { name: pick.name, exact: true }).click()
  assert.equal(await page.locator('[data-bundle]').count(), pick.expected)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(overflow <= 0, `หน้าล้นแนวนอน ${overflow}px`)
  assert.deepEqual(errors, [])
  await page.close()
})

t('สร้างชุดข้ามตัวเลือกหลายตัวจากตัวเลือกที่เลือก แล้วบันทึกได้', async () => {
  const { page, errors } = await open({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const plan = await page.evaluate(async () => {
    const S = window.__store
    const { findDuplicate } = await import('/src/lib/bundleEditor.js')
    const sizeId = S.db.optionGroups.find((x) => x.key === 'size').options.find((o) => o.active !== false).id
    const g = S.db.optionGroups.find((x) => x.id === 'g_topping')
    const opts = g.options.filter((o) => o.active !== false)
    const it = (o) => ({ groupId: 'g_topping', optionId: o.id })
    for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) for (let k = j + 1; k < opts.length; k++) {
      const items = [it(opts[i]), it(opts[j]), it(opts[k])]
      if (!findDuplicate(items, S.db.bundles)) return { sizeId, base: opts[i].name, others: [opts[j].name, opts[k].name], n: S.db.bundles.length }
    }
    return null
  })
  assert.ok(plan, 'ต้องมีกลุ่มตัวเลือก 3 ตัวที่ยังไม่มีชุดอยู่')
  await page.getByRole('button', { name: plan.base, exact: true }).click()
  for (const name of plan.others) await page.getByRole('checkbox', { name, exact: true }).check()
  await page.getByRole('spinbutton', { name: /ส่วนลดชุดใหม่/ }).first().fill('55')
  await page.getByRole('button', { name: 'สร้างชุด' }).click()
  await page.waitForFunction((n) => window.__store.db.bundles.length === n + 1, plan.n, { timeout: 10000 })
  const made = await page.evaluate(() => window.__store.db.bundles.at(-1))
  assert.equal(made.items.length, 3)
  assert.equal(Number(made.discount[plan.sizeId]), 55)
  assert.deepEqual(errors, [])
  await page.close()
})

t('แก้ส่วนลดของชุดเดิมในหน้านี้ แล้วบันทึกได้', async () => {
  const { page, errors } = await open({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const target = await page.evaluate(() => {
    const S = window.__store
    const sizeId = S.db.optionGroups.find((x) => x.key === 'size').options.find((o) => o.active !== false).id
    const b = S.db.bundles.find((x) => x.active !== false && (x.items || []).some((i) => i.groupId === 'g_topping'))
    if (!b) return null
    const o = S.db.optionGroups.find((g) => g.id === 'g_topping').options.find((x) => x.id === b.items.find((i) => i.groupId === 'g_topping').optionId)
    return { id: b.id, name: o.name, sizeId }
  })
  assert.ok(target, 'ต้องมีชุดตัวเลือกท็อปปิ้งอย่างน้อยหนึ่งชุด')
  await page.getByRole('button', { name: target.name, exact: true }).click()
  const card = page.locator(`[data-bundle="${target.id}"]`)
  await card.locator('input[type=number]').first().fill('12')
  await page.getByRole('button', { name: 'บันทึกส่วนลด' }).click()
  await page.waitForFunction((id) => window.__store.db.bundles.find((x) => x.id === id)?.discount && true, target.id, { timeout: 10000 })
  const amt = await page.evaluate((args) => window.__store.db.bundles.find((x) => x.id === args.id).discount[args.sizeId], target)
  assert.equal(Number(amt), 12)
  assert.deepEqual(errors, [])
  await page.close()
})

let ok = 0
for (const [name, fn] of cases) {
  try {
    await fn()
    ok++
    console.log(`PASS ${name}`)
  } catch (e) {
    fails++
    console.log(`FAIL ${name}: ${e.message}`)
  }
}
await browser.close()
await server.close()
console.log(fails ? `${fails} FAILED` : `ALL PASS (${ok})`)
process.exit(fails ? 1 : 0)
