-- ชุดแก้ตามรายงานตรวจระบบ 2026-11-21 (B1, B2, B7, B9 และ B13 ส่วน order-audit)

-- B13: งาน order-audit (ทุก 10 นาที) ใช้เวลารอ pg_net ค่าเริ่มต้น 5 วินาที → เพิ่มเป็น 30 วินาทีเหมือน punpang-scheduled
-- คำสั่งเดิมทุกบรรทัด เพิ่มเฉพาะ timeout_milliseconds
do $$ begin perform cron.unschedule('punpang-order-audit'); exception when others then null; end $$;
select cron.schedule(
  'punpang-order-audit',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://itleduijrckxdbhhuooi.supabase.co/functions/v1/order-audit',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-key', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'scheduled_key' limit 1), '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- B9: ชื่องานลบข้อความกล่องเข้าเดิมไม่ตรงกับตารางที่ลบ (tungngern_inbox) → ตั้งชื่อใหม่ ใช้คำสั่งเดิม
do $$ begin perform cron.unschedule('punpang-manee-inbox-purge'); exception when others then null; end $$;
select cron.schedule(
  'punpang-tungngern-inbox-purge',
  '45 3 * * *',
  $$ delete from public.tungngern_inbox where received_at < now() - interval '1 day' $$
);

-- B7: ฟังก์ชันปลดระวางแล้ว (คืน retired เสมอ) → เพิกถอนสิทธิ์เรียกจากผู้ใช้ที่ล็อกอินและผู้ไม่ได้ล็อกอิน
do $$ begin
  if to_regprocedure('public.punpang_apply_points(text,integer)') is not null then
    revoke execute on function public.punpang_apply_points(text, integer) from public, anon, authenticated;
  end if;
  if to_regprocedure('punpang_test.punpang_apply_points(text,integer)') is not null then
    revoke execute on function punpang_test.punpang_apply_points(text, integer) from public, anon, authenticated;
  end if;
end $$;

-- B1: โหมดทดสอบ: punpang_order_audits ไม่มี FK ไป punpang_orders (ตารางจริงมี) → คิวรีแบบ embed ล้ม
-- ลบแถวกำพร้าในสำเนาทดสอบก่อน (ข้อมูลทดสอบเท่านั้น) แล้วเพิ่ม FK เดียวกับตารางจริง
do $$ begin
  if to_regclass('punpang_test.punpang_order_audits') is not null and to_regclass('punpang_test.punpang_orders') is not null then
    delete from punpang_test.punpang_order_audits a where not exists (select 1 from punpang_test.punpang_orders o where o.id = a.order_id);
    if not exists (select 1 from pg_constraint where conrelid = 'punpang_test.punpang_order_audits'::regclass and contype = 'f') then
      alter table punpang_test.punpang_order_audits
        add constraint punpang_order_audits_order_id_fkey foreign key (order_id) references punpang_test.punpang_orders (id) on delete cascade;
    end if;
  end if;
end $$;

-- B2: โหมดทดสอบ: ตาราง LINE ไม่คัดลอกเข้าโหมดทดสอบ (ตั้งใจ ไม่มีข้อมูลลูกค้า LINE)
-- สร้างตารางว่างที่เปิด RLS โดยไม่มี policy → หน้าประวัติ LINE แสดงว่างแทนข้อผิดพลาด และอ่านหรือเขียนไม่ได้
create table if not exists punpang_test.punpang_line_users (like public.punpang_line_users including all);
create table if not exists punpang_test.punpang_line_messages (like public.punpang_line_messages including all);
alter table punpang_test.punpang_line_users enable row level security;
alter table punpang_test.punpang_line_messages enable row level security;
