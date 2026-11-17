// สถิติคลิกดูแบบเค้ก (ไว้คำนวณรูปแนะนำ) — เก็บที่ Supabase ผ่าน RPC เท่านั้น (ไม่มีสิทธิ์อ่าน/เขียนตารางตรง)
// เขียน: punpang_record_click (anon ได้ · ฐานข้อมูลกันซ้ำ/จำกัดจำนวน) · อ่าน: punpang_click_stats (ยอดรวม ไม่มีรหัสผู้เยี่ยมชม · ตัดที่น้อยกว่า 3 คนในฐานข้อมูล)
export async function sendClick(client, photoId, visitor) {
  if (!client || !photoId || !visitor) return false
  try { const r = await client.rpc('punpang_record_click', { p_photo: String(photoId), p_visitor: String(visitor) }); return !r.error } catch { return false }
}
// ยอดรวมจากเซิร์ฟเวอร์: photos = { รหัสรูป: จำนวนผู้เยี่ยมชมไม่ซ้ำ } · pairs = { รหัสรูป: { รหัสรูปอื่น: จำนวนผู้เยี่ยมชมที่คลิกทั้งคู่ } } (สมมาตรทั้งสองทาง)
export async function loadClicks(client) {
  if (!client) return { error: 'no client' }
  try {
    const r = await client.rpc('punpang_click_stats')
    if (r.error) return { error: r.error.message }
    const d = r.data || {}
    const photos = {}
    for (const [id, n] of Object.entries(d.photos || {})) photos[id] = Number(n) || 0
    const pairs = {}
    for (const x of Array.isArray(d.pairs) ? d.pairs : []) {
      const a = String(x.a), b = String(x.b), n = Number(x.n) || 0
      if (!pairs[a]) pairs[a] = {}
      if (!pairs[b]) pairs[b] = {}
      pairs[a][b] = n
      pairs[b][a] = n
    }
    return { stats: { photos, pairs } }
  } catch (e) { return { error: e?.message || 'load failed' } }
}
// โหลดแล้วแทนที่ db.clickStats (ล้มเหลว = คงของเดิม)
export async function applyClicks(client, db) {
  const r = await loadClicks(client)
  if (r.error) return false
  db.clickStats = r.stats
  return true
}
