-- ขั้นที่ 3 ของบัค click_pairs: เพิกถอนสิทธิ์ anon จาก punpang_click_pairs (แถวดิบ ต่อผู้เยี่ยมชม)
-- · เว็บและแอปรุ่นใหม่ใช้ punpang_click_stats (ยอดรวม ตัดรายการที่น้อยกว่า 3 คน) แทนแล้ว
-- · แอปพนักงาน (authenticated) ยังเรียกได้ตามเดิม · punpang_record_click ยังเรียกได้ตามการออกแบบ
-- · ฉบับ punpang_test เพิกถอนเช่นเดียวกัน

revoke execute on function public.punpang_click_pairs() from anon;
revoke execute on function punpang_test.punpang_click_pairs() from anon;
