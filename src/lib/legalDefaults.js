// ข้อความ PDPA / คุกกี้ / เงื่อนไขการใช้งาน (แก้ได้ที่ /admin/settings/legal)
// ฉบับใช้งาน (ปรับให้ตรงกับระบบที่ deploy จริง ณ 2026-11-19) · รายละเอียดการประมวลผลอยู่ที่ docs/pdpa.md
// อ้างอิงกฎหมาย: พ.ร.บ.คุ้มครองข้อมูลส่วนบุคคล พ.ศ. 2562 · ประกาศ คกก. เรื่องการเข้าถึงและขอรับสำเนาข้อมูลส่วนบุคคล พ.ศ. 2569 (ราชกิจจาฯ 16 ก.ค. 2569 มีผล 14 ก.ย. 2569)
// หมายเหตุ: ข้อความนี้เป็นร่างเชิงระบบ ที่ปรึกษากฎหมาย/ผู้เชี่ยวชาญ PDPA ควรตรวจก่อนใช้จริงและเมื่อระบบเปลี่ยน
// ค่าเริ่มต้นนี้ใช้ตอนสร้างข้อมูลครั้งแรกเท่านั้น · ข้อความที่ร้านบันทึกไว้แล้วต้องเผยแพร่ใหม่ที่ /admin/settings/legal
// รูปแบบข้อความ: "## หัวข้อ" · "- รายการ" · บรรทัดว่างคั่นย่อหน้า · ตัวแปร {ชื่อ} แทนค่าตอนแสดง (ดู fillLegal)

export const LEGAL_KINDS = {
  privacy: { label: 'นโยบายความเป็นส่วนตัว (PDPA)', short: 'ความเป็นส่วนตัว' },
  terms: { label: 'เงื่อนไขการใช้งาน', short: 'เงื่อนไขการใช้งาน' },
  cookie: { label: 'นโยบายคุกกี้', short: 'คุกกี้' },
}
// kind ที่ลูกค้าต้องยอมรับก่อนใช้บัญชี (คุกกี้แยกต่างหาก ตอนเข้าหน้าร้าน)
export const ACCOUNT_CONSENT_KINDS = ['privacy', 'terms']

// ตัวแปรที่ใช้ได้ในข้อความ (ค่าจาก db.legal.contact / db.shop / db.loyalty)
export const LEGAL_VARS = {
  ชื่อร้าน: 'ชื่อร้าน (ตั้งค่าร้าน)',
  ผู้ควบคุมข้อมูล: 'ชื่อผู้ควบคุมข้อมูล (บุคคล/นิติบุคคล)',
  ที่อยู่: 'ที่อยู่ผู้ควบคุมข้อมูล',
  อีเมลติดต่อ: 'อีเมลรับเรื่องสิทธิ์ข้อมูลส่วนบุคคล',
  เบอร์ติดต่อ: 'เบอร์โทรติดต่อ',
  ระยะเก็บบัญชี: 'ระยะเก็บข้อมูลบัญชีหลังเลิกใช้งาน (เดือน)',
  ระยะเก็บบัญชีภาษี: 'ระยะเก็บหลักฐานออร์เดอร์/การชำระ (ปี)',
  ระยะเก็บแชท: 'ระยะเก็บประวัติแชท (เดือน)',
  อัตราสะสม: 'ทุกกี่บาทได้ 1 คะแนน (ตั้งค่าคะแนน)',
  มูลค่าคะแนน: 'คะแนนละกี่บาทเมื่อใช้/คืน (ตั้งค่าคะแนน)',
  อายุคะแนน: 'อายุคะแนน (วัน)',
  อายุคูปอง: 'อายุคูปอง (วัน)',
}

// แทนตัวแปร · mark = true แสดง 【ชื่อตัวแปร】 เมื่อยังไม่ได้กรอก (หน้าแอดมิน) · false แสดง "-" (หน้าลูกค้า)
export function fillLegal(text, vars, mark = false) {
  const missing = new Set()
  const out = String(text ?? '').replace(/\{([^{}\n]+)\}/g, (m, k) => {
    if (!(k in LEGAL_VARS)) return m
    const v = vars?.[k]
    if (v == null || String(v).trim() === '') {
      missing.add(k)
      return mark ? `【${k}】` : '-'
    }
    return String(v)
  })
  return { text: out, missing: [...missing] }
}

// แตกข้อความเป็นบล็อกสำหรับแสดงผล (ไม่ใช้ v-html)
export function parseLegal(text) {
  const blocks = []
  let list = null
  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.trimEnd()
    if (/^##\s+/.test(line)) {
      list = null
      blocks.push({ t: 'h', s: line.replace(/^##\s+/, '') })
    } else if (/^-\s+/.test(line)) {
      if (!list) blocks.push((list = { t: 'ul', items: [] }))
      list.items.push(line.replace(/^-\s+/, ''))
    } else if (line.trim() === '') {
      list = null
    } else {
      list = null
      blocks.push({ t: 'p', s: line })
    }
  }
  return blocks
}

export const DEFAULT_LEGAL_CONTACT = {
  controller: '',
  address: '',
  email: '',
  phone: '',
  retentionAccount: 24, // เดือน หลังใช้บริการครั้งล่าสุด (ร้านยืนยันแล้ว)
  retentionAccounting: 5, // ปี ตามกฎหมายบัญชี/ภาษี (ร้านยืนยันแล้ว)
  retentionChat: 12, // เดือน นับจากข้อความล่าสุด (ร้านยืนยันแล้ว)
}
