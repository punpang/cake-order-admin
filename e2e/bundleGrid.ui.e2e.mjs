// ทดสอบหน้าตารางตั้งราคาชุดคู่ (/admin/settings/bundles/grid) ในเบราว์เซอร์จริง · ใช้ข้อมูลจำลองในหน่วยความจำเท่านั้น
// ตรวจ: จำนวนคู่ = n(n-1)/2 ของตัวเลือกที่เปิดอยู่ · กรอกช่องว่างแล้วบันทึกได้ (สร้างชุดใหม่ 2 ตัวเลือก) · ไม่มี pageerror · ไม่ล้นจอมือถือ
// รัน: node e2e/bundleGrid.ui.e2e.mjs
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

async function openGrid(viewport) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 })
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`${base}/#/admin/settings/bundles/grid`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !document.body.innerText.includes('กำลังเตรียมข้อมูล'), null, { timeout: 60000 })
  await page.waitForSelector('[data-grid]', { timeout: 15000 })
  await page.evaluate(async () => { window.__store = await import('/src/data/store.js') })
  return { page, errors }
}

t('แสดงคู่ครบตามจำนวนตัวเลือกที่เปิดอยู่ และไม่มี pageerror (จอมือถือ)', async () => {
  const { page, errors } = await openGrid({ width: 390, height: 844 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const expected = await page.evaluate(() => {
    const g = window.__store.db.optionGroups.find((x) => x.id === 'g_topping')
    const n = (g?.options || []).filter((o) => o.active !== false).length
    return (n * (n - 1)) / 2
  })
  assert.ok(expected > 0, 'ต้องมีตัวเลือกท็อปปิ้งอย่างน้อย 2 ตัว')
  assert.equal(await page.locator('[data-pair]').count(), expected)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  assert.ok(overflow <= 0, `หน้าล้นแนวนอน ${overflow}px`)
  assert.deepEqual(errors, [])
  await page.close()
})

t('กรอกช่องว่างแล้วบันทึก → สร้างชุดใหม่ 2 ตัวเลือกพร้อมส่วนลดของขนาดนั้น (เดสก์ท็อป)', async () => {
  const { page, errors } = await openGrid({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  const target = await page.evaluate(() => {
    const S = window.__store
    const sizeId = S.db.optionGroups.find((x) => x.key === 'size').options.find((o) => o.active !== false).id
    const g = S.db.optionGroups.find((x) => x.id === 'g_topping')
    const opts = g.options.filter((o) => o.active !== false)
    for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) {
      const items = [{ groupId: 'g_topping', optionId: opts[i].id }, { groupId: 'g_topping', optionId: opts[j].id }]
      const key = items.map((x) => `${x.groupId}:${x.optionId}`).sort().join('|')
      if (!S.db.bundles.some((b) => (b.items || []).length === 2 && b.items.map((x) => `${x.groupId}:${x.optionId}`).sort().join('|') === key)) return { key, sizeId, names: [opts[i].name, opts[j].name] }
    }
    return null
  })
  assert.ok(target, 'ต้องมีคู่ที่ยังไม่มีชุดอย่างน้อยหนึ่งคู่ในข้อมูลจำลอง')
  const before = await page.evaluate(() => window.__store.db.bundles.length)
  await page.locator(`[data-pair="${target.key}"] input[type=number]`).fill('45')
  await page.getByRole('button', { name: 'บันทึกทั้งหมด' }).click()
  await page.waitForFunction((n) => window.__store.db.bundles.length === n + 1, before, { timeout: 10000 })
  const made = await page.evaluate((key) => {
    const b = window.__store.db.bundles.find((x) => (x.items || []).map((i) => `${i.groupId}:${i.optionId}`).sort().join('|') === key)
    return { discount: b?.discount, names: b?.items?.length }
  }, target.key)
  assert.equal(made.names, 2)
  assert.equal(Number(made.discount[target.sizeId]), 45)
  assert.deepEqual(errors, [])
  await page.close()
})


t('ราคาแนะนำ: ช่องว่างของคู่ที่ราคารวมเท่ากับคู่ที่ตั้งส่วนลดไว้ → กด "รับ" แล้วค่าลงช่อง (เดสก์ท็อป)', async () => {
  const { page, errors } = await openGrid({ width: 1280, height: 800 })
  await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
  // เตรียมข้อมูลจำลองในหน่วยความจำ: ตัวเลือก 4 ตัวราคาเท่ากัน, ชุด [1,2] และ [3,4] ลด 30 · คู่ [1,3] ยังว่าง
  const setup = await page.evaluate(async () => {
    const S = window.__store
    const sizeId = S.db.optionGroups.find((x) => x.key === 'size').options.find((o) => o.active !== false).id
    const g = S.db.optionGroups.find((x) => x.id === 'g_topping')
    const o = g.options.filter((x) => x.active !== false).slice(0, 4)
    if (o.length < 4) return null
    for (const x of o) { x.priceType = 'size'; x.sizePrices = { ...(x.sizePrices || {}), [sizeId]: 20 } }
    const item = (x) => ({ groupId: 'g_topping', optionId: x.id })
    const key = (items) => items.map((i) => `${i.groupId}:${i.optionId}`).sort().join('|')
    // ลบชุดเดิมของคู่ [1,3] ถ้ามี เพื่อให้ช่องนั้นว่าง
    const target = [item(o[0]), item(o[2])]
    S.db.bundles.splice(0, S.db.bundles.length, ...S.db.bundles.filter((b) => key(b.items || []) !== key(target)))
    for (const pair of [[o[0], o[1]], [o[2], o[3]]]) {
      S.saveBundle({ name: 'ทดสอบ', items: pair.map(item), discount: { [sizeId]: 30 }, types: [], typeDiscount: {}, styleDiscount: {}, styleMode: {}, active: true, pct: null, typePct: {} })
    }
    return { sizeId, pk: key(target) }
  })
  assert.ok(setup, 'ต้องมีตัวเลือกท็อปปิ้งอย่างน้อย 4 ตัว')
  const row = page.locator(`[data-pair="${setup.pk}"]`)
  await row.getByRole('button', { name: /รับ 30 ฿/ }).waitFor({ timeout: 5000 })
  await row.getByRole('button', { name: /รับ 30 ฿/ }).click()
  assert.equal(await row.locator('input[type=number]').inputValue(), '30')
  assert.equal(await page.getByRole('button', { name: 'บันทึกทั้งหมด' }).isEnabled(), true)
  assert.deepEqual(errors, [])
  await page.close()
})

for (const vp of [{ width: 1024, height: 768 }, { width: 900, height: 800 }]) {
  t(`หน้าจอแคบ ${vp.width}px: ตารางไม่ล้นแนวนอน และปุ่มบันทึกอยู่ในจอแนวนอน`, async () => {
    const { page, errors } = await openGrid(vp)
    await page.getByRole('button', { name: 'On top / ท็อปปิ้ง' }).click()
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    assert.ok(overflow <= 0, `หน้าล้นแนวนอน ${overflow}px`)
    const bar = await page.getByRole('button', { name: 'บันทึกทั้งหมด' }).boundingBox()
    assert.ok(bar && bar.x >= 0 && bar.x + bar.width <= vp.width + 1, 'ปุ่มบันทึกอยู่นอกจอแนวนอน')
    assert.deepEqual(errors, [])
    await page.close()
  })
}

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
