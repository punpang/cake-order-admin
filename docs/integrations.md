# แผนเชื่อมต่อ Facebook Page / LINE OA / SMS / Telegram

สถานะตอนนี้: **จำลอง** ข้อความทั้งหมดบันทึกลงคิว (`db.outbox`) ยังไม่ส่งจริง
ตั้งค่าได้ที่หน้า **จัดการ → การเชื่อมต่อ & แจ้งเตือน** (`/manage/integrations`)

ลำดับที่จะทำจริง: **Telegram → LINE OA → SMS → Facebook Page**

## ใช้ทำอะไร

| ใช้ทำ | ช่องทาง |
|---|---|
| แจ้งลูกค้าอัตโนมัติ (สรุปออร์เดอร์, แจ้งยอด, ยืนยันชำระ, เตือนนัด, ส่งมอบ, ยกเลิก) | LINE OA → Facebook → SMS |
| เตือนวันเกิด / คะแนนใกล้หมดอายุ / โปร (เฉพาะลูกค้าที่รับข่าว) | LINE OA, Facebook |
| แจ้งทีมภายใน (ออร์เดอร์ใหม่, ชำระแล้ว, งานใกล้เวลา, ยกเลิก) | Telegram |
| รับแชทเข้าระบบ (ระยะถัดไป) | LINE OA, Facebook |

## สถาปัตยกรรม (เมื่อต่อ Supabase)

```
หน้าเว็บ (Vue) ──เขียน──▶ ตาราง outbox (Supabase)
                               │  Database Webhook / pg_cron
                               ▼
                     Edge Function: dispatch ──▶ Telegram / LINE / SMS / Facebook
                               │ อัปเดต status = sent | failed, attempts, error
LINE / Facebook ──webhook──▶ Edge Function: webhook-line / webhook-facebook
                               ▼
                     ตาราง conversations / messages (รับแชท) + ผูก customers
pg_cron (ทุก 15 นาที) ──▶ Edge Function: scheduled (เตือนนัด 24 ชม., งานใกล้เวลา 2 ชม., วันเกิด, คะแนนใกล้หมด)
```

- **token ทั้งหมดอยู่ใน Supabase secrets เท่านั้น** หน้าเว็บไม่เคยเห็น token
- หน้าเว็บเขียนแค่แถว `outbox` (ผ่าน RLS) หรือเรียก Edge Function ที่ตรวจสิทธิ์แล้ว
- ส่งไม่สำเร็จจะลองใหม่ 3 ครั้ง (1, 5, 15 นาที) แล้วจึงตั้งเป็น failed และแจ้งทีมผ่าน Telegram

### ตาราง (ร่าง)
- `notify_rules (event pk, channels text[], template text, enabled bool)`
- `outbox (id, created_at, event, channel, to_address, text, order_id, customer_id, status, attempts, error, sent_at)`
- `notify_sent (key pk, created_at)` กันส่งซ้ำของเหตุการณ์ตามเวลา
- `customers` เพิ่ม `line_user_id`, `fb_psid`, `fb_last_inbound_at`, `promo_opt_in`
- `conversations (id, channel, external_id, customer_id, last_message_at)` และ `messages (id, conversation_id, direction, text, attachments, created_at)`

## รายละเอียดแต่ละช่องทาง

### 1. Telegram (แจ้งทีมภายใน)
- **เตรียม:** สร้างบอทกับ @BotFather → ได้ `BOT_TOKEN` · เพิ่มบอทเข้ากลุ่มทีม → หา `chat_id` (ผ่าน getUpdates)
- **API:** `POST https://api.telegram.org/bot<TOKEN>/sendMessage { chat_id, text }`
- **ค่าใช้จ่าย:** ฟรี
- **ข้อจำกัด:** ส่งเข้ากลุ่มได้ประมาณ 20 ข้อความ/นาที

### 2. LINE OA (ลูกค้า)
- **เตรียม:** LINE Official Account + เปิด Messaging API ใน LINE Developers → `CHANNEL_ACCESS_TOKEN`, `CHANNEL_SECRET` · ตั้ง Webhook URL ไปที่ Edge Function
- **ผูกลูกค้า:** ต้องได้ `userId` ของลูกค้า (LINE ID ที่ลูกค้าบอกใช้ส่งไม่ได้) ได้จาก
  - event `follow` / ข้อความแรกที่ลูกค้าทัก → แสดงในหน้าแชทให้พนักงานกด "ผูกกับลูกค้า"
  - หรือลิงก์ LINE Login ในหน้าลูกค้า/ใบสรุปออร์เดอร์ (ลูกค้ากดแล้วผูกอัตโนมัติ)
- **API:** push message `POST /v2/bot/message/push` (ตอบกลับภายในแชทใช้ reply ฟรี)
- **ค่าใช้จ่าย:** push นับโควตาตามแพ็กเกจ OA เกินโควตาคิดเงิน
- **รับแชท:** webhook `message` → ตาราง messages

### 3. SMS (ลูกค้า สำรอง)
- **เตรียม:** สมัครผู้ให้บริการ SMS ไทย (เช่น ThaiBulkSMS, SMSMKT) → API key + ขอชื่อผู้ส่ง (sender name ต้องรออนุมัติ)
- **ค่าใช้จ่าย:** คิดต่อข้อความ ภาษาไทย 70 ตัวอักษร/ข้อความ (ยาวกว่านั้นนับหลายข้อความ) จึงควรใช้ข้อความสั้น
- **ใช้เมื่อ:** ลูกค้าไม่ได้ผูก LINE/Facebook และมีเบอร์โทร

