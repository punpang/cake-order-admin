// เสียงประกาศ "รับชำระแล้ว xxxx บาท" บนเครื่อง POS Android เท่านั้น · ฟังก์ชันล้วนรับ ua/synth จากภายนอกเพื่อทดสอบได้
// ใช้ Web Speech API (speechSynthesis, lang th-TH) · ไม่มีเสียงพูดหรือไม่รองรับ → เงียบ ไม่ error

// ข้อความที่พูด: จำนวนเต็มไม่มีทศนิยม · มีสตางค์แสดงสองตำแหน่ง · ยอดไม่ถูกต้องหรือ ≤ 0 → ''
export const payAnnounceText = (amount) => {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return ''
  const r = Math.round(n * 100) / 100
  const num = Number.isInteger(r) ? String(r) : r.toFixed(2)
  return `รับชำระแล้ว ${num} บาท`
}

// ตรวจว่าเป็นเครื่อง Android (จาก user agent)
export const isAndroidUa = (ua) => /android/i.test(String(ua || ''))

// พูดประกาศการรับชำระ · คืน true เมื่อสั่งพูดแล้ว
export const announcePaid = (amount, { ua = globalThis.navigator?.userAgent, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance } = {}) => {
  const text = payAnnounceText(amount)
  if (!text || !isAndroidUa(ua) || !synth || !Utterance) return false
  try {
    synth.cancel()
    const u = new Utterance(text)
    u.lang = 'th-TH'
    synth.speak(u)
    return true
  } catch {
    return false
  }
}
