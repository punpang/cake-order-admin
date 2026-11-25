// เสียงประกาศ "รับชำระแล้ว {ยอดเป็นคำไทย}" บนเครื่อง POS Android เท่านั้น · ฟังก์ชันล้วนรับ ua/synth จากภายนอกเพื่อทดสอบได้
// ใช้ Web Speech API (speechSynthesis, lang th-TH) · ไม่มีเสียงพูดหรือไม่รองรับ → เงียบ ไม่ error

const DIGITS = ['ศูนย์', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า']
const POS_UNITS = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน']

// อ่านจำนวนเต็มบวกเป็นคำไทย (ไม่รวมหน่วยเงิน) · รองรับทุกค่าโดยแบ่งกลุ่มทีละล้าน
const readInt = (n) => {
  if (n === 0) return DIGITS[0]
  if (n >= 1000000) {
    const high = Math.floor(n / 1000000)
    const low = n % 1000000
    return readInt(high) + 'ล้าน' + (low ? readInt(low) : '')
  }
  const s = String(n)
  const len = s.length
  let out = ''
  for (let i = 0; i < len; i++) {
    const d = Number(s[i])
    const pos = len - 1 - i
    if (d === 0) continue
    if (pos === 1 && d === 1) out += 'สิบ'
    else if (pos === 1 && d === 2) out += 'ยี่สิบ'
    else if (pos === 0 && d === 1 && len > 1) out += 'เอ็ด'
    else out += DIGITS[d] + POS_UNITS[pos]
  }
  return out
}

// ยอดเป็นคำไทย: "หนึ่งพันสองร้อยสามสิบสี่บาท" · มีสตางค์ต่อท้ายด้วย "สตางค์" · ยอดไม่ถูกต้องหรือ ≤ 0 → ''
export const thaiBahtWords = (amount) => {
  const n = Number(amount)
  if (!Number.isFinite(n) || n <= 0) return ''
  const total = Math.round(n * 100)
  const baht = Math.floor(total / 100)
  const satang = total % 100
  let out = ''
  if (baht > 0) out += readInt(baht) + 'บาท'
  if (satang > 0) out += readInt(satang) + 'สตางค์'
  return out
}

// ข้อความที่พูดเต็ม · ยอดไม่ถูกต้องหรือ ≤ 0 → ''
export const payAnnounceText = (amount) => {
  const words = thaiBahtWords(amount)
  return words ? `รับชำระแล้ว ${words}` : ''
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
