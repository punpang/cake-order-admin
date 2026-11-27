// แปลงรูปแนบของรายการบัญชีจากข้อมูลในเครื่อง (data:) เป็นอ้างอิงที่อัปโหลดแล้ว (r2://...) (ฟังก์ชันล้วน · ไม่เรียกเครือข่ายเอง)
// รูปที่เป็นอ้างอิงอยู่แล้วคงเดิม · รูปเดียวกันอัปโหลดครั้งเดียว · uploader(src) ต้องคืนอ้างอิง ถ้าล้มเหลวให้โยน error (ผู้เรียกจะไม่บันทึกรายการ)
// บันทึกรายการที่มีรูปแนบ: ตรวจกติกาก่อน → ถ้าผ่านจึงอัปโหลดรูป → แล้วบันทึก (ไม่อัปโหลดถ้ารายการไม่ผ่าน จึงไม่เหลือรูปค้าง)
// precheck(form) คืน error หรือ null · save(form) คืน { error } หรือ { ok }
export async function saveWithReceipts({ form, precheck, uploader, save }) {
  const err = precheck(form)
  if (err) return { error: err }
  const attachments = await resolveReceiptRefs(form.attachments, uploader)
  return save({ ...form, attachments })
}

export async function resolveReceiptRefs(attachments, uploader) {
  const out = []
  const done = new Map()
  for (const a of attachments || []) {
    if (typeof a !== 'string' || !a.startsWith('data:')) {
      out.push(a)
      continue
    }
    if (!done.has(a)) done.set(a, await uploader(a))
    out.push(done.get(a))
  }
  return out
}
