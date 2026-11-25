// ทดสอบเสียงประกาศการรับชำระอัตโนมัติ (POS Android เท่านั้น) · รัน: node src/lib/payAnnounce.test.mjs
import assert from 'node:assert/strict'
import { payAnnounceText, isAndroidUa, announcePaid } from './payAnnounce.js'

let fail = 0
const t = (name, fn) => { try { fn(); console.log(`PASS ${name}`) } catch (e) { fail++; console.log(`FAIL ${name}: ${e.message}`) } }

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 Chrome/125 Mobile Safari/537.36'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125 Safari/537.36'

// ตัวปลอม speechSynthesis + Utterance ที่จดว่าถูกเรียกพูดอะไร
const fakeSynth = () => {
  const spoken = []
  return {
    spoken,
    cancelled: 0,
    cancel() { this.cancelled++ },
    speak(u) { spoken.push(u) },
    Utterance: class { constructor(text) { this.text = text } },
  }
}

t('ข้อความยอดจำนวนเต็มไม่มีทศนิยม', () => {
  assert.equal(payAnnounceText(1250), 'รับชำระแล้ว 1250 บาท')
})

t('ข้อความยอดที่มีสตางค์แสดงสองตำแหน่ง', () => {
  assert.equal(payAnnounceText(1250.5), 'รับชำระแล้ว 1250.50 บาท')
})

t('ปัดสตางค์เกินสองตำแหน่งให้ถูกต้อง', () => {
  assert.equal(payAnnounceText(99.999), 'รับชำระแล้ว 100 บาท')
})

t('ยอดศูนย์หรือติดลบไม่ประกาศ', () => {
  assert.equal(payAnnounceText(0), '')
  assert.equal(payAnnounceText(-5), '')
})

t('ยอดที่ไม่ใช่ตัวเลขไม่ประกาศ', () => {
  assert.equal(payAnnounceText(NaN), '')
  assert.equal(payAnnounceText('abc'), '')
  assert.equal(payAnnounceText(undefined), '')
})

t('ตรวจว่าเป็น Android จาก user agent', () => {
  assert.equal(isAndroidUa(ANDROID), true)
  assert.equal(isAndroidUa(IPAD), false)
  assert.equal(isAndroidUa(WINDOWS), false)
  assert.equal(isAndroidUa(''), false)
})

t('Android พูดข้อความภาษาไทย lang th-TH', () => {
  const s = fakeSynth()
  const ok = announcePaid(1250, { ua: ANDROID, synth: s, Utterance: s.Utterance })
  assert.equal(ok, true)
  assert.equal(s.spoken.length, 1)
  assert.equal(s.spoken[0].text, 'รับชำระแล้ว 1250 บาท')
  assert.equal(s.spoken[0].lang, 'th-TH')
  assert.equal(s.cancelled, 1)
})

t('ไม่ใช่ Android ไม่พูด', () => {
  const s = fakeSynth()
  assert.equal(announcePaid(1250, { ua: WINDOWS, synth: s }), false)
  assert.equal(s.spoken.length, 0)
})

t('ไม่มี speechSynthesis ไม่พูดและไม่ error', () => {
  assert.equal(announcePaid(1250, { ua: ANDROID, synth: undefined }), false)
})

t('ยอดไม่ถูกต้องไม่พูดแม้เป็น Android', () => {
  const s = fakeSynth()
  assert.equal(announcePaid(0, { ua: ANDROID, synth: s }), false)
  assert.equal(s.spoken.length, 0)
})

if (fail) { console.log(`\n${fail} รายการล้มเหลว`); process.exit(1) }
console.log('\nผ่านทั้งหมด')
