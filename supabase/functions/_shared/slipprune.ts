// งานลบรูปสลิปชุดเทรนที่เก่าเกิน 30 วัน (ใช้โดยฟังก์ชัน slip-train-prune)
// ลบไฟล์ผ่าน Storage API ก่อน แล้วจึงลบรายการ slipTrain · ลบไฟล์ไม่สำเร็จ → ไม่ลบรายการชุดนั้น (รอบหน้าลองใหม่)
// ลบเฉพาะไฟล์ในโฟลเดอร์ train/ เท่านั้น (ไฟล์อื่นไม่ถูกแตะ)

export const TRAIN_RETAIN_DAYS = 30
const TRAIN_PREFIX = 'train/'

// ยอมรับเฉพาะ Authorization: Bearer <คีย์ service role ของโปรเจกต์นี้>
export const bearerMatches = (header: string | null, key: string): boolean => !!key && (header || '').replace(/^Bearer\s+/i, '') === key

export type PruneResult = { ok: boolean; cutoff: string; records: number; files: number; error?: string }

export async function pruneTrainSlips(sb: any, o: { now?: number; retainDays?: number; batch?: number; maxBatches?: number } = {}): Promise<PruneResult> {
  const cutoff = new Date((o.now ?? Date.now()) - (o.retainDays ?? TRAIN_RETAIN_DAYS) * 86_400_000).toISOString()
  const batch = o.batch ?? 100
  const maxBatches = o.maxBatches ?? 50
  let records = 0
  let files = 0
  const fail = (error: string): PruneResult => ({ ok: false, cutoff, records, files, error })
  for (let i = 0; i < maxBatches; i++) {
    const due = await sb.from('punpang_records').select('id,data').eq('collection', 'slipTrain').lt('data->>at', cutoff).limit(batch)
    if (due.error) return fail('query_failed')
    const rows: Array<{ id: string; data: any }> = due.data || []
    if (!rows.length) break
    const paths = rows.map((r) => r.data?.path).filter((p): p is string => typeof p === 'string' && p.startsWith(TRAIN_PREFIX) && !p.includes('..'))
    if (paths.length) {
      const rm = await sb.storage.from('punpang-slips').remove(paths)
      if (rm?.error) return fail('storage_remove_failed')
      files += paths.length
    }
    const del = await sb.from('punpang_records').delete().eq('collection', 'slipTrain').in('id', rows.map((r) => r.id)).select('id')
    if (del.error) return fail('record_delete_failed')
    const gone = (del.data || []).length
    if (!gone) return fail('record_delete_no_effect')
    records += gone
  }
  return { ok: true, cutoff, records, files }
}
