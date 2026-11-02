// ช่องกรอกตัวเลข: v-num = จำนวนเต็ม (แป้นตัวเลข), v-num.dec = มีทศนิยม (แป้นตัวเลข + จุด)
// ตัดอักขระที่ไม่ใช่ตัวเลขออกทันทีตอนพิมพ์/วาง (ทำงานก่อน v-model อ่านค่า)

export function cleanNum(value, dec = false) {
  let s = String(value ?? '').replace(dec ? /[^0-9.]/g : /[^0-9]/g, '')
  if (dec) {
    const i = s.indexOf('.')
    if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '')
  }
  return s
}

export const vNum = {
  mounted(el, binding) {
    const dec = !!binding.modifiers.dec
    el.setAttribute('inputmode', dec ? 'decimal' : 'numeric')
    if (!dec) el.setAttribute('pattern', '[0-9]*')
    el.setAttribute('autocomplete', 'off')
    el._numClean = (e) => {
      if (e.isComposing) return
      const c = cleanNum(el.value, dec)
      if (c !== el.value) el.value = c
    }
    // capture: ทำงานก่อน listener ของ v-model บน element เดียวกัน
    el.addEventListener('input', el._numClean, true)
  },
  unmounted(el) {
    el.removeEventListener('input', el._numClean, true)
  },
}
