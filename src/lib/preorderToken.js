// โทเคนเซสชันสั่งล่วงหน้า (ฟังก์ชันล้วน): เก็บแยกคีย์จากเซสชันบัญชีลูกค้า (punpang_customer_session) เพื่อไม่ให้ปนกัน
export const PREORDER_TOKEN_KEY = 'punpang_preorder_session'
export const readPreorderToken = () => { try { return localStorage.getItem(PREORDER_TOKEN_KEY) || '' } catch { return '' } }
export const savePreorderToken = (t) => { try { localStorage.setItem(PREORDER_TOKEN_KEY, t) } catch { /* ข้าม */ } }
export const clearPreorderToken = () => { try { localStorage.removeItem(PREORDER_TOKEN_KEY) } catch { /* ข้าม */ } }
