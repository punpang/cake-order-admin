// สถิติคลิกดูแบบเค้ก (ไว้คำนวณรูปแนะนำ) — เก็บที่ Supabase ผ่าน RPC เท่านั้น (ไม่มีสิทธิ์อ่าน/เขียนตารางตรง)
// เขียน: punpang_record_click (anon ได้ · ฐานข้อมูลกันซ้ำ/จำกัดจำนวน) · อ่าน: punpang_click_pairs (รหัสผู้เยี่ยมชมถูกแฮช)
export async function sendClick(client, photoId, visitor) {
  if (!client || !photoId || !visitor) return false
  try { const r = await client.rpc('punpang_record_click', { p_photo: String(photoId), p_visitor: String(visitor) }); return !r.error } catch { return false }
}
export async function loadClicks(client) {
  if (!client) return { error: 'no client' }
  try {
    const r = await client.rpc('punpang_click_pairs')
    if (r.error) return { error: r.error.message }
    return { items: (r.data || []).map((x) => ({ v: x.v, photoId: x.photo_id, at: null })) }
  } catch (e) { return { error: e?.message || 'load failed' } }
}
// โหลดแล้วแทนที่ db.cakeClicks (ล้มเหลว = คงของเดิม)
export async function applyClicks(client, db) {
  const r = await loadClicks(client)
  if (r.error) return false
  db.cakeClicks.splice(0, db.cakeClicks.length, ...r.items)
  return true
}
