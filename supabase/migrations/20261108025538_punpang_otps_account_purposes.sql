-- กู้คืนจาก statements ในประวัติ migration ของฐานข้อมูล (เวอร์ชัน 20261108025538) · เนื้อตรงกับที่รันจริง

alter table public.punpang_otps drop constraint punpang_otps_purpose_check;
alter table public.punpang_otps add constraint punpang_otps_purpose_check check (purpose in ('register','reset','change_pin','change_phone','delete'));
alter table public.punpang_otps add column if not exists customer_id text;
