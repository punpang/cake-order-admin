-- บัค #7: anon เรียกฟังก์ชันตัวช่วย/ทริกเกอร์ 3 ตัวได้โดยไม่จำเป็น (สิทธิ์ EXECUTE ของ PUBLIC เริ่มต้นตกทอดถึง anon)
--   punpang__items_money(jsonb) · punpang_customers_touch() · punpang_guard_status()
-- · ตรวจแล้ว: anon ไม่มีสิทธิ์ INSERT/UPDATE/DELETE บน punpang_orders และ punpang_customers จึงไม่มีทางจุดทริกเกอร์ฝั่ง anon
-- · ของ public: เพิกถอนจาก PUBLIC และ anon · authenticated และ service_role ยังมีสิทธิ์เดิมจากการให้โดยตรง (ไม่กระทบพนักงาน)
-- · ฉบับ punpang_test: เพิกถอนจาก anon (ฉบับนี้ anon ได้สิทธิ์โดยตรง)

revoke execute on function public.punpang__items_money(jsonb) from public, anon;
revoke execute on function public.punpang_customers_touch() from public, anon;
revoke execute on function public.punpang_guard_status() from public, anon;

revoke execute on function punpang_test.punpang__items_money(jsonb) from anon;
revoke execute on function punpang_test.punpang_customers_touch() from anon;
revoke execute on function punpang_test.punpang_guard_status() from anon;
