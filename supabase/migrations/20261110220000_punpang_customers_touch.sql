-- ตั้ง updated_at ของลูกค้าทุกครั้งที่แถวถูกแก้ (ก่อนหน้านี้ไม่มี trigger จึงการเขียนแบบเทียบเวอร์ชัน (CAS) ของลูกค้าไม่มีผล)
-- หลังขั้นที่ 2a/2b-1 การแก้แต้มผ่าน RPC ตั้ง updated_at เองแล้ว · trigger นี้ทำให้การแก้ลูกค้าจากแอปถูกตรวจเวอร์ชันด้วย:
-- เครื่องที่ถือสำเนาเก่าจะเขียนทับไม่ได้ (ถูกตรวจว่า "ถูกแก้ที่อื่น" แล้วโหลดฉบับล่าสุด)
create or replace function public.punpang_customers_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists punpang_customers_touch on public.punpang_customers;
create trigger punpang_customers_touch
  before update on public.punpang_customers
  for each row execute function public.punpang_customers_touch();
