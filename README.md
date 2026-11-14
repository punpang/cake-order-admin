# ระบบหลังบ้าน ร้านเค้ก (ส่วนแรก: ออร์เดอร์)

Vue 3 + Vite + Tailwind CSS v4 · ตอนนี้ใช้ **ข้อมูลตัวอย่าง** (รีเฟรชแล้วรีเซ็ต) ยังไม่ต่อ Supabase

## รัน

```bash
npm install
npm run dev
```

เปิดลิงก์ที่ขึ้นใน terminal (มือถือในวง Wi‑Fi เดียวกันเปิดลิงก์ Network ได้)

## ทดสอบ

```bash
npm test            # ฝั่ง Node (ไม่ต้องติดตั้งอะไรเพิ่ม)
npm run test:deno   # Edge Function + Worker (ต้องมี Deno 2)
npm run test:db     # migration ทั้งหมดบน Postgres จริง + นโยบายความปลอดภัย (ต้องมี psql และเชื่อม Postgres ที่สร้างฐาน/role ได้ เช่น PGHOST/PGUSER/PGPASSWORD)
npm run test:all    # ทั้งหมดข้างต้น
```

GitHub Actions (`.github/workflows/ci.yml`) รันชุดเดียวกันนี้ทุก push เข้า main และทุก Pull Request · การ deploy ใช้ workflow `Deploy ...` ที่รันเองเท่านั้น

## มีอะไรบ้าง

- รายการออร์เดอร์: กรองตามสถานะ / วันนัดรับ / ค้นหา
- สร้างออร์เดอร์ 4 ขั้น: ลูกค้า (ค้นหา/เพิ่มใหม่) → นัดรับ (แจ้งจำนวนออร์เดอร์ที่มีแล้ว, รับที่ร้าน/จัดส่ง) → สินค้า (เค้กสำเร็จ/สั่งทำ, คำนวณราคา) → สรุป
- รายละเอียดออร์เดอร์: แจ้งชำระหลายงวด (แนบสลิปได้), ยืนยันชำระ, ปรับราคา, เริ่มเตรียม, ส่งมอบ, ยกเลิก + คืนเงิน, ประวัติ
- ปุ่ม "ทดลองเป็น" มุมขวาบน สลับบทบาท แอดมิน / พนักงานขาย / คนทำเค้ก / คนส่งของ

## ไฟล์หลัก

```
src/
  data/store.js        ข้อมูลตัวอย่าง + ฟังก์ชัน (จะเปลี่ยนเป็น Supabase)
  lib/constants.js     สถานะ, บทบาท, สิทธิ์
  lib/pricing.js       วิธีคิดราคา
  views/               OrderList, OrderCreate, OrderDetail
  components/          ItemEditor, OptionPicker, ItemCard, AppModal, StatusBadge
```
