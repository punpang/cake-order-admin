// สั่งพิมพ์หน้าครัว (รายการเตรียม/ตารางผลิต): พิมพ์เฉพาะ .kitchen-print-area · กติกาการพิมพ์อยู่ใน style.css
export function printKitchen() {
  document.body.classList.add('print-kitchen')
  const done = () => {
    document.body.classList.remove('print-kitchen')
    window.removeEventListener('afterprint', done)
  }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
