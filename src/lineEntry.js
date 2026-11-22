// หน้า Endpoint ของ LIFF (/line/)
// LINE ส่งโทเค็นมาใน URL ของหน้านี้ (#access_token=… ในแอป LINE · ?code=… หลังเข้าสู่ระบบในเบราว์เซอร์)
// ต้องให้ LIFF อ่านและเก็บโทเค็นที่นี่ก่อน แล้วค่อยไปหน้าเชื่อมบัญชี · ถ้าเปลี่ยนหน้าก่อน โทเค็นหายและ LINE ตอบ 400
import { startLiff } from './lib/liffStart'

startLiff()
  .then((r) => { if (!r.redirecting) location.replace('/#/line') })
  .catch(() => {
    document.getElementById('line-msg').textContent = 'เปิด LINE ไม่สำเร็จ กรุณาลองใหม่'
    document.getElementById('line-dots').remove()
    document.getElementById('line-actions').hidden = false
  })