### 4. Facebook Page (ลูกค้า)
- **เตรียม:** Meta Developer App + เชื่อม Page → Page Access Token · ขอสิทธิ์ `pages_messaging` (ต้องผ่าน App Review) · ตั้ง Webhook
- **ผูกลูกค้า:** ได้ `PSID` เมื่อลูกค้าทักเพจ → ผูกในหน้าแชท
- **ข้อจำกัด:** ส่งได้ภายใน 24 ชม. หลังลูกค้าทักล่าสุด นอกช่วงต้องใช้ message tag ที่อนุญาต (เช่น `POST_PURCHASE_UPDATE` สำหรับแจ้งสถานะออร์เดอร์) ห้ามใช้ส่งโปร
- **API:** Send API `POST /me/messages`

## เหตุการณ์ → ช่องทาง (ค่าเริ่มต้น)

| เหตุการณ์ | ผู้รับ | ช่องทาง | เกิดเมื่อ |
|---|---|---|---|
| สร้างออร์เดอร์ (สรุป) | ลูกค้า | LINE, Facebook, SMS | สร้างออร์เดอร์ / ร่าง → ส่งไปรอชำระ |
| แจ้งยอดชำระ | ลูกค้า | LINE, Facebook, SMS | กดแจ้งยอดชำระ |
| ยืนยันชำระแล้ว | ลูกค้า | LINE, Facebook, SMS | แอดมินยืนยันยอด |
| เตือนก่อนนัดรับ | ลูกค้า | LINE, Facebook, SMS | ตามเวลา: ก่อนนัด 24 ชม. |
| ส่งมอบแล้ว | ลูกค้า | LINE, Facebook | เปลี่ยนสถานะเป็นส่งมอบ |
| ยกเลิกออร์เดอร์ | ลูกค้า | LINE, Facebook, SMS | ยกเลิกออร์เดอร์ |
| อวยพรวันเกิด | ลูกค้า (รับข่าว) | LINE, Facebook | ตามเวลา: ภายในวันเตือนวันเกิดที่ตั้งไว้ |
| คะแนนใกล้หมดอายุ | ลูกค้า (รับข่าว) | LINE, Facebook | ตามเวลา: ภายใน 30 วัน |
| ออร์เดอร์ใหม่ / ชำระแล้ว / ยกเลิก | ทีม | Telegram | พร้อมเหตุการณ์ลูกค้า |
| งานใกล้เวลาต้องเสร็จ | ทีม | Telegram | ตามเวลา: ก่อนเวลาต้องเสร็จ 2 ชม. |
| บรอดแคสต์โปร (ระยะถัดไป) | ลูกค้า (รับข่าว) | LINE (broadcast/narrowcast) | กดส่งจากหน้าจัดการ |

**ลำดับเลือกช่องทางถึงลูกค้า:** ช่องทางแรกที่ (อนุญาตในกฎ + เปิดใช้ + ลูกค้ามีข้อมูล) ตามลำดับ LINE → Facebook → SMS
ถ้าไม่มีเลย บันทึกในคิวว่า "ไม่มีช่องทาง"

**ตัวแปรในข้อความ:** `{ชื่อลูกค้า} {เลขออร์เดอร์} {ยอดรวม} {คงค้าง} {ยอดที่แจ้ง} {วันนัด} {เวลานัด} {ส่งมอบ} {ชื่อวันเกิด} {คะแนน}`

## ความยินยอม (PDPA)
- ข้อความเกี่ยวกับออร์เดอร์ (สรุป แจ้งยอด เตือนนัด) ส่งได้ตามสัญญาซื้อขาย
- ข่าวโปร/อวยพรวันเกิด/คะแนนใกล้หมด ส่งเฉพาะลูกค้าที่เปิด "รับข่าวโปร" และต้องมีวิธีขอยกเลิก (พิมพ์ "ยกเลิกรับข่าว" ใน LINE → webhook ปิดให้อัตโนมัติ)

## รับแชทเข้าระบบ (ระยะถัดไป)
- หน้า "แชท" รวม LINE + Facebook เรียงตามล่าสุด มีป้ายช่องทาง
- ผูกแชทกับลูกค้า (ค้นชื่อ/เบอร์) → เก็บ `line_user_id` / `fb_psid`
- ตอบกลับจากหลังบ้าน (LINE reply/push, Facebook ภายใน 24 ชม.)
- ปุ่ม "สร้างออร์เดอร์จากแชท" เติมลูกค้าให้อัตโนมัติ

## Checklist เปิดใช้งานจริง
1. ต่อ Supabase (ตาราง + RLS + Edge Functions `dispatch`, `scheduled`) และย้าย `notify()` จาก `src/data/store.js` ไปเขียนแถว outbox
2. **Telegram:** สร้างบอท → ใส่ `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` ใน secrets → ทดสอบส่ง
3. **LINE OA:** สร้าง Messaging API channel → ใส่ `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET` → ตั้ง webhook → ทำการผูก userId
4. **SMS:** สมัครผู้ให้บริการ + ขอชื่อผู้ส่ง → ใส่ `SMS_API_KEY`, `SMS_SENDER` → ทดสอบ
5. **Facebook:** สร้าง Meta App → ขอ App Review `pages_messaging` → ใส่ `FB_PAGE_TOKEN`, `FB_APP_SECRET` → ตั้ง webhook
6. เปิด pg_cron สำหรับเหตุการณ์ตามเวลา
7. ทำหน้าแชท (ระยะถัดไป)
