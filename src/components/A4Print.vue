<script setup>
// พิมพ์เอกสาร A4: แสดง slot ตามปกติ + สำเนาที่ย้ายไป body (ซ่อนบนจอ แสดงตอนพิมพ์) · เรียก print() จากภายนอก · CSS ใน style.css (.a4-print-root, body.print-a4)
function print() {
  document.body.classList.add('print-a4')
  const done = () => { document.body.classList.remove('print-a4'); window.removeEventListener('afterprint', done) }
  window.addEventListener('afterprint', done)
  setTimeout(() => window.print(), 50)
}
defineExpose({ print })
</script>

<template>
  <div><slot /></div>
  <Teleport to="body"><div class="a4-print-root hidden p-2 text-black"><slot /></div></Teleport>
</template>
