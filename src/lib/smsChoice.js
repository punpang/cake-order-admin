// ตัวเลือก "ส่ง SMS ด้วย": มีให้เลือกเมื่อลูกค้ามีเบอร์ + ผูก Facebook/LINE ไว้ (ระบบส่งทางแชทก่อน แล้วส่ง SMS ซ้ำ) · ไม่มีเบอร์/ไม่มีแชท = SMS เป็นช่องทางหลักอยู่แล้ว
export const smsChoice = (c) => !!(c && c.phone && (c.fbPsid || c.lineUserId))
