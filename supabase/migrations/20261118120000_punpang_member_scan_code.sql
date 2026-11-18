-- รหัสสมาชิกสำหรับบาร์โค้ด (พนักงานสแกนที่ POS) · เก็บใน punpang_customers.data.scanCode เป็นค่าสุ่ม 32 ตัว hex
-- 1) ลูกค้าเดิมที่ยังไม่มีรหัส → สร้างให้ (แก้เฉพาะ scanCode) · ลูกค้าใหม่ได้รหัสตอนกดดูบาร์โค้ดครั้งแรก (customer-auth: ensure_scan_code)
-- 2) รหัสต้องไม่ซ้ำกันทั้งระบบ (unique index บางส่วน)
-- 3) การเขียนทับ data ที่ไม่มี scanCode (เช่น เครื่องพนักงานที่ยังถือสำเนาเก่า) ต้องไม่ทำให้รหัสที่ลูกค้าใช้อยู่หายไป
-- รันซ้ำได้: backfill เฉพาะแถวที่ยังไม่มีรหัส

update public.punpang_customers
   set data = data || jsonb_build_object('scanCode', replace(gen_random_uuid()::text, '-', ''))
 where data->>'scanCode' is null;

create unique index if not exists punpang_customers_scan_code_key
  on public.punpang_customers ((data->>'scanCode'))
  where data->>'scanCode' is not null;

create or replace function public.punpang_customers_keep_scan_code()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.data ? 'scanCode' and not (coalesce(new.data, '{}'::jsonb) ? 'scanCode') then
    new.data := coalesce(new.data, '{}'::jsonb) || jsonb_build_object('scanCode', old.data->'scanCode');
  end if;
  return new;
end
$$;
revoke all on function public.punpang_customers_keep_scan_code() from public, anon, authenticated;

drop trigger if exists punpang_customers_keep_scan_code on public.punpang_customers;
create trigger punpang_customers_keep_scan_code
  before update on public.punpang_customers
  for each row execute function public.punpang_customers_keep_scan_code();

-- สำเนาโหมดทดสอบ (punpang_test) ให้มีดัชนี ทริกเกอร์ และฟังก์ชันใหม่ด้วย (ดู supabase/tests/mirror.test.sql ข้อ A6)
select punpang_test.punpang_test_sync();
