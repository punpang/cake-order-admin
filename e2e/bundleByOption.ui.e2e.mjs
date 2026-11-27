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
  // หน้านี้ไม่มีการค้นหาและสวิตช์กรอง จึงต้องไม่แสดงแถบเครื่องมือที่กดไม่ได้
  assert.equal(await page.getByPlaceholder('ค้นหา').count(), 0)
  assert.equal(await page.getByText('แสดงที่ปิดใช้งาน').count(), 0)
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
  for (const el of await page.getByRole('spinbutton', { name: /ส่วนลดชุดใหม่/ }).all()) await el.fill('55')
  await page.getByRole('button', { name: 'สร้างชุด' }).click()
  await page.waitForFunction((n) => window.__store.db.bundles.length === n + 1, plan.n, { timeout: 10000 })
  const made = await page.evaluate(() => window.__store.db.bundles.at(-1))
  assert.equal(made.items.length, 3)
  const stored = [made.discount?.[plan.sizeId], ...Object.values(made.typeDiscount || {}).map((r) => r?.[plan.sizeId])].filter((v) => v != null)
  assert.ok(stored.length > 0 && stored.every((v) => Number(v) === 55), 'ส่วนลดต้องถูกบันทึกเป็น 55 ในทุกช่องที่กรอก')
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
  const first = card.locator('input[type=number]').first()
  const row = (await first.getAttribute('data-row')).split('|')
  const [, typeId, sizeId] = row
  await first.fill('12')
  await page.getByRole('button', { name: 'บันทึกส่วนลด' }).click()
  await page.waitForFunction((id) => window.__store.db.bundles.find((x) => x.id === id)?.discount && true, target.id, { timeout: 10000 })
  const amt = await page.evaluate((a) => {
    const b = window.__store.db.bundles.find((x) => x.id === a.id)
    return a.typeId ? b.typeDiscount?.[a.typeId]?.[a.sizeId] : b.discount?.[a.sizeId]
  }, { id: target.id, typeId: typeId || null, sizeId })
  assert.equal(Number(amt), 12)
  assert.deepEqual(errors, [])
  await page.close()
})


t('ราคาปกติของการ์ดคิดตามประเภทที่ตัวเลือกใช้ได้ (ไม่ใช้ราคาทุกประเภท)', async () => {
  const { page, errors } = await open({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const setup = await page.evaluate(async () => {
    const S = window.__store
    const sizeId = S.db.optionGroups.find((x) => x.key === 'size').options.find((o) => o.active !== false).id
    const types = S.db.optionGroups.find((x) => x.key === 'type').options.filter((o) => o.active !== false)
    if (types.length < 2) return null
    const g = S.db.optionGroups.find((x) => x.id === 'g_topping')
    const opts = g.options.filter((o) => o.active !== false)
    if (opts.length < 2) return null
    const [ta, tb] = types
    // ตัวเลือก A: 150 ทุกประเภท แต่ 60 ในประเภท ta/tb และใช้ได้เฉพาะสองประเภทนี้ · ตัวเลือก B: 80 ทุกประเภท
    Object.assign(opts[0], { priceType: 'size', types: [ta.id, tb.id], sizePrices: { [sizeId]: 150 }, typePrices: { [ta.id]: { [sizeId]: 60 }, [tb.id]: { [sizeId]: 60 } } })
    Object.assign(opts[1], { priceType: 'size', types: [], sizePrices: { [sizeId]: 80 } })
    const key = [opts[0], opts[1]].map((o) => `g_topping:${o.id}`).sort().join('|')
    S.db.bundles.splice(0, S.db.bundles.length, ...S.db.bundles.filter((b) => (b.items || []).map((i) => `${i.groupId}:${i.optionId}`).sort().join('|') !== key))
    S.saveBundle({ name: 'ทดสอบประเภท', items: [opts[0], opts[1]].map((o) => ({ groupId: 'g_topping', optionId: o.id })), discount: { [sizeId]: 30 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true, pct: null, typePct: {} })
    return { name: opts[0].name, names: [ta.name, tb.name] }
  })
  assert.ok(setup, 'ต้องมีประเภทอย่างน้อย 2 และตัวเลือกท็อปปิ้งอย่างน้อย 2')
  await page.getByRole('button', { name: setup.name, exact: true }).click()
  const card = page.locator('[data-bundle]', { hasText: 'ทดสอบประเภท' })
  await card.waitFor({ timeout: 5000 })
  const text = await card.innerText()
  assert.ok(text.includes(`${setup.names[0]} · `) && text.includes('ราคาปกติ 140'), 'ต้องแสดงราคาปกติ 140 ในประเภทที่ตัวเลือกใช้ได้')
  assert.ok(!text.includes('ราคาปกติ 230'), 'ต้องไม่แสดงราคาทุกประเภทที่ไม่ตรงกับลูกค้า')
  assert.ok(text.includes('หลังหักส่วนลด 110'), 'ต้องแสดงราคาหลังหักส่วนลด 140 - 30 = 110')
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
