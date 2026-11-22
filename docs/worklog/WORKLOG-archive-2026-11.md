

## 2026-11-22 · [Release] Merge dev→main (fast-forward) · main = `91ec629`

**ทำอะไร:** ผู้ใช้ตอบ "Merge" (อนุมัติ merge dev→main) · ตรวจก่อน push: main `96f294e` เป็นบรรพบุรุษของ dev `91ec629` (fast-forward ได้) · มี 2 คอมมิต (`3c1e2b1`, `91ec629`) · ไม่มีการเปลี่ยน `supabase/` หรือ `worker/` · push `91ec629:refs/heads/main` แบบปกติ ไม่ใช้ force · ตรวจ remote แล้ว: main = dev = `91ec629`
**ผลกระทบ:** push main ทำให้ Cloudflare Pages build production อัตโนมัติ (ตรวจสถานะ build ไม่ได้ เพราะ connector Cloudflare ยังไม่พร้อม) · ไม่รัน Release เพราะไม่มีการเปลี่ยนฐานข้อมูลหรือ Edge Function
**ทำไมถึงคิดแบบนั้น:** คำตอบ "Merge" ตรงกับการอนุมัติที่รอไว้ ขอบเขตคือ merge อย่างเดียว จึงไม่ทำอย่างอื่นต่อ
**รอ:** ผู้ใช้ทดสอบ LIFF บนมือถือ (หน้า `/line/` บน production) · เชื่อม Cloudflare ใหม่เพื่อยืนยัน build ของ `91ec629`

---
