// กล่องดูรูปขนาดใหญ่ในหน้าเดิม (ไม่เปิดแท็บใหม่) · รูปที่ไม่ได้อยู่ในลิงก์/ปุ่มจะขยายเมื่อแตะ
import { reactive } from 'vue'
export const lightbox = reactive({ url: '', alt: '' })
export const openLightbox = (url, alt = '') => { if (url) Object.assign(lightbox, { url, alt }) }
export const closeLightbox = () => { lightbox.url = ''; lightbox.alt = '' }
// แตะรูปที่ไม่อยู่ในลิงก์/ปุ่ม/ที่ระบุ data-no-zoom → ขยาย (ใช้ในระดับแอป)
export function onImageClick(e) {
  const img = e.target instanceof Element ? e.target.closest('img') : null
  if (!img || !img.src || img.closest('a, button, [data-no-zoom], [data-lightbox]')) return
  if (img.naturalWidth && img.naturalWidth < 40) return // ไอคอนเล็ก
  e.preventDefault()
  openLightbox(img.src, img.alt)
}
