import { reactive } from 'vue'

// สถานะการโหลดข้อมูลจากเซิร์ฟเวอร์ (โหมด Supabase) — หน้าไม่แสดงข้อมูลตัวอย่างแทนข้อมูลจริง
// public: ข้อมูลหน้าร้านของผู้เยี่ยมชม · idle = ยังไม่เริ่ม (หรือไม่ใช่โหมด Supabase / เป็นพนักงาน)
export const publicState = reactive({ status: 'idle', error: '' })
// เซสชันลูกค้าที่ค้างไว้กำลังถูกกู้คืนหรือไม่ (route ที่ต้องล็อกอินต้องรอก่อนตัดสินใจ)
let restoring = Promise.resolve()
export const setRestoring = (p) => { restoring = p }
export const whenSessionReady = () => restoring
