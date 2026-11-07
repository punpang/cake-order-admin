// การนำทางด้วยแป้นพิมพ์: ข้ามไปเนื้อหาหลัก · ย้ายโฟกัสไปเนื้อหาเมื่อเปลี่ยนหน้า · tooltip ข้อความที่ถูกตัด
export function focusMain(onlyIfLost = false) {
  const m = document.getElementById('main-content')
  if (!m) return
  if (onlyIfLost && m.contains(document.activeElement) && document.activeElement !== m) return // หน้าใหม่โฟกัสช่องของตัวเองแล้ว
  m.focus({ preventScroll: true })
  if (!onlyIfLost) m.scrollIntoView({ block: 'start' })
}

// ข้อความที่ถูกตัด (truncate/line-clamp) แล้วยังไม่มี title → ใส่ข้อความเต็มตอนเมาส์ชี้
export function startAutoTitle() {
  document.addEventListener('mouseover', (e) => {
    const el = e.target instanceof Element ? e.target.closest('.truncate,[class*="line-clamp-"]') : null
    if (!el || el.hasAttribute('title') || el.closest('[title]')) return
    if (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1) el.setAttribute('title', el.textContent.trim().replace(/\s+/g, ' '))
  }, { passive: true })
}
