// นับการเข้าชมหน้าเว็บลูกค้า · นับรวมต่อวันในฐานข้อมูล (punpang_record_pageview) · ไม่ใช้คุกกี้ ไม่เก็บ IP หรือรหัสผู้ใช้
// ล้มเหลวหรือไม่ได้เชื่อมฐานข้อมูล → เงียบ ไม่กระทบการแสดงหน้า
import { supabaseEnabled, getSupabase } from './supabase'
import { thaiDay } from './aiStats.js'

export function trackPageView() {
  if (!supabaseEnabled) return
  try {
    getSupabase()
      .then((c) => c.rpc('punpang_record_pageview', { p_day: thaiDay(new Date().toISOString()) }))
      .catch(() => {})
  } catch { /* ไม่กระทบหน้า */ }
}

// คืน [{ day_key, views }] ตั้งแต่ fromDay ถึง toDay (YYYY-MM-DD) · ต้องมีสิทธิ์พนักงาน
export async function fetchPageViews(client, fromDay, toDay) {
  const r = await client.rpc('punpang_pageview_stats', { p_from: fromDay, p_to: toDay })
  if (r.error) throw new Error(r.error.message || 'load_failed')
  return r.data || []
}
