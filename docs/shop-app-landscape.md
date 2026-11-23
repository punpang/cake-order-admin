# แอปร้าน (Android): แนวนอนเท่านั้น

- ตัดสินใจ 2026-11-24: แอปร้าน (`com.punpang.cakeadmin`) ติดตั้งเฉพาะเครื่อง POS ไม่มีใช้บนมือถือพนักงานอีกแล้ว
- ล็อกแนวนอนที่ `android/app/src/main/AndroidManifest.xml` (`sensorLandscape` = กลับหัวได้ ไม่หมุนเป็นแนวตั้ง) · เทสต์: `src/lib/androidOrientation.test.mjs`
- ขนาดจอขั้นต่ำที่ออกแบบและทดสอบ: **1280×800** · เทสต์หน้าจอ: `e2e/pos-landscape.e2e.mjs`
- เว็บ `/admin` บนมือถือยังใช้งานได้ตามเดิม **ไม่ลบเลย์เอาต์มือถือ/แนวตั้ง** (ไม่ได้ถอดคลาส `sm:` `md:` `max-md:` และ `.head-safe`)
- แอปลูกค้า (`build-customer-android`) แยกต่างหาก ไม่เกี่ยวข้อง
- เปลี่ยน manifest ต้อง Build Android APK ใหม่แล้วติดตั้งซ้ำบนเครื่อง POS (อัปเดตเว็บอย่างเดียวไม่พอ)
