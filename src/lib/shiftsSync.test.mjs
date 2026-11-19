// ทดสอบโหลดกะ POS เฉพาะที่ใช้ · รัน: node src/lib/shiftsSync.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { loadShifts, RECENT_SHIFTS } from './shiftsSync.js'

function fakeClient(rows) {
  const from = () => {
    const f = []
    let ord = null
    const api = {
      select() { return api },
      is(c, v) { f.push((r) => r[c] === v); return api },
      gte(c, v) { f.push((r) => r[c] >= v); return api },
      order(c, o) { ord = [c, o?.ascending !== false]; return api },
      limit(n) {
        let r = rows.filter((x) => f.every((g) => g(x)))
        if (ord) r = [...r].sort((a, b) => (ord[1] ? 1 : -1) * String(a[ord[0]]).localeCompare(String(b[ord[0]])))
        return Promise.resolve({ data: r.slice(0, n), error: null })
      },
    }
    return api
  }
  return { from }
}
const day = (i) => new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString()
test('โหลดกะที่เปิดอยู่ (แม้เก่า) + กะล่าสุด ไม่โหลดทั้งตาราง', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ id: 's' + i, opened_at: day(i), closed_at: i === 3 ? null : day(i), data: {}, updated_at: day(i) }))
  const r = await loadShifts(fakeClient(rows))
  assert.equal(r.items.length, RECENT_SHIFTS + 1)
  assert.ok(r.items.some((s) => s.id === 's3' && !s.closedAt), 'กะที่ยังเปิดอยู่ต้องมาเสมอ')
  assert.equal(r.items[0].id, 's299', 'ใหม่สุดก่อน')
  assert.ok(r.items.every((s) => s._v), 'มีเวอร์ชันสำหรับดึงเฉพาะที่เปลี่ยน')
})
